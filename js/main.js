// ══════════════════════════════════════════════════════════
// MAIN — punkt wejścia aplikacji
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { translations, uiLang } from './translations.js';
import { preloadRoutes } from './routing.js';
import { animStep, startSegment, finishJourney, placeFlag, vehIcon } from './animation.js';
import {
    addDestination, updateStopsList,
    goToAdvanced, backToSetup,
    dragStart, dragOver, dragEnter, dragLeave, drop, removeStop,
    initSetupMap,
} from './setup.js';
import { exportGPX, startMP4Recording, recSettings } from './export.js';

export function initMap() {
    if (S.map) return;
    S.setMap(L.map('map', { zoomControl: false, attributionControl: true, center: [52, 19], zoom: 4 }));
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(S.map);
}

export function updateStats() {
    const total = S.accumMotoKm + S.accumFerryKm;
    document.getElementById('stat-total-km').textContent = Math.round(total).toLocaleString('pl-PL');
    document.getElementById('stat-moto-km').textContent  = Math.round(S.accumMotoKm).toLocaleString('pl-PL');
    document.getElementById('stat-ferry-km').textContent = Math.round(S.accumFerryKm).toLocaleString('pl-PL');
    document.getElementById('stat-fuel').textContent     = S.accumFuel.toFixed(1);
    document.getElementById('stat-cost').textContent     = Math.round(S.accumCost).toLocaleString('pl-PL');
}

export function startFinalJourney() {
    const tourInput = document.getElementById('tour-name-input');
    S.setTourName(tourInput?.value.trim() || '');

    S.uniqueTransports.forEach(type => {
        if (type === 'ferry') return;
        S.consumptionByType[type] = parseFloat(document.getElementById(`cons-${type}`)?.value) || 0;
    });
    S.uniqueCountries.forEach(country => {
        S.fuelPricesByCountry[country] = parseFloat(document.getElementById(`price-${country}`)?.value) || 0;
    });

    document.getElementById('advanced-screen').style.display = 'none';
    document.getElementById('app').style.display = 'grid';

    S.setSTOPS([...S.customStops]);
    S.STOPS.forEach((s, idx) => {
        s.flag = (idx === 0 || idx === S.STOPS.length - 1) ? '🏁' : '🚩';
    });

    const stopListEl = document.getElementById('stop-list');
    stopListEl.innerHTML = '';
    S.STOPS.forEach((s, i) => {
        const icon = s.type === 'auto' ? '🚗' : '🏍️';
        const d = document.createElement('div');
        d.className = 'stop-row';
        d.id = `stop-${i}`;
        d.innerHTML = `<div class="stop-dot"></div><span>${icon} ${s.name}</span>`;
        d.style.cursor = 'pointer';
        d.addEventListener('click', () => jumpToStop(i));
        stopListEl.appendChild(d);
    });

const names = S.STOPS.map(s => s.name);

const stopsText = names.length > 3
    ? `${names[0]} → ... → ${names[names.length - 1]}`
    : names.join(' → ');

document.getElementById('route-title').textContent = S.tourName || stopsText;

    document.getElementById('loading').style.display = 'flex';
    initMap();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        S.map.invalidateSize(true);
        updateStats();
        preloadRoutes();
    }));
}

export function togglePlay() {
    if (S.animRunning) {
        S.setAnimRunning(false);
        S.setLastTs(null);
        cancelAnimationFrame(S.animFrame);
        document.getElementById('playBtn').textContent = '▶ RESUME';
        document.getElementById('playBtn').classList.remove('active');
    } else {
        S.setAnimRunning(true);
        document.getElementById('playBtn').textContent = '⏸ PAUSE';
        document.getElementById('playBtn').classList.add('active');
        if (S.curSeg === 0 && S.segFrac === 0) {
            startSegment();
            document.getElementById('stop-0').classList.add('done');
            S.map.setView([S.STOPS[0].lat, S.STOPS[0].lon], 11, { animate: true });
        }
        S.setAnimFrame(requestAnimationFrame(animStep));
    }
}

export function changeSpeed(dir) {
    S.setSpeedIdx(Math.max(0, Math.min(S.ROAD_SPEEDS_KMS.length - 1, S.speedIdx + dir)));
    document.getElementById('speed-label').textContent = S.SPEED_LABELS[S.speedIdx];
}

export function jumpToStop(stopIdx) {
    if (!S.routeSegments.length) return;

    // resetJourney musi być przed flyTo — kończy się setView które anuluje wcześniejszy flyTo
    if (stopIdx === 0) {
        resetJourney();
        S.map.flyTo([S.STOPS[0].lat, S.STOPS[0].lon], 14, { animate: true, duration: 1.5 });
        return;
    }

    if (S.animRunning) {
        S.setAnimRunning(false);
        S.setLastTs(null);
        cancelAnimationFrame(S.animFrame);
    }

    S.drawnPolylines.forEach(p => S.map.removeLayer(p));
    S.drawnPolylines.length = 0;
    S.flagMarkers.forEach(m => S.map.removeLayer(m));
    S.flagMarkers.length = 0;
    if (S.currentPolyline) { S.map.removeLayer(S.currentPolyline); S.setCurrentPolyline(null); }
    if (S.vehicleMarker)   { S.map.removeLayer(S.vehicleMarker);   S.setVehicleMarker(null); }

    S.resetKm();
    S.STOPS.forEach((_, i) => {
        const e = document.getElementById(`stop-${i}`);
        if (e) e.classList.remove('done', 'current');
    });

    placeFlag(S.STOPS[0], 0);
    document.getElementById('stop-0')?.classList.add('done');

    const isLast = stopIdx >= S.STOPS.length - 1;
    let targetSegIdx = isLast
        ? S.routeSegments.length
        : S.routeSegments.findIndex(seg => seg.from === S.STOPS[stopIdx].name);
    if (targetSegIdx === -1) targetSegIdx = S.routeSegments.length;

    for (let i = 0; i < targetSegIdx; i++) {
        const seg = S.routeSegments[i];
        const opts = { color: seg.color ?? S.lineColors[seg.type], weight: S.lineWeight[seg.type], opacity: 0.9 };
        if (S.lineDash[seg.type]) opts.dashArray = S.lineDash[seg.type];
        S.drawnPolylines.push(L.polyline(seg.coords, opts).addTo(S.map));

        S.addDoneKm(seg.type, seg.distKm);
        if (!seg.noFuel) {
            const fuel = (seg.distKm / 100) * (S.consumptionByType[seg.type] || 0);
            S.addDoneFuelCost(fuel, fuel * (S.fuelPricesByCountry[seg.country] || 0));
        }

        const nextSeg = S.routeSegments[i + 1];
        if (!nextSeg || nextSeg.from !== seg.from) {
            const toIdx = S.STOPS.findIndex(s => s.name === seg.to);
            if (toIdx > 0 && toIdx <= stopIdx) placeFlag(S.STOPS[toIdx], toIdx);
        }
    }

    // accum = done (partial = 0, stoimy dokładnie na przystanku)
    S.updateAccum('auto', 0);

    // totalMotoKm/totalFerryKm zostały wyzerowane przez resetKm() — liczymy z segmentów
    const totalKm = S.routeSegments.reduce((s, seg) => s + seg.distKm, 0);
    const doneKm  = S.doneMotoKm + S.doneFerryKm;

    if (targetSegIdx >= S.routeSegments.length) {
        // Ostatni przystanek — nie wywołujemy finishJourney() bo ta woła finalizeAccum()
        // który używa totalMotoKm = 0 (po resetKm). Robimy to samo co finishJourney ręcznie.
        S.setCurSeg(S.routeSegments.length);
        S.setSegFrac(0);
        S.setLastTs(null);
        S.setAnimRunning(false);
        const lastStop = S.STOPS[S.STOPS.length - 1];
        const lastSeg  = S.routeSegments[S.routeSegments.length - 1];
        S.setVehicleMarker(
            L.marker([lastStop.lat, lastStop.lon], { icon: vehIcon(lastSeg?.type || 'auto'), zIndexOffset: 600 }).addTo(S.map)
        );
        S.STOPS.forEach((_, i) => {
            const e = document.getElementById(`stop-${i}`);
            if (e) { e.classList.add('done'); e.classList.remove('current'); }
        });
        document.getElementById('playBtn').textContent = '✓ FINISH';
        document.getElementById('playBtn').classList.remove('active');
        document.getElementById('info-stage').textContent = '🏁 Journey complete!';
        document.getElementById('info-sub').textContent = 'We reached the destination!';
        document.getElementById('progress-fill').style.width = '100%';
        updateStats();
        S.map.flyTo([lastStop.lat, lastStop.lon], 14, { animate: true, duration: 1.5 });
        return;
    }

    S.setCurSeg(targetSegIdx);
    S.setSegFrac(0);
    S.setLastTs(null);

    const stop    = S.STOPS[stopIdx];
    const nextSeg = S.routeSegments[targetSegIdx];
    S.setVehicleMarker(
        L.marker([stop.lat, stop.lon], { icon: vehIcon(nextSeg.type), zIndexOffset: 600 }).addTo(S.map)
    );

    const curEl = document.getElementById(`stop-${stopIdx}`);
    if (curEl) { curEl.classList.add('current'); curEl.classList.remove('done'); }

    S.map.flyTo([stop.lat, stop.lon], 14, { animate: true, duration: 1.5 });

    document.getElementById('progress-fill').style.width = totalKm > 0 ? (doneKm / totalKm * 100) + '%' : '0%';
    document.getElementById('playBtn').textContent = '▶ RESUME';
    document.getElementById('playBtn').classList.remove('active');
    document.getElementById('info-stage').textContent = `${nextSeg.segFrom} → ${nextSeg.segTo}`;
    const labels = { moto: '🏍️ MOTO', auto: '🚗 AUTO', ferry: '⛴️ FERRY' };
    const badge = document.getElementById('vbadge');
    badge.className = `vbadge ${nextSeg.type}`;
    badge.textContent = labels[nextSeg.type] ?? nextSeg.type.toUpperCase();
    document.getElementById('info-sub').textContent = `Segment: ~${Math.round(nextSeg.distKm)} km · 0%`;

    updateStats();
}

export function resetJourney() {
    S.setAnimRunning(false);
    S.setLastTs(null);
    cancelAnimationFrame(S.animFrame);
    S.setCurSeg(0);
    S.setSegFrac(0);
    S.resetKm();

    S.drawnPolylines.forEach(p => S.map.removeLayer(p));
    S.drawnPolylines.length = 0;
    S.flagMarkers.forEach(m => S.map.removeLayer(m));
    S.flagMarkers.length = 0;
    if (S.currentPolyline) { S.map.removeLayer(S.currentPolyline); S.setCurrentPolyline(null); }
    if (S.vehicleMarker)   { S.map.removeLayer(S.vehicleMarker);   S.setVehicleMarker(null); }

    S.STOPS.forEach((_, i) => {
        const e = document.getElementById(`stop-${i}`);
        if (e) e.classList.remove('done', 'current');
    });

    document.getElementById('playBtn').textContent = '▶ START';
    document.getElementById('playBtn').classList.remove('active');
    document.getElementById('info-stage').textContent = 'READY TO START';
    document.getElementById('info-sub').textContent   = 'Press START to begin the journey';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('stop-0').classList.add('current');

    placeFlag(S.STOPS[0], 0);
    updateStats();
    S.map.setView([S.STOPS[0].lat, S.STOPS[0].lon], 10, { animate: true });
}

export let currentLang = 'en';

export function changeLanguage(lang) {
    currentLang = lang;
    uiLang.code = lang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key  = el.getAttribute('data-i18n');
        const text = translations[currentLang]?.[key];
        if (!text) return;
        if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) el.placeholder = text;
        else el.textContent = text;
    });

    const btnEn = document.getElementById('btn-en');
    const btnPl = document.getElementById('btn-pl');
    if (btnEn && btnPl) {
        btnEn.style.background = lang === 'en' ? 'var(--accent)' : 'var(--panel2)';
        btnEn.style.color      = lang === 'en' ? 'var(--bg)'     : 'var(--text)';
        btnPl.style.background = lang === 'pl' ? 'var(--accent)' : 'var(--panel2)';
        btnPl.style.color      = lang === 'pl' ? 'var(--bg)'     : 'var(--text)';
    }
}

// ── Export panel wiring ─────────────────────────────────────

function initExportPanel() {
    // Toggle drawer
    const triggerBtn = document.getElementById('exp-trigger-btn');
    const drawer     = document.getElementById('exp-drawer');
    triggerBtn?.addEventListener('click', () => {
        const expanded = triggerBtn.getAttribute('aria-expanded') === 'true';
        triggerBtn.setAttribute('aria-expanded', String(!expanded));
        drawer.setAttribute('aria-hidden', String(expanded));
        drawer.classList.toggle('open', !expanded);
    });

    // ── Tabs ──
    document.querySelectorAll('.exp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            document.querySelectorAll('.exp-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.exp-tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`exp-panel-${target}`)?.classList.add('active');
        });
    });

    // ── Layout selector ──
    document.getElementById('exp-layout-grid')?.addEventListener('click', e => {
        const btn = e.target.closest('.exp-layout-btn');
        if (!btn) return;
        document.querySelectorAll('.exp-layout-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        recSettings.layout = btn.dataset.layout;
    });

    // ── GPX export ──
    document.getElementById('exp-gpx-btn')?.addEventListener('click', () => exportGPX());

    // ── MP4 export ──
    document.getElementById('exp-mp4-btn')?.addEventListener('click', () => startMP4Recording());

    // ── Advanced: Zoom slider ──
    const zoomSlider = document.getElementById('adv-zoom');
    const zoomVal    = document.getElementById('adv-zoom-val');
    zoomSlider?.addEventListener('input', () => {
        const v = parseInt(zoomSlider.value);
        recSettings.zoomKm = v;
        zoomVal.textContent = `${v} km`;
    });

    // ── Advanced: Map style ──
    document.querySelectorAll('.exp-toggle-btn[data-map]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.exp-toggle-btn[data-map]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            recSettings.tileProvider = btn.dataset.map;
        });
    });

    // ── Advanced: Stats overlay toggle ──
    document.getElementById('adv-stats')?.addEventListener('change', e => {
        recSettings.showStats = e.target.checked;
    });

    // ── Advanced: Watermark toggle ──
    document.getElementById('adv-watermark')?.addEventListener('change', e => {
        if (!e.target.checked) {
            // Show modal, don't apply change yet
            e.target.checked = true; // revert visually until user confirms
            openWatermarkModal();
        } else {
            recSettings.showWatermark = true;
        }
    });

    // ── Watermark modal ──
    document.getElementById('wm-modal-close')?.addEventListener('click', () => {
        recSettings.showWatermark = false;
        document.getElementById('adv-watermark').checked = false;
        closeWatermarkModal();
    });
    document.getElementById('wm-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('wm-modal')) closeWatermarkModal();
    });
}

function openWatermarkModal() {
    const modal = document.getElementById('wm-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden','false');
    modal.classList.add('open');
}
function closeWatermarkModal() {
    const modal = document.getElementById('wm-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden','true');
    modal.classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-add-destination').addEventListener('click', addDestination);
    document.getElementById('btn-next').addEventListener('click', goToAdvanced);
    document.getElementById('btn-back-setup').addEventListener('click', backToSetup);
    document.getElementById('btn-start-sim').addEventListener('click', startFinalJourney);
    document.getElementById('playBtn').addEventListener('click', togglePlay);
    document.getElementById('resetBtn').addEventListener('click', resetJourney);
    document.getElementById('btn-speed-down').addEventListener('click', () => changeSpeed(-1));
    document.getElementById('btn-speed-up').addEventListener('click', () => changeSpeed(1));
    document.getElementById('btn-pl').addEventListener('click', () => changeLanguage('pl'));
    document.getElementById('btn-en').addEventListener('click', () => changeLanguage('en'));

    changeLanguage('en');
    initSetupMap();
    initExportPanel();
});
