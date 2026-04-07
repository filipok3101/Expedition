// ══════════════════════════════════════════════════════════
// ANIMATION — animacja pojazdu na mapie
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { updateStats } from './main.js';

// ── Ikony pojazdu i flagi ──
export function vehIcon(type) {
    const em  = type==='ferry' ? '⛴️' : type==='train' ? '🚂' : type==='auto' ? '🚗' : '🏍️';
    const cls = type==='ferry' ? 'ferry-v' : type==='train' ? 'train-v' : type==='auto' ? 'auto-v' : '';
    return L.divIcon({
        html: `<div class="vmarker ${cls}">${em}</div>`,
        iconSize: [38, 38], iconAnchor: [19, 19], className: ''
    });
}

function flagIcon(stop) {
    return L.divIcon({
        html: `<div class="flag-mk" title="${stop.name}">${stop.flag}</div>`,
        iconSize: [22, 22], iconAnchor: [2, 20], className: ''
    });
}

export function placeFlag(stop, idx) {
    const m = L.marker([stop.lat, stop.lon], { icon: flagIcon(stop), zIndexOffset: 200 }).addTo(S.map);
    m.bindTooltip(`<b>${stop.name}</b><br><small>${stop.country}</small>`, { direction:'top', offset:[0,-6] });
    S.flagMarkers.push(m);
    const el = document.getElementById(`stop-${idx}`);
    if (el) { el.classList.remove('current'); el.classList.add('done'); }
}

// ── Interpolacja pozycji na segmencie ──
export function interpPos(seg, frac) {
    const { coords, cum, distKm } = seg;
    if (frac <= 0) return coords[0];
    if (frac >= 1) return coords[coords.length - 1];
    const target = frac * distKm;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid; else hi = mid;
    }
    const t = (target - cum[lo]) / (cum[hi] - cum[lo] + 1e-12);
    return [
        coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t,
        coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t
    ];
}

function partialCoords(seg, frac) {
    const { coords, cum, distKm } = seg;
    const target = frac * distKm;
    let hi = 1;
    while (hi < cum.length - 1 && cum[hi] < target) hi++;
    const sub = coords.slice(0, hi);
    sub.push(interpPos(seg, frac));
    return sub;
}

// ── Prędkość animacji ──
function getKmPerSec(type) {
    if (type === 'ferry') return S.FERRY_KMS;
    if (type === 'train') return S.TRAIN_KMS;
    return S.ROAD_SPEEDS_KMS[S.speedIdx];
}

// ── Aktualizacja paska info na dole ──
function updateInfoBar(seg) {
    document.getElementById('info-stage').textContent = `${seg.from} → ${seg.to}`;
    const labels = { moto:'🏍️ MOTOR', auto:'🚗 AUTO', ferry:'⛴️ PROM', train:'🚂 POCIĄG' };
    const badge = document.getElementById('vbadge');
    badge.className = `vbadge ${seg.type}`;
    badge.textContent = labels[seg.type];
    document.getElementById('info-sub').textContent =
        `Odcinek: ~${Math.round(seg.distKm)} km · ${Math.round(S.segFrac * 100)}%`;
}

// ── Start segmentu (rysowanie linii) ──
export function startSegment() {
    if (S.curSeg >= S.routeSegments.length) return;
    const seg  = S.routeSegments[S.curSeg];
    const opts = { color: S.lineColors[seg.type], weight: S.lineWeight[seg.type], opacity: .9 };
    if (S.lineDash[seg.type]) opts.dashArray = S.lineDash[seg.type];
    S.setCurrentPolyline(L.polyline([seg.coords[0]], opts).addTo(S.map));
}

// ── Zakończenie wyprawy ──
export function finishJourney() {
    S.setAnimRunning(false);
    document.getElementById('playBtn').textContent = '✓ META';
    document.getElementById('playBtn').classList.remove('active');
    document.getElementById('info-stage').textContent = '🏁 Wyprawa ukończona!';
    document.getElementById('info-sub').textContent = 'Dojechaliśmy do celu!';
    document.getElementById('progress-fill').style.width = '100%';
    S.finalizeAccum();
    updateStats();
    S.STOPS.forEach((_, i) => {
        const e = document.getElementById(`stop-${i}`);
        if (e) { e.classList.add('done'); e.classList.remove('current'); }
    });
}

// ── Główna pętla animacji ──
export function animStep(ts) {
    if (!S.animRunning) return;
    if (S.curSeg >= S.routeSegments.length) { finishJourney(); return; }

    const seg = S.routeSegments[S.curSeg];
    const dt  = S.lastTs === null ? 0 : Math.min((ts - S.lastTs) / 1000, 0.1);
    S.setLastTs(ts);

    if (dt > 0) S.setSegFrac(S.segFrac + getKmPerSec(seg.type) * dt / seg.distKm);

    if (S.segFrac >= 1) {
        S.setSegFrac(1);
        if (S.currentPolyline) {
            S.currentPolyline.setLatLngs(seg.coords);
            S.drawnPolylines.push(S.currentPolyline);
            S.setCurrentPolyline(null);
        }

        S.addDoneKm(seg.type, seg.distKm);

        const segFuel = (seg.distKm / 100) * (S.consumptionByType[seg.type] || 0);
        const segCost = segFuel * (S.fuelPricesByCountry[seg.country] || 0);
        S.addDoneFuelCost(segFuel, segCost);

        const si = S.curSeg + 1;
        if (si < S.STOPS.length) {
            placeFlag(S.STOPS[si], si);
            const nxt = document.getElementById(`stop-${si}`);
            if (nxt) nxt.classList.add('current');
        }

        S.setCurSeg(S.curSeg + 1);
        S.setSegFrac(0);
        S.setLastTs(null);

        if (S.curSeg >= S.routeSegments.length) { finishJourney(); return; }
        startSegment();
        S.setAnimFrame(requestAnimationFrame(animStep));
        return;
    }

    const pos = interpPos(seg, S.segFrac);
    if (S.currentPolyline) S.currentPolyline.setLatLngs(partialCoords(seg, S.segFrac));

    if (!S.vehicleMarker) {
        S.setVehicleMarker(L.marker(pos, { icon: vehIcon(seg.type), zIndexOffset: 600 }).addTo(S.map));
    } else {
        S.vehicleMarker.setLatLng(pos);
        S.vehicleMarker.setIcon(vehIcon(seg.type));
    }

    S.map.panTo(pos, { animate: false });

    const partial = seg.distKm * S.segFrac;
    S.updateAccum(seg.type, partial);

    const partialFuel = (partial / 100) * (S.consumptionByType[seg.type] || 0);
    const partialCost = partialFuel * (S.fuelPricesByCountry[seg.country] || 0);
    S.updateAccumFuelCost(partialFuel, partialCost);

    updateStats();

    const totalKm = S.totalMotoKm + S.totalFerryKm + S.totalTrainKm;
    const doneKm  = S.accumMotoKm + S.accumFerryKm + S.accumTrainKm;
    document.getElementById('progress-fill').style.width = (doneKm / totalKm * 100) + '%';

    updateInfoBar(seg);
    S.setAnimFrame(requestAnimationFrame(animStep));
}