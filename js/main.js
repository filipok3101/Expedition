// ══════════════════════════════════════════════════════════
// MAIN — punkt wejścia aplikacji
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { translations, uiLang } from './translations.js';
import { preloadRoutes } from './routing.js';
import { animStep, startSegment, finishJourney, placeFlag } from './animation.js';
import {
    addDestination, updateStopsList,
    goToAdvanced, backToSetup,
    dragStart, dragOver, dragEnter, dragLeave, drop, removeStop,
    initSetupMap,
} from './setup.js';
import { exportGPX, startMP4Recording } from './export.js';

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
    // Odczyt nazwy trasy
    const tourInput = document.getElementById('tour-name-input');
    S.setTourName(tourInput?.value.trim() || '');

    // Odczyt spalania tylko dla auto/moto
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

    // Lista przystanków w prawym panelu — tylko auto/moto, ferry niewidoczne na liście
    const stopListEl = document.getElementById('stop-list');
    stopListEl.innerHTML = '';
    S.STOPS.forEach((s, i) => {
        const icon = s.type === 'auto' ? '🚗' : '🏍️';
        const d = document.createElement('div');
        d.className = 'stop-row';
        d.id = `stop-${i}`;
        d.innerHTML = `<div class="stop-dot"></div><span>${icon} ${s.name}</span>`;
        stopListEl.appendChild(d);
    });

    const names = S.STOPS.map(s => s.name);
    document.getElementById('route-title').textContent = names.length > 3
        ? `${names[0]} → ... → ${names[names.length - 1]}`
        : names.join(' → ');

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
    S.map.setView([S.STOPS[0].lat, S.STOPS[0].lon], 4, { animate: true });
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

let selectedLayout = 'fullhd';

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

    // Layout selector
    document.getElementById('exp-layout-grid')?.addEventListener('click', e => {
        const btn = e.target.closest('.exp-layout-btn');
        if (!btn) return;
        document.querySelectorAll('.exp-layout-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedLayout = btn.dataset.layout;
    });

    // GPX export
    document.getElementById('exp-gpx-btn')?.addEventListener('click', () => {
        exportGPX();
    });

    // MP4 export
    document.getElementById('exp-mp4-btn')?.addEventListener('click', () => {
        startMP4Recording(selectedLayout);
    });
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