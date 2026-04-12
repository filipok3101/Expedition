import * as S from '../state.js';
import { LAYOUTS, recSettings, LABEL_DURATION, LABEL_FADE, STOP_PAUSE_MS } from './config.js';
import { kmToZoom, interpSegPos, downloadBlob, slugify, getNormMercX, getNormMercY } from './utils.js';
import { drawMapTiles, drawCompletedSegments, drawPartialSegment, drawVehicle, drawStopMarker, drawStopLabel, drawHUD, resetHudState } from './video-renderer.js';

let recState = {
    canvas: null, ctx: null, recorder: null,
    bufferCanvas: null, bufferCtx: null, 
    w: 0, h: 0,
    running: false, segIdx: 0, segFrac: 0,
    startTime: null, rafId: null,
    paused: false, pauseUntil: 0,
};

let activeLabels = [];
let shownLabels  = new Set();
let recLastTs    = null;
let recDrawnUpTo = 0;
let segStartKm   = [];

const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
const FIXED_DT = 1 / TARGET_FPS; // Sztywny czas kroku na klatkę gwarantujący płynność

function buildSegStartKm() {
    segStartKm = []; let acc = 0;
    for (const seg of S.routeSegments) { segStartKm.push(acc); acc += seg.distKm; }
}

function globalProgress(segIdx, segFrac) {
    const total = S.totalMotoKm + S.totalFerryKm;
    if (!total) return 0;
    const done = (segStartKm[segIdx]??0) + (S.routeSegments[segIdx]?.distKm??0)*segFrac;
    return Math.min(1, done/total);
}

function getSimulatedStats(pct) {
    let totalFuel = 0;
    S.uniqueTransports.forEach(type => {
        if (type === 'ferry') return;
        totalFuel += (S.totalMotoKm * pct / 100) * (S.consumptionByType[type] || 0);
    });
    let avgPrice = 0, n = 0;
    S.uniqueCountries.forEach(c => { avgPrice += S.fuelPricesByCountry[c]||0; n++; });
    return { fuel: totalFuel, cost: n>0 ? totalFuel*(avgPrice/n) : 0 };
}

function checkStopArrivals(segIdx) {
    if (segIdx === 0) return;
    const prevSeg = S.routeSegments[segIdx-1];
    if (!prevSeg || prevSeg.segTo === '〜') return;
    const toIdx = S.STOPS.findIndex(s => s.name === prevSeg.to);
    if (toIdx < 0 || shownLabels.has(toIdx)) return;
    shownLabels.add(toIdx);
    activeLabels.push({ stopIdx: toIdx, triggeredAt: performance.now() });
    recState.pauseUntil = performance.now() + STOP_PAUSE_MS;
    recState.paused     = true;
}

// Dodano flagę waitForNetwork do kontrolowania tła
async function drawFrame(ctx, W, H, segIdx, segFrac, ts, fuel, cost, waitForNetwork = false) {
    const pct = globalProgress(segIdx, segFrac);
    let camLat, camLon, camType = 'auto';

    if (segIdx < S.routeSegments.length) {
        const [lat,lon] = interpSegPos(S.routeSegments[segIdx], segFrac);
        camLat=lat; camLon=lon; camType=S.routeSegments[segIdx].type;
    } else {
        camLat=S.STOPS[S.STOPS.length-1].lat; camLon=S.STOPS[S.STOPS.length-1].lon;
    }

    // Twarde wymuszenie minimum 25km zooma na poziomie matematyki rysowania
    const currentZoom = Math.max(25, recSettings.zoomKm);
    const zoom = kmToZoom(currentZoom, Math.min(W,H));
    
    const cMercX = getNormMercX(camLon);
    const cMercY = getNormMercY(camLat);

    ctx.fillStyle='#050709'; ctx.fillRect(0,0,W,H);
    
    // Rysowanie mapy. Podczas nagrywania (waitForNetwork=false) ignoruje wczytywanie
    await drawMapTiles(ctx, camLat, camLon, zoom, W, H, waitForNetwork);

    drawCompletedSegments(ctx, S.routeSegments, recDrawnUpTo, cMercX, cMercY, zoom, W, H);

    if (segIdx < S.routeSegments.length) {
        drawPartialSegment(ctx, S.routeSegments[segIdx], segFrac, cMercX, cMercY, zoom, W, H);
    }

    let arrivedStopIdx = 0;
    if (recDrawnUpTo > 0) {
        const last = S.routeSegments[recDrawnUpTo-1];
        const idx  = S.STOPS.findIndex(s => s.name === last?.to);
        if (idx >= 0) arrivedStopIdx = idx;
    }
    S.STOPS.forEach((stop,idx) => {
        if (idx <= arrivedStopIdx) drawStopMarker(ctx, stop, cMercX, cMercY, zoom, W, H);
    });

    const now = performance.now();
    activeLabels = activeLabels.filter(l => now-l.triggeredAt < LABEL_DURATION);
    activeLabels.forEach(({ stopIdx, triggeredAt }) => {
        const age = now - triggeredAt;
        let alpha = age<LABEL_FADE ? age/LABEL_FADE
            : age>LABEL_DURATION-LABEL_FADE ? (LABEL_DURATION-age)/LABEL_FADE : 1;
        const stop = S.STOPS[stopIdx];
        if (stop) drawStopLabel(ctx, stop, alpha, cMercX, cMercY, zoom, W, H);
    });

    if (segIdx < S.routeSegments.length) {
        drawVehicle(ctx, camLat, camLon, camType, cMercX, cMercY, zoom, W, H);
    }

    drawHUD(ctx, W, H, pct, ts - recState.startTime, fuel, cost);
}

async function recFrame(ts) {
    if (!recState.running) return;

    if (recLastTs === null) recLastTs = ts;
    const elapsed = ts - recLastTs;

    // Throttle do rygorystycznych 30 klatek na sekundę! Eliminuje Judder z szybkich monitorów
    if (elapsed < FRAME_INTERVAL) {
        recState.rafId = requestAnimationFrame(recFrame);
        return;
    }

    recLastTs = ts - (elapsed % FRAME_INTERVAL); // Kompensacja odchyłek
    
    const { ctx, bufferCtx, bufferCanvas, w, h } = recState;

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

    if (recState.segIdx >= S.routeSegments.length) {
        const { fuel, cost } = getSimulatedStats(1);
        await drawFrame(bufferCtx, w, h, S.routeSegments.length, 1, ts, fuel, cost, false);
        ctx.drawImage(bufferCanvas, 0, 0);
        await new Promise(r => setTimeout(r, 2000));
        stopRecording();
        return;
    }

    // Dynamiczna prędkość: wolniej z bliska, z max limiterem na 80 
    const currentZoom = Math.max(25, recSettings.zoomKm);
    const currentSpeed = Math.min(80, (currentZoom / 40) * 80);

    const dist = Math.max(0.001, S.routeSegments[recState.segIdx].distKm);
    
    // Sztywny przyrost dt - zapobiega przeskokom
    recState.segFrac += currentSpeed * FIXED_DT / dist;

    if (recState.segFrac >= 1) {
        recDrawnUpTo = recState.segIdx + 1;
        recState.segIdx++;
        recState.segFrac = 0;
        checkStopArrivals(recState.segIdx);
    }

    const pct = globalProgress(recState.segIdx, recState.segFrac);
    const { fuel, cost } = getSimulatedStats(pct);

    // Renderujemy BEZ zatrzymywania wątku w oczekiwaniu na kafelki mapy (waitForNetwork=false)
    await drawFrame(bufferCtx, w, h, recState.segIdx, recState.segFrac, ts, fuel, cost, false);
    
    ctx.drawImage(bufferCanvas, 0, 0);

    recState.rafId = requestAnimationFrame(recFrame);
}

function stopRecording() {
    recState.running = false;
    cancelAnimationFrame(recState.rafId);
    recState.recorder?.stop();
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

export async function startMP4Recording() {
    if (!S.routeSegments.length) { alert('Load a route first.'); return; }
    if (recState.running) { stopRecording(); return; }

    const { w, h } = LAYOUTS[recSettings.layout];

    // Ogranicz UI przed rozpoczęciem jeśli istnieje HTML-owy slider
    const zoomInput = document.querySelector('input[type="range"][id*="zoom"], input[type="range"][id*="Zoom"]');
    if (zoomInput) {
        zoomInput.min = "25";
        if (Number(zoomInput.value) < 25) zoomInput.value = "25";
    }
    recSettings.zoomKm = Math.max(25, recSettings.zoomKm);

    S.routeSegments.forEach(seg => {
        if (!seg.mercCoords) {
            seg.mercCoords = seg.coords.map(([lat, lon]) => [
                getNormMercX(lon),
                getNormMercY(lat)
            ]);
        }
    });

    S.resetKm();
    S.routeSegments.forEach(seg => S.addTotalKm(seg.type, seg.distKm));
    buildSegStartKm();
    activeLabels=[]; shownLabels=new Set(); recDrawnUpTo=0; recLastTs=null;
    resetHudState();

    shownLabels.add(0);
    activeLabels.push({ stopIdx:0, triggeredAt: performance.now() });

    const canvas = document.createElement('canvas');
    canvas.width=w; canvas.height=h;
    const ctx = canvas.getContext('2d');

    const bufferCanvas = document.createElement('canvas');
    bufferCanvas.width=w; bufferCanvas.height=h;
    const bufferCtx = bufferCanvas.getContext('2d');

    updateExportPanel('⏳ Pre-loading map tiles…');
    const [sLat,sLon] = S.routeSegments[0].coords[0];
    
    // Tylko w pierwszej klatce czekamy na ułożenie się podkładu mapy z internetu (true)
    await drawFrame(bufferCtx, w, h, 0, 0, performance.now(), 0, 0, true);
    ctx.drawImage(bufferCanvas, 0, 0); 
    
    updateExportPanel('🎬 Preparing…');

    const stream   = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond:10_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
        const blob = new Blob(chunks,{type:'video/webm'});
        const name = S.tourName || S.STOPS.map(s=>s.name).join('-');
        downloadBlob(blob, `expedition-${recSettings.layout}-${slugify(name)}.webm`, 'video/webm');
        updateExportPanel('✅ Download started!');
        setTimeout(()=>updateExportPanel(''), 3000);
    };
    recorder.start(100);

    recState = { 
        canvas, ctx, bufferCanvas, bufferCtx, w, h, recorder, running:true,
        segIdx:0, segFrac:0, startTime:performance.now(),
        rafId:null, paused:false, pauseUntil:0 
    };

    setRecordBtn(true);
    recState.rafId = requestAnimationFrame(recFrame);
}

function updateExportPanel(msg) {
    const el = document.getElementById('exp-status');
    if (el) el.textContent = msg;
}