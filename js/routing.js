// ══════════════════════════════════════════════════════════
// ROUTING — obliczenia tras i pobieranie danych z OSRM
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { placeFlag } from './animation.js';

// ── Odległość w km między dwoma punktami [lat, lon] ──
export function haversineKm(a, b) {
    const R = 6371;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLon = (b[1] - a[1]) * Math.PI / 180;
    const s = Math.sin(dLat/2)**2
            + Math.cos(a[0]*Math.PI/180) * Math.cos(b[0]*Math.PI/180)
            * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

// ── Zagęszczenie punktów trasy (max co maxGapKm) ──
export function densify(coords, maxGapKm = 10) {
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
        out.push(coords[i]);
        const d = haversineKm(coords[i], coords[i+1]);
        const n = Math.ceil(d / maxGapKm);
        for (let k = 1; k < n; k++) {
            const t = k / n;
            out.push([
                coords[i][0] + (coords[i+1][0] - coords[i][0]) * t,
                coords[i][1] + (coords[i+1][1] - coords[i][1]) * t
            ]);
        }
    }
    out.push(coords[coords.length - 1]);
    return out;
}

// ── Pobieranie trasy z OSRM (z fallbackiem na linię prostą) ──
export async function fetchOsrmRoute(from, to) {
    const url = `https://router.project-osrm.org/route/v1/car/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const ctrl = new AbortController();
            const tid  = setTimeout(() => ctrl.abort(), 10000);
            const r = await fetch(url, { signal: ctrl.signal });
            clearTimeout(tid);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const d = await r.json();
            if (d.routes?.[0]?.geometry?.coordinates) {
                const raw = d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                return densify(raw, 5);
            }
            throw new Error('Brak trasy w odpowiedzi OSRM');
        } catch(e) {
            console.warn(`OSRM próba ${attempt} nieudana:`, e.message);
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
        }
    }
    console.error('OSRM całkowicie niedostępny – używam linii prostej');
    return densify([[from[0], from[1]], [to[0], to[1]]], 8);
}

// ── Wczytanie wszystkich segmentów trasy przed startem ──
export async function preloadRoutes() {
    const fill = document.getElementById('loading-fill');
    const msg  = document.getElementById('loading-msg');

    S.setRouteSegments([]);
    S.resetKm();

    const segments = [];

    for (let i = 0; i < S.STOPS.length - 1; i++) {
        const from = S.STOPS[i];
        const to   = S.STOPS[i+1];
        const type = to.type;

        msg.textContent = `Trasa ${i+1}/${S.STOPS.length-1}: ${from.name} → ${to.name}`;
        fill.style.width = ((i / (S.STOPS.length - 2)) * 100) + '%';

        let coords;
        if (type === 'ferry' || type === 'train') {
            coords = densify([[from.lat, from.lon], [to.lat, to.lon]], 8);
        } else {
            coords = await fetchOsrmRoute([from.lat, from.lon], [to.lat, to.lon]);
        }

        const cum = [0];
        for (let k = 1; k < coords.length; k++) {
            cum.push(cum[k-1] + haversineKm(coords[k-1], coords[k]));
        }
        const distKm = cum[cum.length - 1];

        segments.push({ coords, cum, type, distKm, from: from.name, to: to.name, country: from.country });
        S.addTotalKm(type, distKm);

        await new Promise(r => setTimeout(r, 80));
    }

    S.setRouteSegments(segments);

    fill.style.width = '100%';
    msg.textContent = 'Trasy załadowane! Gotowy do startu.';
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('loading').style.display = 'none';

    // Wstawienie odległości pod każdy przystanek w prawym panelu
    S.routeSegments.forEach((seg, i) => {
        const distEl = document.createElement('div');
        distEl.className = 'stop-dist';
        distEl.textContent = `↓ ~${Math.round(seg.distKm)} km`;
        const stopRow = document.getElementById(`stop-${i}`);
        if (stopRow) stopRow.insertAdjacentElement('afterend', distEl);
    });

    placeFlag(S.STOPS[0], 0);
    document.getElementById('stop-0').classList.add('current');
}