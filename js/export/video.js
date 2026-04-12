import * as S from '../state.js';
import { LAYOUTS, recSettings, REC_KM_PER_S, LABEL_DURATION, LABEL_FADE, STOP_PAUSE_MS } from './config.js';
import { kmToZoom, interpSegPos, getPartialCoords, downloadBlob, slugify } from './utils.js';
import { drawMapTiles, drawSegmentLine, drawVehicle, drawStopMarker, drawStopLabel, drawHUD, resetHudState } from './video-renderer.js';

let recState = {
    canvas: null, ctx: null, recorder: null,
    running: false, segIdx: 0, segFrac: 0,
    startTime: null, rafId: null,
    paused: false, pauseUntil: 0,
};

let activeLabels = [];
let shownLabels  = new Set();
let recLastTs    = null;
let recDrawnUpTo = 0;
let segStartKm   = [];

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

async function drawFrame(ctx, W, H, segIdx, segFrac, ts, fuel, cost) {
    const pct = globalProgress(segIdx, segFrac);
    let camLat, camLon, camType = 'auto';

    if (segIdx < S.routeSegments.length) {
        const [lat,lon] = interpSegPos(S.routeSegments[segIdx], segFrac);
        camLat=lat; camLon=lon; camType=S.routeSegments[segIdx].type;
    } else {
        camLat=S.STOPS[S.STOPS.length-1].lat; camLon=S.STOPS[S.STOPS.length-1].lon;
    }

    const zoom = kmToZoom(recSettings.zoomKm, Math.min(W,H));

    ctx.fillStyle='#050709'; ctx.fillRect(0,0,W,H);
    await drawMapTiles(ctx, camLat, camLon, zoom, W, H);

    for (let i=0; i<recDrawnUpTo; i++) {
        const seg = S.routeSegments[i];
        drawSegmentLine(ctx, seg, seg.coords, camLat, camLon, zoom, W, H);
    }

    if (segIdx < S.routeSegments.length) {
        const seg = S.routeSegments[segIdx];
        drawSegmentLine(ctx, seg, getPartialCoords(seg,segFrac), camLat, camLon, zoom, W, H);
    }

    let arrivedStopIdx = 0;
    if (recDrawnUpTo > 0) {
        const last = S.routeSegments[recDrawnUpTo-1];
        const idx  = S.STOPS.findIndex(s => s.name === last?.to);
        if (idx >= 0) arrivedStopIdx = idx;
    }
    S.STOPS.forEach((stop,idx) => {
        if (idx <= arrivedStopIdx) drawStopMarker(ctx, stop, camLat, camLon, zoom, W, H);
    });

    const now = performance.now();
    activeLabels = activeLabels.filter(l => now-l.triggeredAt < LABEL_DURATION);
    activeLabels.forEach(({ stopIdx, triggeredAt }) => {
        const age = now - triggeredAt;
        let alpha = age<LABEL_FADE ? age/LABEL_FADE
            : age>LABEL_DURATION-LABEL_FADE ? (LABEL_DURATION-age)/LABEL_FADE : 1;
        const stop = S.STOPS[stopIdx];
        if (stop) drawStopLabel(ctx, stop, alpha, camLat, camLon, zoom, W, H);
    });

    if (segIdx < S.routeSegments.length) {
        drawVehicle(ctx, camLat, camLon, camType, camLat, camLon, zoom, W, H);
    }

    drawHUD(ctx, W, H, pct, ts - recState.startTime, fuel, cost);
}

async function recFrame(ts) {
    if (!recState.running) return;

    const { ctx } = recState;
    const { w, h } = LAYOUTS[recSettings.layout];

    if (recState.paused) {
        if (ts < recState.pauseUntil) {
            const { fuel, cost } = getSimulatedStats(globalProgress(recState.segIdx, recState.segFrac));
            await drawFrame(ctx, w, h, recState.segIdx, recState.segFrac, ts, fuel, cost);
            recState.rafId = requestAnimationFrame(recFrame);
            return;
        }
        recState.paused = false;
    }

    const dt = recLastTs===null ? 0 : Math.min((ts-recLastTs)/1000, 0.08);
    recLastTs = ts;

    if (recState.segIdx >= S.routeSegments.length) {
        const { fuel, cost } = getSimulatedStats(1);
        await drawFrame(ctx, w, h, S.routeSegments.length, 1, ts, fuel, cost);
        await new Promise(r => setTimeout(r,2000));
        stopRecording();
        return;
    }

    if (dt > 0) {
        const dist = Math.max(0.001, S.routeSegments[recState.segIdx].distKm);
        recState.segFrac += REC_KM_PER_S * dt / dist;
    }

    if (recState.segFrac >= 1) {
        recDrawnUpTo = recState.segIdx + 1;
        recState.segIdx++;
        recState.segFrac = 0;
        checkStopArrivals(recState.segIdx);
    }

    const pct = globalProgress(recState.segIdx, recState.segFrac);
    const { fuel, cost } = getSimulatedStats(pct);

    await drawFrame(ctx, w, h, recState.segIdx, recState.segFrac, ts, fuel, cost);
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

    updateExportPanel('⏳ Pre-loading map tiles…');
    const [sLat,sLon] = S.routeSegments[0].coords[0];
    const zoom = kmToZoom(recSettings.zoomKm, Math.min(w,h));
    await drawMapTiles(ctx, sLat, sLon, zoom, w, h);
    updateExportPanel('🎬 Recording…');

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

    recState = { canvas, ctx, recorder, running:true,
        segIdx:0, segFrac:0, startTime:performance.now(),
        rafId:null, paused:false, pauseUntil:0 };

    setRecordBtn(true);
    recState.rafId = requestAnimationFrame(recFrame);
}

function updateExportPanel(msg) {
    const el = document.getElementById('exp-status');
    if (el) el.textContent = msg;
}