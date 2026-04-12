// ══════════════════════════════════════════════════════════
// EXPORT — GPX generator + MP4 canvas recorder
// v2 — dynamic zoom on vehicle, animated stop labels,
//      global progress bar, tour name support
// ══════════════════════════════════════════════════════════
import * as S from './state.js';

// ── GPX ────────────────────────────────────────────────────

export function exportGPX() {
    if (!S.STOPS.length || !S.routeSegments.length) {
        alert('No route loaded. Please run the simulation first.');
        return;
    }

    const routeName = S.tourName || S.STOPS.map(s => s.name).join(' → ');
    const totalKm   = Math.round(S.totalMotoKm + S.totalFerryKm);
    const now       = new Date().toISOString();

    const wpts = S.STOPS.map(s => `
  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}">
    <name>${escXml(s.name)}</name>
    <desc>${escXml(s.country)} · ${S.transportNames[s.type] ?? s.type}</desc>
  </wpt>`).join('');

    const trkpts = S.routeSegments.flatMap(seg =>
        seg.coords.map(([lat, lon]) =>
            `\n      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>`
        )
    ).join('');

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Expedition Travel Simulator"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escXml(routeName)}</name>
    <desc>Total distance: ${totalKm} km · Road: ${Math.round(S.totalMotoKm)} km · Ferry: ${Math.round(S.totalFerryKm)} km</desc>
    <time>${now}</time>
  </metadata>
${wpts}
  <trk>
    <name>${escXml(routeName)}</name>
    <trkseg>${trkpts}
    </trkseg>
  </trk>
</gpx>`;

    downloadBlob(gpx, `expedition-route-${slugify(routeName)}.gpx`, 'application/gpx+xml');
}

function escXml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ── MP4 constants ──────────────────────────────────────────

const LAYOUTS = {
    tiktok:    { w: 1080, h: 1920 },
    instagram: { w: 1080, h: 1080 },
    fullhd:    { w: 1920, h: 1080 },
};

const REC_KM_PER_S    = 80;   // animation speed km/s
const CAM_RADIUS_KM   = 40;   // viewport radius around vehicle
const LABEL_DURATION  = 2800; // ms stop label stays visible
const LABEL_FADE      = 500;  // ms fade in/out

// ── Tile cache ─────────────────────────────────────────────

const tileCache = new Map();

async function loadTile(x, y, z) {
    const key = `${z}/${x}/${y}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    return new Promise(resolve => {
        img.onload  = () => { tileCache.set(key, img); resolve(img); };
        img.onerror = () => resolve(null);
        const s = ['a','b','c'][Math.abs(x + y) % 3];
        img.src = `https://${s}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
    });
}

// ── Geo math ───────────────────────────────────────────────

function latToMercY(lat, scale) {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * scale * 256;
}
function lonToMercX(lon, scale) { return (lon + 180) / 360 * scale * 256; }

function geoToPixel(lat, lon, cLat, cLon, zoom, W, H) {
    const sc = Math.pow(2, zoom);
    return {
        x: lonToMercX(lon, sc) - lonToMercX(cLon, sc) + W / 2,
        y: latToMercY(lat, sc) - latToMercY(cLat, sc) + H / 2,
    };
}

function kmToZoom(radiusKm, canvasSizePx) {
    const z = Math.log2((canvasSizePx * 40075) / (2 * radiusKm * 256));
    return Math.max(4, Math.min(13, Math.floor(z)));
}

async function drawMapTiles(ctx, cLat, cLon, zoom, W, H) {
    const TILE = 256;
    const sc   = Math.pow(2, zoom);
    const tX   = lonToMercX(cLon, sc) / TILE;
    const tY   = latToMercY(cLat, sc) / TILE;
    const offX = (tX - Math.floor(tX)) * TILE;
    const offY = (tY - Math.floor(tY)) * TILE;
    const sX   = Math.floor(tX) - Math.ceil(W / 2 / TILE) - 1;
    const sY   = Math.floor(tY) - Math.ceil(H / 2 / TILE) - 1;
    const cols = Math.ceil(W / TILE) + 3;
    const rows = Math.ceil(H / TILE) + 3;

    const jobs = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const tx = sX + c, ty = sY + r;
        const px = W / 2 - offX + (tx - Math.floor(tX)) * TILE;
        const py = H / 2 - offY + (ty - Math.floor(tY)) * TILE;
        const nx = ((tx % sc) + sc) % sc, ny = ((ty % sc) + sc) % sc;
        jobs.push(loadTile(nx, ny, zoom).then(img => {
            if (img) ctx.drawImage(img, Math.round(px), Math.round(py), TILE, TILE);
        }));
    }
    await Promise.all(jobs);
}

// ── Segment interpolation ──────────────────────────────────

function interpSegPos(seg, frac) {
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
        coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t,
    ];
}

function getPartialCoords(seg, frac) {
    const { coords, cum, distKm } = seg;
    const target = frac * distKm;
    let hi = 1;
    while (hi < cum.length - 1 && cum[hi] < target) hi++;
    return [...coords.slice(0, hi), interpSegPos(seg, frac)];
}

// ── Global progress ────────────────────────────────────────

let segStartKm = [];

function buildSegStartKm() {
    segStartKm = [];
    let acc = 0;
    for (const seg of S.routeSegments) { segStartKm.push(acc); acc += seg.distKm; }
}

function globalProgress(segIdx, segFrac) {
    const total = S.totalMotoKm + S.totalFerryKm;
    if (!total) return 0;
    const done = (segStartKm[segIdx] ?? 0) + (S.routeSegments[segIdx]?.distKm ?? 0) * segFrac;
    return Math.min(1, done / total);
}

// ── Stats calculation helper ───────────────────────────────
// Zamiast nadpisywać globalny S w module, liczymy to w locie

function getSimulatedStats(pct) {
    let totalFuel = 0;
    S.uniqueTransports.forEach(type => {
        if (type === 'ferry') return;
        totalFuel += (S.totalMotoKm * pct / 100) * (S.consumptionByType[type] || 0);
    });
    
    let avgPrice = 0, n = 0;
    S.uniqueCountries.forEach(c => { avgPrice += S.fuelPricesByCountry[c] || 0; n++; });
    
    const accumCost = n > 0 ? totalFuel * (avgPrice / n) : 0;
    
    return { fuel: totalFuel, cost: accumCost };
}

// ── Drawing helpers ────────────────────────────────────────

function drawSegmentLine(ctx, seg, coords, cLat, cLon, zoom, W, H) {
    if (coords.length < 2) return;
    const col = seg.type === 'ferry' ? '#38bdf8' : '#f0a500';
    const w   = Math.max(2, W * 0.004);
    
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    
    if (seg.type === 'ferry') ctx.setLineDash([w * 2.5, w * 2]);
    else ctx.setLineDash([]);
    
    // ZABÓJCA WYDAJNOŚCI USUNIĘTY:
    // ctx.shadowColor = col; ctx.shadowBlur = w * 3; 

    ctx.beginPath();
    const f = geoToPixel(coords[0][0], coords[0][1], cLat, cLon, zoom, W, H);
    ctx.moveTo(f.x, f.y);
    for (let i = 1; i < coords.length; i++) {
        const p = geoToPixel(coords[i][0], coords[i][1], cLat, cLon, zoom, W, H);
        ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawVehicle(ctx, lat, lon, type, cLat, cLon, zoom, W, H) {
    const p    = geoToPixel(lat, lon, cLat, cLon, zoom, W, H);
    const em   = type === 'ferry' ? '⛴️' : type === 'auto' ? '🚗' : '🏍️';
    const size = Math.round(W * 0.042);
    const col  = type === 'ferry' ? 'rgba(56,189,248,0.6)' : 'rgba(240,165,0,0.6)';
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.75, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.shadowColor = col; ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,11,15,0.88)'; ctx.fill();
    ctx.restore();
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(em, p.x, p.y);
}

function drawStopMarker(ctx, stop, cLat, cLon, zoom, W, H) {
    const p  = geoToPixel(stop.lat, stop.lon, cLat, cLon, zoom, W, H);
    const fs = Math.round(W * 0.024);
    ctx.font = `${fs}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(stop.flag, p.x, p.y);
}

function drawStopLabel(ctx, stop, alpha, cLat, cLon, zoom, W, H) {
    const p   = geoToPixel(stop.lat, stop.lon, cLat, cLon, zoom, W, H);
    const fs  = Math.round(W * 0.022);
    const pad = fs * 0.6;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `bold ${fs}px "Share Tech Mono", monospace`;
    const tw = ctx.measureText(stop.name).width;
    const bw = tw + pad * 2, bh = fs * 1.65;
    const bx = p.x - bw / 2, by = p.y - bh - fs * 1.6;

    // Background
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(8,11,15,0.9)'; ctx.fill();
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
    ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 14;
    ctx.stroke();

    // Text
    ctx.fillStyle = '#4ade80';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.fillText(stop.name, p.x, by + bh / 2);

    // Connector line
    ctx.beginPath();
    ctx.moveTo(p.x, by + bh); ctx.lineTo(p.x, p.y - fs * 0.7);
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();
}


function drawHUD(ctx, W, H, pct, elapsed, currentFuel, currentCost) {
    const isV = H > W;
    const fs  = W * 0.026;
    const pad = W * 0.04;

    // Top bar
    const barH = fs * 2.6;
    ctx.fillStyle = 'rgba(8,11,15,0.86)';
    ctx.fillRect(0, 0, W, barH);

    // ZMIANA 1: Główny napis to nazwa trasy od użytkownika (lub domyślna)
    const tourTitle = S.tourName || 'MOJA WYPRAWA';
    ctx.font = `bold ${fs * 0.8}px "Share Tech Mono", monospace`;
    ctx.fillStyle = '#f0a500'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(240,165,0,0.4)'; ctx.shadowBlur = 10;
    ctx.fillText(tourTitle, W / 2, barH / 2);
    ctx.shadowBlur = 0;

    // Bottom stats
    const statsH = isV ? fs * 5.8 : fs * 3.4;
    ctx.fillStyle = 'rgba(8,11,15,0.86)';
    ctx.fillRect(0, H - statsH, W, statsH);

    const totalKm = Math.round(S.totalMotoKm + S.totalFerryKm);
    const doneKm  = Math.round(totalKm * pct);
    const stats = [
        { label: 'TOTAL',    value: `${totalKm} km` },
        { label: 'COVERED',  value: `${doneKm} km` },
        { label: 'PROGRESS', value: `${Math.round(pct * 100)}%` },
        { label: 'FUEL',     value: `${currentFuel.toFixed(1)} L` },
        { label: 'COST',     value: `${Math.round(currentCost)}` },
    ];
    
    const cols = isV ? 3 : 5;
    const colW = W / cols;
    const yBase = H - statsH + statsH * 0.28;
    stats.slice(0, cols).forEach((st, i) => {
        const cx = colW * i + colW / 2;
        ctx.font = `${fs * 0.4}px "Share Tech Mono", monospace`;
        ctx.fillStyle = '#4a5568'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowBlur = 0;
        ctx.fillText(st.label, cx, yBase);
        ctx.font = `bold ${fs * 0.72}px "Share Tech Mono", monospace`;
        ctx.fillStyle = '#f0a500';
        ctx.fillText(st.value, cx, yBase + fs * 0.88);
    });

    // Global progress bar
    const bh = Math.max(4, H * 0.007);
    const bw = W * 0.9;
    const bx = (W - bw) / 2;
    const by = H - bh - statsH * 0.1;
    ctx.fillStyle = '#1a2030';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh / 2); ctx.fill();
    if (pct > 0) {
        ctx.fillStyle = '#f0a500';
        ctx.shadowColor = 'rgba(240,165,0,0.7)'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.roundRect(bx, by, bw * pct, bh, bh / 2); ctx.fill();
        ctx.shadowBlur = 0;
    }

    
    ctx.font = `${fs * 0.35}px "Share Tech Mono", monospace`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'; // Półprzezroczysty
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('made by 🏍️ EXPEDITION 🚗', W - pad * 0.3, H - statsH - pad * 0.3);
}

// ── Recording state ────────────────────────────────────────

let recState = {
    canvas: null, ctx: null, recorder: null,
    running: false, layout: 'fullhd',
    segIdx: 0, segFrac: 0, startTime: null, rafId: null,
};

let activeLabels  = [];  // [{ stopIdx, triggeredAt }]
let shownLabels   = new Set();
let recLastTs     = null;
let recDrawnUpTo  = 0;

function checkStopArrivals(segIdx) {
    if (segIdx === 0) return;
    const prevSeg = S.routeSegments[segIdx - 1];
    if (!prevSeg || prevSeg.segTo === '〜') return;
    const toIdx = S.STOPS.findIndex(s => s.name === prevSeg.to);
    if (toIdx < 0 || shownLabels.has(toIdx)) return;
    shownLabels.add(toIdx);
    activeLabels.push({ stopIdx: toIdx, triggeredAt: performance.now() });
}

// Zmodyfikowano dodając argumenty currentFuel i currentCost z wartościami domyślnymi
async function drawFrame(ctx, W, H, segIdx, segFrac, ts, currentFuel = 0, currentCost = 0) {
    const pct = globalProgress(segIdx, segFrac);

    // Camera follows vehicle
    let camLat, camLon, camType = 'auto';
    if (segIdx < S.routeSegments.length) {
        const [lat, lon] = interpSegPos(S.routeSegments[segIdx], segFrac);
        camLat = lat; camLon = lon;
        camType = S.routeSegments[segIdx].type;
    } else {
        camLat = S.STOPS[S.STOPS.length - 1].lat;
        camLon = S.STOPS[S.STOPS.length - 1].lon;
    }

    const zoom = kmToZoom(CAM_RADIUS_KM, Math.min(W, H));

    // 1. BG
    ctx.fillStyle = '#050709';
    ctx.fillRect(0, 0, W, H);

    // 2. Map
    await drawMapTiles(ctx, camLat, camLon, zoom, W, H);

    // 3. Completed segments
    for (let i = 0; i < recDrawnUpTo; i++) {
        const seg = S.routeSegments[i];
        drawSegmentLine(ctx, seg, seg.coords, camLat, camLon, zoom, W, H);
    }

    // 4. Current partial segment
    if (segIdx < S.routeSegments.length) {
        const seg = S.routeSegments[segIdx];
        drawSegmentLine(ctx, seg, getPartialCoords(seg, segFrac), camLat, camLon, zoom, W, H);
    }

    // 5. Stop markers — only visited stops
    // Find which stop idx we've arrived at
    let arrivedStopIdx = 0;
    if (recDrawnUpTo > 0) {
        const lastFinishedSeg = S.routeSegments[recDrawnUpTo - 1];
        const idx = S.STOPS.findIndex(s => s.name === lastFinishedSeg?.to);
        if (idx >= 0) arrivedStopIdx = idx;
    }
    S.STOPS.forEach((stop, idx) => {
        if (idx <= arrivedStopIdx) drawStopMarker(ctx, stop, camLat, camLon, zoom, W, H);
    });

    // 6. Animated labels
    const now = performance.now();
    activeLabels = activeLabels.filter(l => now - l.triggeredAt < LABEL_DURATION);
    activeLabels.forEach(({ stopIdx, triggeredAt }) => {
        const age = now - triggeredAt;
        let alpha = age < LABEL_FADE
            ? age / LABEL_FADE
            : age > LABEL_DURATION - LABEL_FADE
                ? (LABEL_DURATION - age) / LABEL_FADE
                : 1;
        const stop = S.STOPS[stopIdx];
        if (stop) drawStopLabel(ctx, stop, alpha, camLat, camLon, zoom, W, H);
    });

    // 7. Vehicle
    if (segIdx < S.routeSegments.length) {
        drawVehicle(ctx, camLat, camLon, camType, camLat, camLon, zoom, W, H);
    }

    // 8. HUD
    drawHUD(ctx, W, H, pct, ts - recState.startTime, currentFuel, currentCost);
}

async function recFrame(ts) {
    if (!recState.running) return;

    const dt = recLastTs === null ? 0 : Math.min((ts - recLastTs) / 1000, 0.08);
    recLastTs = ts;
    const { ctx, layout } = recState;
    const { w, h } = LAYOUTS[layout];

    if (recState.segIdx >= S.routeSegments.length) {
        // Gdy koniec animacji, policz statystyki końcowe
        const { fuel, cost } = getSimulatedStats(1);
        await drawFrame(ctx, w, h, S.routeSegments.length, 1, ts, fuel, cost);
        await new Promise(r => setTimeout(r, 2000));
        stopRecording();
        return;
    }

    if (dt > 0) {
        // Dodano dzielenie z zabezpieczeniem przed wybuchem gdy dist = 0
        const dist = Math.max(0.001, S.routeSegments[recState.segIdx].distKm);
        recState.segFrac += REC_KM_PER_S * dt / dist;
    }

    if (recState.segFrac >= 1) {
        recDrawnUpTo = recState.segIdx + 1;
        recState.segIdx++;
        recState.segFrac = 0;
        checkStopArrivals(recState.segIdx);
    }

    // Oblicz statystyki procentowo (bez nadpisywania S)
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
}

function setRecordBtn(rec) {
    const btn = document.getElementById('exp-mp4-btn');
    if (!btn) return;
    btn.textContent       = rec ? '⏹ STOP RECORDING' : '🎬 RECORD VIDEO';
    btn.style.background  = rec ? 'rgba(248,113,113,0.15)' : '';
    btn.style.borderColor = rec ? '#f87171' : '';
    btn.style.color       = rec ? '#f87171' : '';
}

export async function startMP4Recording(layout = 'fullhd') {
    if (!S.routeSegments.length) { alert('Load a route first.'); return; }
    if (recState.running) { stopRecording(); return; }

    const { w, h } = LAYOUTS[layout];

    // Reset
    S.resetKm();
    S.routeSegments.forEach(seg => S.addTotalKm(seg.type, seg.distKm));
    buildSegStartKm();
    activeLabels  = [];
    shownLabels   = new Set();
    recDrawnUpTo  = 0;
    recLastTs     = null;

    // Show label for departure stop immediately
    shownLabels.add(0);
    activeLabels.push({ stopIdx: 0, triggeredAt: performance.now() });

    // Canvas
    const canvas  = document.createElement('canvas');
    canvas.width  = w; canvas.height = h;
    const ctx     = canvas.getContext('2d');

    // Pre-warm tiles at start location
    updateExportPanel('⏳ Pre-loading map tiles…');
    const [sLat, sLon] = S.routeSegments[0].coords[0];
    const zoom = kmToZoom(CAM_RADIUS_KM, Math.min(w, h));
    await drawMapTiles(ctx, sLat, sLon, zoom, w, h);
    updateExportPanel('🎬 Preparing...');

    // MediaRecorder
    const stream   = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const name = S.tourName || S.STOPS.map(s => s.name).join('-');
        downloadBlob(blob, `expedition-${layout}-${slugify(name)}.webm`, 'video/webm');
        updateExportPanel('✅ Download started!');
        setTimeout(() => updateExportPanel(''), 3000);
    };
    recorder.start(100);

    recState = { canvas, ctx, recorder, running: true, layout,
        segIdx: 0, segFrac: 0, startTime: performance.now(), rafId: null };

    setRecordBtn(true);
    recState.rafId = requestAnimationFrame(recFrame);
}

function updateExportPanel(msg) {
    const el = document.getElementById('exp-status');
    if (el) el.textContent = msg;
}

function downloadBlob(data, filename, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}