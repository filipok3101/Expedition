// ══════════════════════════════════════════════════════════
// ROUTING — obliczanie tras
// Router główny: Valhalla (profile auto/motorcycle, opcje trasy).
// Router zapasowy: OSRM (gdy Valhalla niedostępna; tylko driving).
// Promy wykrywane automatycznie: Valhalla → maneuver.type === 28,
// OSRM → step.mode === 'ferry'.
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { placeFlag } from './animation.js';
import { t } from './translations.js';
import { valhallaRoute, osrmRoute } from './api.js';

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

// Skleja kolejne fragmenty tego samego trybu (road/ferry) w pod-segmenty
function mergeModeRuns(runs) {
    const subSegs = [];
    let curMode = null, curCoords = [];
    for (const { mode, pts } of runs) {
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
    return subSegs;
}

async function fetchValhallaChunk(from, to, costing, avoidMotorways) {
    const body = {
        locations: [
            { lon: from[1], lat: from[0] },
            { lon: to[1],   lat: to[0]   },
        ],
        costing,
        costing_options: {
            [costing]: {
                use_ferry:    S.routeOptions.avoidFerries ? 0.0 : 1.0,
                use_highways: avoidMotorways              ? 0.0 : 1.0,
            },
        },
        directions_options: { units: 'km' },
    };

    const d = await valhallaRoute(body);
    const leg = d.trip?.legs?.[0];
    if (!leg) throw new Error('No route in Valhalla response');

    const allCoords = decodePolyline6(leg.shape);
    const runs = (leg.maneuvers ?? []).map(m => ({
        // type 28 = FerryEnter (faktyczna przeprawa); travel_mode bywa zawsze "drive"
        mode: m.type === 28 ? 'ferry' : 'road',
        pts:  allCoords.slice(m.begin_shape_index, m.end_shape_index + 1),
    }));

    const subSegs = mergeModeRuns(runs);
    return subSegs.length ? subSegs : [{ coords: densify(allCoords, 5), type: 'road' }];
}

async function fetchOsrmChunk(from, to) {
    const d = await osrmRoute(from, to);
    if (d.code !== 'Ok' || !d.routes?.[0]?.legs?.[0]) throw new Error('No route in OSRM response');

    const runs = d.routes[0].legs[0].steps.map(step => ({
        mode: step.mode === 'ferry' ? 'ferry' : 'road',
        pts:  step.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    }));

    const subSegs = mergeModeRuns(runs);
    if (!subSegs.length) throw new Error('Empty OSRM geometry');
    return subSegs;
}

/**
 * Pobiera trasę dla pary przystanków.
 * @returns {{ subSegs: Array, source: 'valhalla'|'osrm' } | null}
 */
async function fetchRouteChunk(from, to, costing, avoidMotorways) {
    try {
        return { subSegs: await fetchValhallaChunk(from, to, costing, avoidMotorways), source: 'valhalla' };
    } catch (e) {
        console.warn('Valhalla failed, trying OSRM fallback:', e.message);
    }
    try {
        return { subSegs: await fetchOsrmChunk(from, to), source: 'osrm' };
    } catch (e) {
        console.error('OSRM fallback failed too:', e.message);
        return null;
    }
}

// ── Banery ostrzeżeń nad listą przystanków ──────────────────
function showWarningBanner(id, title, listItems, sub) {
    document.getElementById(id)?.remove();
    const banner = document.createElement('div');
    banner.id        = id;
    banner.className = 'route-warning-banner';
    banner.innerHTML = `
        <div class="rwb-icon">⚠️</div>
        <div class="rwb-body">
            <strong></strong>
            <div class="rwb-list"></div>
            <div class="rwb-sub"></div>
        </div>
        <button class="rwb-close">✕</button>`;
    banner.querySelector('strong').textContent    = title;
    banner.querySelector('.rwb-list').innerHTML   = listItems.map(s => `• ${s}`).join('<br>');
    banner.querySelector('.rwb-sub').textContent  = sub;
    banner.querySelector('.rwb-close').addEventListener('click', () => banner.remove());
    document.getElementById('stop-list').insertAdjacentElement('beforebegin', banner);
}

export async function preloadRoutes() {
    const fill = document.getElementById('loading-fill');
    const msg  = document.getElementById('loading-msg');

    S.setRouteSegments([]);
    S.resetKm();
    fill.style.width = '0%';

    const segments     = [];
    const osrmFallback = [];   // pary, dla których użyto OSRM
    const nPairs       = S.STOPS.length - 1;

    for (let i = 0; i < nPairs; i++) {
        const from     = S.STOPS[i];
        const to       = S.STOPS[i + 1];
        const userType = to.type;
        const costing  = userType === 'moto' ? 'motorcycle' : 'auto';

        msg.textContent = t('loading_route', { i: i + 1, n: nPairs, from: from.name, to: to.name });

        const perSeg     = S.routeOptions.motorwayPerSegment;
        const segAvoidMw = perSeg.length > i ? perSeg[i] : S.routeOptions.avoidMotorways;

        const result = await fetchRouteChunk([from.lat, from.lon], [to.lat, to.lon], costing, segAvoidMw);

        if (!result) {
            document.getElementById('loading').style.display = 'none';
            const dist = haversineKm([from.lat, from.lon], [to.lat, to.lon]);
            alert(t('err_segment_too_long', { from: from.name, to: to.name, km: Math.round(dist) }));
            document.getElementById('app').style.display = 'none';
            document.getElementById('setup-screen').style.display = 'block';
            window.dispatchEvent(new Event('resize'));
            return;
        }

        if (result.source === 'osrm') osrmFallback.push(`${from.name} → ${to.name}`);

        const subSegs = result.subSegs.map(s => ({
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

            segments.push({
                coords, cum, type, distKm,
                from:    from.name,
                to:      to.name,
                segFrom: isFirst ? from.name : '〜',
                segTo:   isLast  ? to.name   : '〜',
                country: from.country,
                noFuel:  type === 'ferry',
                color:   (segAvoidMw && type !== 'ferry' && result.source === 'valhalla') ? '#e53935' : null,
            });

            S.addTotalKm(type, distKm);
        }

        fill.style.width = ((i + 1) / nPairs * 100) + '%';
        await new Promise(r => setTimeout(r, 80));
    }

    S.setRouteSegments(segments);

    msg.textContent = t('loading_done');
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('loading').style.display = 'none';

    // Baner: użyto routera zapasowego
    if (osrmFallback.length) {
        showWarningBanner('osrm-warning-banner', t('rwb_osrm_title'), osrmFallback, t('rwb_osrm_sub'));
    }

    // Baner: wymuszony prom — avoidFerries=true, ale nie istnieje trasa lądowa
    // (np. Tallinn↔Helsinki, trasy na wyspy)
    if (S.routeOptions.avoidFerries) {
        const forced = [];
        for (let i = 0; i < nPairs; i++) {
            const fn = S.STOPS[i].name;
            const tn = S.STOPS[i + 1].name;
            if (segments.some(s => s.from === fn && s.to === tn && s.type === 'ferry'))
                forced.push(`${fn} → ${tn}`);
        }
        if (forced.length) {
            showWarningBanner('route-warning-banner', t('rwb_ferry_title'), forced, t('rwb_ferry_sub'));
        }
    }

    // Dystanse pod wierszami przystanków
    for (let i = 0; i < nPairs; i++) {
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
        document.getElementById(`stop-${i}`)?.insertAdjacentElement('afterend', el);
    }

    placeFlag(S.STOPS[0], 0);
    document.getElementById('stop-0')?.classList.add('current');
    S.map.setView([S.STOPS[0].lat, S.STOPS[0].lon], 10, { animate: false });
}
