// ══════════════════════════════════════════════════════════
// MAIN — punkt wejścia aplikacji
// Inicjalizuje mapę, kontrolki i eksponuje funkcje globalnie
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { translations} from './translations.js';
import { preloadRoutes } from './routing.js';
import { animStep, startSegment, finishJourney, placeFlag } from './animation.js';
import {
    addDestination, updateStopsList,
    goToAdvanced, backToSetup,
    dragStart, dragOver, dragEnter, dragLeave, drop, removeStop
} from './setup.js';

// ══════════════════════════════════════════════════════════
// MAPA
// ══════════════════════════════════════════════════════════
export function initMap() {
    if (S.map) return;
    S.setMap(L.map('map', {
        zoomControl: false,
        attributionControl: true,
        center: [62, 18],
        zoom: 4,
    }));
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(S.map);
}

// ══════════════════════════════════════════════════════════
// STATYSTYKI
// ══════════════════════════════════════════════════════════
export function updateStats() {
    const total = S.accumMotoKm + S.accumFerryKm + S.accumTrainKm;
    document.getElementById('stat-total-km').textContent = Math.round(total).toLocaleString('pl-PL');
    document.getElementById('stat-moto-km').textContent  = Math.round(S.accumMotoKm).toLocaleString('pl-PL');
    document.getElementById('stat-ferry-km').textContent = Math.round(S.accumFerryKm).toLocaleString('pl-PL');
    document.getElementById('stat-train-km').textContent = Math.round(S.accumTrainKm).toLocaleString('pl-PL');
    document.getElementById('stat-fuel').textContent     = S.accumFuel.toFixed(1);
    document.getElementById('stat-cost').textContent     = Math.round(S.accumCost).toLocaleString('pl-PL');
}

// ══════════════════════════════════════════════════════════
// START PODRÓŻY (z ekranu konfiguracji kosztów)
// ══════════════════════════════════════════════════════════
export function startFinalJourney() {
    S.uniqueTransports.forEach(type => {
        S.consumptionByType[type] = parseFloat(document.getElementById(`cons-${type}`).value) || 0;
    });
    S.uniqueCountries.forEach(country => {
        S.fuelPricesByCountry[country] = parseFloat(document.getElementById(`price-${country}`).value) || 0;
    });

    document.getElementById('advanced-screen').style.display = 'none';
    document.getElementById('app').style.display = 'grid';

    S.setSTOPS([...S.customStops]);

    // Flagi startowe/końcowe
    S.STOPS.forEach((s, idx) => {
        s.flag = (idx === 0 || idx === S.STOPS.length - 1) ? '🏁' : '🚩';
    });

    // Budowanie listy przystanków w prawym panelu
    const stopListEl = document.getElementById('stop-list');
    stopListEl.innerHTML = '';
    S.STOPS.forEach((s, i) => {
        const cls  = s.type === 'ferry' ? 'ferry-stop' : s.type === 'train' ? 'train-stop' : '';
        const icon = s.type === 'ferry' ? '⛴️' : s.type === 'train' ? '🚂' : s.type === 'auto' ? '🚗' : '🏍️';
        const d = document.createElement('div');
        d.className = `stop-row ${cls}`;
        d.id = `stop-${i}`;
        d.innerHTML = `<div class="stop-dot"></div><span>${icon} ${s.name}</span>`;
        stopListEl.appendChild(d);
    });

    // Tytuł trasy (skrócony jeśli za długi)
    const names = S.STOPS.map(s => s.name);
    const title = names.length > 3
        ? `${names[0]} → ... → ${names[names.length - 1]}`
        : names.join(' → ');
    document.getElementById('route-title').textContent = title;

    document.getElementById('loading').style.display = 'flex';
    initMap();

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            S.map.invalidateSize(true);
            updateStats();
            preloadRoutes();
        });
    });
}

// ══════════════════════════════════════════════════════════
// KONTROLKI ODTWARZANIA
// ══════════════════════════════════════════════════════════
export function togglePlay() {
    if (S.animRunning) {
        S.setAnimRunning(false);
        S.setLastTs(null);
        cancelAnimationFrame(S.animFrame);
        document.getElementById('playBtn').textContent = '▶ WZNÓW';
        document.getElementById('playBtn').classList.remove('active');
    } else {
        S.setAnimRunning(true);
        document.getElementById('playBtn').textContent = '⏸ PAUZA';
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
    document.getElementById('info-stage').textContent = 'GOTOWY DO STARTU';
    document.getElementById('info-sub').textContent   = 'Naciśnij START aby rozpocząć podróż';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('stop-0').classList.add('current');

    placeFlag(S.STOPS[0], 0);
    updateStats();
    S.map.setView([S.STOPS[0].lat, S.STOPS[0].lon], 4, { animate: true });
}

// ══════════════════════════════════════════════════════════
// SYSTEM TŁUMACZEŃ (i18n)
// ══════════════════════════════════════════════════════════
export let currentLang = 'en'; // Angielski jako domyślny

export function changeLanguage(lang) {
    currentLang = lang;
    
    // 1. Podmiana tekstów w HTML
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translatedText = translations[currentLang][key];
        
        if (translatedText) {
            if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
                el.placeholder = translatedText;
            } else {
                el.textContent = translatedText;
            }
        }
    });

    // 2. Aktualizacja wyglądu przycisków PL / EN (żeby było widać, co jest wciśnięte)
    const btnEn = document.getElementById('btn-en');
    const btnPl = document.getElementById('btn-pl');
    
    if (btnEn && btnPl) {
        btnEn.style.background = lang === 'en' ? 'var(--accent)' : 'var(--panel2)';
        btnEn.style.color = lang === 'en' ? 'var(--bg)' : 'var(--text)';
        
        btnPl.style.background = lang === 'pl' ? 'var(--accent)' : 'var(--panel2)';
        btnPl.style.color = lang === 'pl' ? 'var(--bg)' : 'var(--text)';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    
    // --- Ekran 1: Dodawanie przystanków ---
    document.getElementById('btn-add-destination').addEventListener('click', addDestination);
    document.getElementById('btn-next').addEventListener('click', goToAdvanced); // POPRAWIONE ID
    
    // --- Ekran 2: Ustawienia zaawansowane ---
    document.getElementById('btn-back-setup').addEventListener('click', backToSetup); // DODANE
    document.getElementById('btn-start-sim').addEventListener('click', startFinalJourney); // DODANE
    
    // --- Ekran 3: Główny panel (Mapa) ---
    document.getElementById('playBtn').addEventListener('click', togglePlay);
    document.getElementById('resetBtn').addEventListener('click', resetJourney);
    
    // --- Przyciski prędkości ---
    document.getElementById('btn-speed-down').addEventListener('click', () => changeSpeed(-1));
    document.getElementById('btn-speed-up').addEventListener('click', () => changeSpeed(1));
    document.getElementById('btn-pl').addEventListener('click', () => changeLanguage('pl'));
    document.getElementById('btn-en').addEventListener('click', () => changeLanguage('en'));
    
    // Wymuś język domyślny po załadowaniu strony
    changeLanguage('en');

});


