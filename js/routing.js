// ══════════════════════════════════════════════════════════
// ROUTING — obliczenia tras i pobieranie danych z Valhalla
// Ferry wykrywane automatycznie z manewrów (travel_mode === 'ferry')
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { placeFlag } from './animation.js';
import { t } from './translations.js';

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

// Valhalla zwraca shape jako encoded polyline z precyzją 1e6 (lat, lon)
function decodePolyline6(encoded) {
    const coords = [];
    let index = 0, lat = 0, lon = 0;
    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);
        shift = 0; result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lon += (result & 1) ? ~(result >> 1) : (result >> 1);
        coords.push([lat / 1e6, lon / 1e6]);
    }
    return coords;
}

async function fetchValhallaChunk(from, to, costing) {
    const fromLoc = { lon: from[1], lat: from[0] };
    const toLoc   = { lon: to[1],   lat: to[0] };
    const body = {
        locations: [fromLoc, toLoc],
        costing,
        costing_options: {
            [costing]: { use_ferry: S.routeOptions.avoidFerries ? 0.0 : 1.0 },
        },
        directions_options: { units: 'km' },
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const ctrl = new AbortController();
            const tid  = setTimeout(() => ctrl.abort(), 15000);
            const r    = await fetch('https://valhalla1.openstreetmap.de/route', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
                signal:  ctrl.signal,
            });
            clearTimeout(tid);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const d = await r.json();
            if (!d.trip?.legs?.[0]) throw new Error('No route in Valhalla response');

            const leg       = d.trip.legs[0];
            const allCoords = decodePolyline6(leg.shape);

            const subSegs = [];
            let curMode   = null;
            let curCoords = [];

            for (const maneuver of leg.maneuvers ?? []) {
                // type 28 = FerryEnter (actual sea crossing); travel_mode is always "drive"
                const mode = maneuver.type === 28 ? 'ferry' : 'road';
                const pts  = allCoords.slice(
                    maneuver.begin_shape_index,
                    maneuver.end_shape_index + 1,
                );
                if (pts.length < 2) continue;

                if (mode !== curMode) {
                    if (curCoords.length && curMode !== null)
                        subSegs.push({ coords: densify(curCoords, 5), type: curMode });
                    curMode   = mode;
                    curCoords = pts;
                } else {
                    curCoords = curCoords.concat(pts.slice(1));
                }
            }
            if (curCoords.length && curMode !== null)
                subSegs.push({ coords: densify(curCoords, 5), type: curMode });

            if (!subSegs.length)
                return [{ coords: densify(allCoords, 5), type: 'road' }];

            return subSegs;
        } catch (e) {
            console.warn(`Valhalla attempt ${attempt} failed:`, e.message);
            if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
        }
    }

    console.error('Valhalla unavailable — segment too long or unreachable');
    return null;
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
        const userType = to.type;
        const costing  = userType === 'moto' ? 'motorcycle' : 'auto';

        msg.textContent = `Route ${i + 1}/${S.STOPS.length - 1}: ${from.name} → ${to.name}`;
        fill.style.width = ((i / (S.STOPS.length - 2)) * 100) + '%';

        const rawSubs = await fetchValhallaChunk([from.lat, from.lon], [to.lat, to.lon], costing);

        if (!rawSubs) {
            document.getElementById('loading').style.display = 'none';
            const dist = haversineKm([from.lat, from.lon], [to.lat, to.lon]);
            alert(t('err_segment_too_long')
                .replace('{from}', from.name)
                .replace('{to}', to.name)
                .replace('{km}', Math.round(dist)));
            document.getElementById('app').style.display = 'none';
            document.getElementById('setup-screen').style.display = 'flex';
            window.dispatchEvent(new Event('resize'));
            return;
        }

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
                noFuel:  type === 'ferry',
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

    // Wymuś-prom: gdy avoidFerries=true ale Valhalla mimo to użyła promu
    // (nie ma trasy lądowej — np. Tallinn↔Helsinki, trasy na wyspy)
    if (S.routeOptions.avoidFerries) {
        const forced = [];
        for (let i = 0; i < S.STOPS.length - 1; i++) {
            const fn = S.STOPS[i].name;
            const tn = S.STOPS[i + 1].name;
            if (segments.some(s => s.from === fn && s.to === tn && s.type === 'ferry'))
                forced.push(`${fn} → ${tn}`);
        }
        if (forced.length) {
            document.getElementById('route-warning-banner')?.remove();
            const banner = document.createElement('div');
            banner.id        = 'route-warning-banner';
            banner.className = 'route-warning-banner';
            banner.innerHTML = `
                <div class="rwb-icon">⚠️</div>
                <div class="rwb-body">
                    <strong>FORCED FERRY CROSSING</strong>
                    <div class="rwb-list">${forced.map(s => `• ${s}`).join('<br>')}</div>
                    <div class="rwb-sub">No viable land route exists for these segments.</div>
                </div>
                <button class="rwb-close" onclick="this.closest('#route-warning-banner').remove()">✕</button>`;
            document.getElementById('stop-list').insertAdjacentElement('beforebegin', banner);
        }
    }

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
    S.map.setView([S.STOPS[0].lat, S.STOPS[0].lon], 10, { animate: false });
}