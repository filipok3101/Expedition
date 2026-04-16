import * as S from '../state.js';
import { LAYOUTS, recSettings, LABEL_DURATION, LABEL_FADE, STOP_PAUSE_MS, REC_KM_PER_S } from './config.js';
import { kmToZoom, interpSegPos, downloadBlob, slugify, getNormMercX, getNormMercY } from './utils.js';
import { drawMapTiles, drawCompletedSegments, drawPartialSegment, drawVehicle, drawStopMarker, drawStopLabel, drawHUD, resetHudState } from './video-renderer.js';

// ══════════════════════════════════════════════════════════
// STAN NAGRYWANIA
// ══════════════════════════════════════════════════════════
let recState = {
    canvas: null, ctx: null, recorder: null,
    bufferCanvas: null, bufferCtx: null,
    w: 0, h: 0,
    running: false, segIdx: 0, segFrac: 0,
    startTime: null, rafId: null,
    paused: false, pauseUntil: 0,
    finishing: false,   // flaga: finalizujemy ostatnią klatkę
};

let activeLabels  = [];
let shownLabels   = new Set();
let recLastTs     = null;
let recDrawnUpTo  = 0;
let segStartKm    = [];

// ── Stałe prędkości / fps ──────────────────────────────────
const TARGET_FPS      = 30;
const FRAME_INTERVAL  = 1000 / TARGET_FPS;   // ms
const FIXED_DT        = 1 / TARGET_FPS;      // s – stały krok niezależny od monitora

// ── Minimalna liczba klatek na segment ────────────────────
// Zapobiega "przeskakiwaniu" bardzo krótkich segmentów w jednej klatce
const MIN_FRAMES_PER_SEG = 2;

// ══════════════════════════════════════════════════════════
// POMOCNICZE
// ══════════════════════════════════════════════════════════
function buildSegStartKm() {
    segStartKm = [];
    let acc = 0;
    for (const seg of S.routeSegments) {
        segStartKm.push(acc);
        acc += seg.distKm;
    }
}

function globalProgress(segIdx, segFrac) {
    const total = S.totalMotoKm + S.totalFerryKm;
    if (!total) return 0;
    // Clamp segIdx do zakresu
    const si  = Math.min(segIdx, S.routeSegments.length - 1);
    const sf  = (segIdx >= S.routeSegments.length) ? 1 : segFrac;
    const done = (segStartKm[si] ?? 0) + (S.routeSegments[si]?.distKm ?? 0) * sf;
    return Math.min(1, done / total);
}

function getSimulatedStats(pct) {
    const totalKm = S.totalMotoKm + S.totalFerryKm;
    let totalFuel = 0;
    S.uniqueTransports.forEach(type => {
        if (type === 'ferry') return;
        totalFuel += (totalKm * pct / 100) * (S.consumptionByType[type] || 0);
    });
    let avgPrice = 0, n = 0;
    S.uniqueCountries.forEach(c => { avgPrice += S.fuelPricesByCountry[c] || 0; n++; });
    return { fuel: totalFuel, cost: n > 0 ? totalFuel * (avgPrice / n) : 0 };
}

function checkStopArrivals(segIdx) {
    if (segIdx === 0) return;
    const prevSeg = S.routeSegments[segIdx - 1];
    if (!prevSeg || prevSeg.segTo === '〜') return;
    const toIdx = S.STOPS.findIndex(s => s.name === prevSeg.to);
    if (toIdx < 0 || shownLabels.has(toIdx)) return;
    shownLabels.add(toIdx);
    activeLabels.push({ stopIdx: toIdx, triggeredAt: performance.now() });
    recState.pauseUntil = performance.now() + STOP_PAUSE_MS;
    recState.paused     = true;
}

// ══════════════════════════════════════════════════════════
// RYSOWANIE KLATKI
// ══════════════════════════════════════════════════════════
async function drawFrame(ctx, W, H, segIdx, segFrac, ts, fuel, cost, waitForNetwork = false) {
    const pct = globalProgress(segIdx, segFrac);

    // Pozycja kamery
    let camLat, camLon, camType = 'auto';
    if (segIdx < S.routeSegments.length) {
        const [lat, lon] = interpSegPos(S.routeSegments[segIdx], segFrac);
        camLat = lat; camLon = lon; camType = S.routeSegments[segIdx].type;
    } else {
        // Koniec trasy → ostatni stop
        const last = S.STOPS[S.STOPS.length - 1];
        camLat = last.lat; camLon = last.lon;
    }

    const currentZoom = Math.max(25, recSettings.zoomKm);
    const zoom        = kmToZoom(currentZoom, Math.min(W, H));
    const cMercX      = getNormMercX(camLon);
    const cMercY      = getNormMercY(camLat);

    // Tło
    ctx.fillStyle = '#050709';
    ctx.fillRect(0, 0, W, H);

    // Mapa
    await drawMapTiles(ctx, camLat, camLon, zoom, W, H, waitForNetwork);

    // Narysowane segmenty (≤ recDrawnUpTo)
    drawCompletedSegments(ctx, S.routeSegments, recDrawnUpTo, cMercX, cMercY, zoom, W, H);

    // Aktualny segment (częściowy)
    if (segIdx < S.routeSegments.length) {
        drawPartialSegment(ctx, S.routeSegments[segIdx], segFrac, cMercX, cMercY, zoom, W, H);
    }

    // Flagi przystanków
    let arrivedStopIdx = 0;
    if (recDrawnUpTo > 0) {
        const last = S.routeSegments[recDrawnUpTo - 1];
        const idx  = S.STOPS.findIndex(s => s.name === last?.to);
        if (idx >= 0) arrivedStopIdx = idx;
    }
    // Na końcu trasy pokaż wszystkie flagi
    if (segIdx >= S.routeSegments.length) arrivedStopIdx = S.STOPS.length - 1;

    S.STOPS.forEach((stop, idx) => {
        if (idx <= arrivedStopIdx) drawStopMarker(ctx, stop, cMercX, cMercY, zoom, W, H);
    });

    // Etykiety przystanków (fade in/out)
    const now = performance.now();
    activeLabels = activeLabels.filter(l => now - l.triggeredAt < LABEL_DURATION);
    activeLabels.forEach(({ stopIdx, triggeredAt }) => {
        const age   = now - triggeredAt;
        const alpha = age < LABEL_FADE ? age / LABEL_FADE
            : age > LABEL_DURATION - LABEL_FADE ? (LABEL_DURATION - age) / LABEL_FADE : 1;
        const stop  = S.STOPS[stopIdx];
        if (stop) drawStopLabel(ctx, stop, alpha, cMercX, cMercY, zoom, W, H);
    });

    // Pojazd (tylko gdy jeszcze w trasie)
    if (segIdx < S.routeSegments.length) {
        drawVehicle(ctx, camLat, camLon, camType, cMercX, cMercY, zoom, W, H);
    }

    // HUD
    drawHUD(ctx, W, H, pct, ts - recState.startTime, fuel, cost);
}

// ══════════════════════════════════════════════════════════
// PĘTLA NAGRYWANIA
// ══════════════════════════════════════════════════════════
async function recFrame(ts) {
    if (!recState.running) return;

    // ── Throttle do TARGET_FPS ────────────────────────────
    if (recLastTs === null) recLastTs = ts;
    const elapsed = ts - recLastTs;
    if (elapsed < FRAME_INTERVAL) {
        recState.rafId = requestAnimationFrame(recFrame);
        return;
    }
    recLastTs = ts - (elapsed % FRAME_INTERVAL);

    const { bufferCtx, bufferCanvas, ctx, w, h } = recState;

    // ── Obsługa pauzy przy przystankach ─────────────────
    if (recState.paused) {
        if (ts < recState.pauseUntil) {
            const { fuel, cost } = getSimulatedStats(globalProgress(recState.segIdx, recState.segFrac));
            await drawFrame(bufferCtx, w, h, recState.segIdx, recState.segFrac, ts, fuel, cost, false);
            ctx.drawImage(bufferCanvas, 0, 0);
            recState.rafId = requestAnimationFrame(recFrame);
            return;
        }
        recState.paused = false;
    }

    // ── Koniec trasy – klatka finalizująca ───────────────
    if (recState.segIdx >= S.routeSegments.length) {
        if (!recState.finishing) {
            recState.finishing = true;
            // Upewnij się że recDrawnUpTo obejmuje wszystkie segmenty
            recDrawnUpTo = S.routeSegments.length;

            // Pokaż etykietę ostatniego przystanku
            const lastIdx = S.STOPS.length - 1;
            if (!shownLabels.has(lastIdx)) {
                shownLabels.add(lastIdx);
                activeLabels.push({ stopIdx: lastIdx, triggeredAt: performance.now() });
            }

            const { fuel, cost } = getSimulatedStats(1);
            // Draw final frame with vehicle visible at the destination (last segment, frac=1)
            await drawFrame(bufferCtx, w, h, S.routeSegments.length - 1, 1, ts, fuel, cost, false);
            ctx.drawImage(bufferCanvas, 0, 0);

            await new Promise(r => setTimeout(r, 500));
        }
        stopRecording();
        return;
    }

    // ── Obliczanie postępu segmentu ──────────────────────
    // Dynamiczna prędkość na podstawie zoomu
    const currentZoom  = Math.max(25, recSettings.zoomKm);
    const currentSpeed = Math.min(REC_KM_PER_S, (currentZoom / 40) * REC_KM_PER_S); // km/s animacji

    const seg      = S.routeSegments[recState.segIdx];
    const dist     = Math.max(0.001, seg.distKm);

    // Minimalny przyrost: nigdy nie skakać ponad 0.5 dystansu segmentu w jednej klatce
    // – zapobiega "połykaniu" krótkich segmentów
    const maxStep  = 1 / MIN_FRAMES_PER_SEG;
    const rawStep  = currentSpeed * FIXED_DT / dist;
    const step     = Math.min(rawStep, maxStep);

    recState.segFrac += step;

    // ── Zakończenie segmentu ─────────────────────────────
    if (recState.segFrac >= 1) {
        recState.segFrac = 1;

        // Dociągnij polilinię do końca segmentu
        recDrawnUpTo = recState.segIdx + 1;

        recState.segIdx++;
        recState.segFrac = 0;

        // Don't pause at the final stop — the finishing block handles it cleanly
        if (recState.segIdx < S.routeSegments.length) {
            checkStopArrivals(recState.segIdx);
        }

        // Jeśli to był ostatni segment – następna iteracja obsłuży finalizację
        recState.rafId = requestAnimationFrame(recFrame);
        return;
    }

    // ── Rysuj klatkę ────────────────────────────────────
    const pct         = globalProgress(recState.segIdx, recState.segFrac);
    const { fuel, cost } = getSimulatedStats(pct);

    await drawFrame(bufferCtx, w, h, recState.segIdx, recState.segFrac, ts, fuel, cost, false);
    ctx.drawImage(bufferCanvas, 0, 0);

    recState.rafId = requestAnimationFrame(recFrame);
}

// ══════════════════════════════════════════════════════════
// STEROWANIE NAGRYWANIEM
// ══════════════════════════════════════════════════════════
function stopRecording() {
    if (!recState.running) return;
    recState.running = false;
    cancelAnimationFrame(recState.rafId);
    recState.recorder?.stop();
    // Free precomputed Mercator coords that were added to each segment before recording
    S.routeSegments.forEach(seg => { delete seg.mercCoords; });
    setRecordBtn(false);
    updateExportPanel('');
    resetHudState();
}

function setRecordBtn(rec) {
    const btn = document.getElementById('exp-mp4-btn');
    if (!btn) return;
    btn.textContent       = rec ? '⏹ STOP RECORDING' : '🎬 RECORD VIDEO';
    btn.style.background  = rec ? 'rgba(248,113,113,0.15)' : '';
    btn.style.borderColor = rec ? '#f87171' : '';
    btn.style.color       = rec ? '#f87171' : '';
}

// ══════════════════════════════════════════════════════════
// PUBLICZNE API
// ══════════════════════════════════════════════════════════
export async function startMP4Recording() {
    if (!S.routeSegments.length) { alert('Load a route first.'); return; }

    // Jeśli już nagrywa – zatrzymaj
    if (recState.running) { stopRecording(); return; }

    const { w, h } = LAYOUTS[recSettings.layout];

    // Ogranicz min zoom do 25 km
    recSettings.zoomKm = Math.max(25, recSettings.zoomKm);
    const zoomInput = document.querySelector('#adv-zoom');
    if (zoomInput && Number(zoomInput.value) < 25) {
        zoomInput.value = '25';
        document.getElementById('adv-zoom-val').textContent = '25 km';
    }

    // Pre-kalkulacja współrzędnych Mercatora dla wszystkich segmentów
    S.routeSegments.forEach(seg => {
        if (!seg.mercCoords) {
            seg.mercCoords = seg.coords.map(([lat, lon]) => [
                getNormMercX(lon),
                getNormMercY(lat),
            ]);
        }
    });

    // Reset liczników
    S.resetKm();
    S.routeSegments.forEach(seg => S.addTotalKm(seg.type, seg.distKm));
    buildSegStartKm();

    activeLabels  = [];
    shownLabels   = new Set();
    recDrawnUpTo  = 0;
    recLastTs     = null;
    resetHudState();

    // Etykieta pierwszego przystanku
    shownLabels.add(0);
    activeLabels.push({ stopIdx: 0, triggeredAt: performance.now() });

    // Canvas główny (do MediaRecorder) + bufor (do renderowania)
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');

    const bufferCanvas = document.createElement('canvas');
    bufferCanvas.width = w; bufferCanvas.height = h;
    const bufferCtx = bufferCanvas.getContext('2d');

    // Pre-load kafelków mapy – czekamy żeby pierwsza klatka nie była czarna
    updateExportPanel('⏳ Pre-loading map tiles…');
    await drawFrame(bufferCtx, w, h, 0, 0, performance.now(), 0, 0, true);
    ctx.drawImage(bufferCanvas, 0, 0);

    updateExportPanel('🎬 Preparing…');

    // MediaRecorder
    const stream   = canvas.captureStream(TARGET_FPS);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks   = [];

    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const name = S.tourName || S.STOPS.map(s => s.name).join('-');
        downloadBlob(blob, `expedition-${recSettings.layout}-${slugify(name)}.webm`, 'video/webm');
        updateExportPanel('✅ Download started!');
        setTimeout(() => updateExportPanel(''), 3000);
    };

    recorder.start(100);  // chunk co 100ms

    recState = {
        canvas, ctx, bufferCanvas, bufferCtx, w, h, recorder,
        running:    true,
        segIdx:     0,
        segFrac:    0,
        startTime:  performance.now(),
        rafId:      null,
        paused:     false,
        pauseUntil: 0,
        finishing:  false,
    };

    setRecordBtn(true);
    recState.rafId = requestAnimationFrame(recFrame);
}

function updateExportPanel(msg) {
    const el = document.getElementById('exp-status');
    if (el) el.textContent = msg;
}