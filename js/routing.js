// ══════════════════════════════════════════════════════════
// ROUTING — obliczenia tras i pobieranie danych z OSRM
// Ferry wykrywane automatycznie z kroków OSRM (step.mode === 'ferry')
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { placeFlag } from './animation.js';

export function haversineKm(a, b) {
    const R = 6371;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLon = (b[1] - a[1]) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2
        + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180)
        * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function densify(coords, maxGapKm = 10) {
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
        out.push(coords[i]);
        const d = haversineKm(coords[i], coords[i + 1]);
        const n = Math.ceil(d / maxGapKm);
        for (let k = 1; k < n; k++) {
            const t = k / n;
            out.push([
                coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
                coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
            ]);
        }
    }
    out.push(coords[coords.length - 1]);
    return out;
}

function stepCoords(geom) {
    if (geom?.type === 'LineString' && geom.coordinates)
        return geom.coordinates.map(c => [c[1], c[0]]);
    return [];
}

/**
 * Pobiera trasę z OSRM z krokami (steps=true).
 * Zwraca tablicę pod-segmentów: [{ coords, type: 'road'|'ferry' }]
 * Jeśli OSRM niedostępny — fallback do jednej prostej linii jako 'road'.
 */
async function fetchOsrmSegments(from, to) {
    const url = `https://router.project-osrm.org/route/v1/car/`
        + `${from[1]},${from[0]};${to[1]},${to[0]}`
        + `?overview=full&geometries=geojson&steps=true`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const ctrl = new AbortController();
            const tid  = setTimeout(() => ctrl.abort(), 10000);
            const r    = await fetch(url, { signal: ctrl.signal });
            clearTimeout(tid);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const d = await r.json();
            if (!d.routes?.[0]) throw new Error('No route in OSRM response');

            // Parsuj kroki i grupuj ciągłe odcinki o tym samym mode
            const subSegs = [];
            let curMode   = null;
            let curCoords = [];

            for (const leg of d.routes[0].legs ?? []) {
                for (const step of leg.steps ?? []) {
                    const mode  = step.mode === 'ferry' ? 'ferry' : 'road';
                    const pts   = stepCoords(step.geometry);
                    if (!pts.length) continue;

                    if (mode !== curMode) {
                        if (curCoords.length && curMode !== null)
                            subSegs.push({ coords: densify(curCoords, 5), type: curMode });
                        curMode   = mode;
                        curCoords = pts;
                    } else {
                        // Dołącz, pomijając duplikat pierwszego punktu
                        curCoords = curCoords.concat(pts.slice(1));
                    }
                }
            }
            if (curCoords.length && curMode !== null)
                subSegs.push({ coords: densify(curCoords, 5), type: curMode });

            // Fallback gdy kroki puste — użyj globalnej geometrii jako road
            if (!subSegs.length) {
                const raw = d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                return [{ coords: densify(raw, 5), type: 'road' }];
            }

            return subSegs;
        } catch (e) {
            console.warn(`OSRM attempt ${attempt} failed:`, e.message);
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Pełny fallback — linia prosta jako road
    console.error('OSRM unavailable — using straight line');
    return [{ coords: densify([from, to], 8), type: 'road' }];
}

export async function preloadRoutes() {
    const fill = document.getElementById('loading-fill');
    const msg  = document.getElementById('loading-msg');

    S.setRouteSegments([]);
    S.resetKm();

    const segments = [];

    for (let i = 0; i < S.STOPS.length - 1; i++) {
        const from     = S.STOPS[i];
        const to       = S.STOPS[i + 1];
        const userType = to.type; // 'auto' | 'moto'

        msg.textContent = `Route ${i + 1}/${S.STOPS.length - 1}: ${from.name} → ${to.name}`;
        fill.style.width = ((i / (S.STOPS.length - 2)) * 100) + '%';

        // Pobierz pod-segmenty z OSRM (może zawierać ferry wykryte z kroków)
        const rawSubs = await fetchOsrmSegments(
            [from.lat, from.lon],
            [to.lat, to.lon]
        );

        // Zamień 'road' → typ pojazdu użytkownika; 'ferry' zostaje 'ferry'
        const subSegs = rawSubs.map(s => ({
            coords: s.coords,
            type:   s.type === 'ferry' ? 'ferry' : userType,
        }));

        for (let si = 0; si < subSegs.length; si++) {
            const { coords, type } = subSegs[si];

            const cum = [0];
            for (let k = 1; k < coords.length; k++)
                cum.push(cum[k - 1] + haversineKm(coords[k - 1], coords[k]));
            const distKm = cum[cum.length - 1];

            // Etykieta segmentu — dla sub-segmentów bez nazwy używamy tyld
            const isFirst = si === 0;
            const isLast  = si === subSegs.length - 1;
            const segFrom = isFirst ? from.name : '〜';
            const segTo   = isLast  ? to.name   : '〜';

            segments.push({
                coords, cum, type, distKm,
                from:    from.name,
                to:      to.name,
                segFrom, segTo,
                country: from.country,
                noFuel:  type === 'ferry', // promy bez paliwa
            });

            S.addTotalKm(type, distKm);
        }

        await new Promise(r => setTimeout(r, 80));
    }

    S.setRouteSegments(segments);

    fill.style.width = '100%';
    msg.textContent = 'Routes loaded! Ready to go.';
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('loading').style.display = 'none';

    // Odległości pod przystankami — sumujemy po from.name/to.name
    for (let i = 0; i < S.STOPS.length - 1; i++) {
        const fn = S.STOPS[i].name;
        const tn = S.STOPS[i + 1].name;
        let total = 0, ferry = 0;
        for (const seg of segments) {
            if (seg.from === fn && seg.to === tn) {
                total += seg.distKm;
                if (seg.type === 'ferry') ferry += seg.distKm;
            }
        }
        const el = document.createElement('div');
        el.className = 'stop-dist';
        el.textContent = ferry > 0
            ? `↓ ~${Math.round(total)} km  (⛴️ ~${Math.round(ferry)} km)`
            : `↓ ~${Math.round(total)} km`;
        const row = document.getElementById(`stop-${i}`);
        if (row) row.insertAdjacentElement('afterend', el);
    }

    placeFlag(S.STOPS[0], 0);
    document.getElementById('stop-0').classList.add('current');
}