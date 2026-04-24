import * as S from '../state.js';
import { recSettings, TILE_PROVIDERS } from './config.js';
import { getNormMercX, getNormMercY, geoToPixelFast } from './utils.js';

// ══════════════════════════════════════════════════════════
// CACHE KAFELKÓW MAPY (LRU, max 200 wpisów ≈ ~50 MB)
// ══════════════════════════════════════════════════════════
const MAX_TILE_CACHE = 200;
const tileCache    = new Map();
const pendingTiles = new Set();   // klucze aktualnie pobieranych

function loadTileAsync(x, y, z) {
    const key = `${recSettings.tileProvider}/${z}/${x}/${y}`;
    if (tileCache.has(key)) {
        // LRU: move to most-recently-used position (Map preserves insertion order)
        const img = tileCache.get(key);
        tileCache.delete(key);
        tileCache.set(key, img);
        return Promise.resolve(img);
    }
    if (pendingTiles.has(key)) return Promise.resolve(null); // już się ładuje

    pendingTiles.add(key);
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            // Evict the oldest (first) entry when at capacity
            if (tileCache.size >= MAX_TILE_CACHE) {
                tileCache.delete(tileCache.keys().next().value);
            }
            tileCache.set(key, img);
            pendingTiles.delete(key);
            resolve(img);
        };
        img.onerror = () => {
            pendingTiles.delete(key);
            resolve(null);
        };
        img.src = TILE_PROVIDERS[recSettings.tileProvider](x, y, z);
    });
}

/**
 * Rysuje kafelki mapy.
 *
 * waitForNetwork = true  → używane TYLKO przy pierwszej klatce (pre-load)
 * waitForNetwork = false → pętla nagrywania: kafelki załadowane → rysuję,
 *                          niezaładowane → ładuję w tle, pomijam w tej klatce
 *                          (bez blokowania rAF)
 */
export async function drawMapTiles(ctx, cLat, cLon, zoom, W, H, waitForNetwork = false) {
    const TILE = 256;
    const sc   = Math.pow(2, zoom);
    const cMercX = getNormMercX(cLon);
    const cMercY = getNormMercY(cLat);

    const tX   = cMercX * sc / TILE;
    const tY   = cMercY * sc / TILE;
    const offX = (tX - Math.floor(tX)) * TILE;
    const offY = (tY - Math.floor(tY)) * TILE;
    const sX   = Math.floor(tX) - Math.ceil(W / 2 / TILE) - 1;
    const sY   = Math.floor(tY) - Math.ceil(H / 2 / TILE) - 1;
    const cols = Math.ceil(W / TILE) + 3;
    const rows = Math.ceil(H / TILE) + 3;

    const asyncJobs = [];  // tylko przy waitForNetwork

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const tx = sX + c;
            const ty = sY + r;
            const px = W / 2 - offX + (tx - Math.floor(tX)) * TILE;
            const py = H / 2 - offY + (ty - Math.floor(tY)) * TILE;
            const nx = ((tx % sc) + sc) % sc;
            const ny = ((ty % sc) + sc) % sc;
            const key = `${recSettings.tileProvider}/${zoom}/${nx}/${ny}`;

            if (tileCache.has(key)) {
                // Cache hit – rysuj natychmiast
                ctx.drawImage(tileCache.get(key), Math.round(px), Math.round(py), TILE, TILE);
            } else if (waitForNetwork) {
                // Pre-load: zbieramy obietnice, czekamy
                asyncJobs.push(loadTileAsync(nx, ny, zoom).then(img => {
                    if (img) ctx.drawImage(img, Math.round(px), Math.round(py), TILE, TILE);
                }));
            } else {
                // Hot path: wyzwalamy ładowanie w tle, nie blokujemy klatki
                loadTileAsync(nx, ny, zoom);
            }
        }
    }

    if (asyncJobs.length) await Promise.all(asyncJobs);
}

// ══════════════════════════════════════════════════════════
// RYSOWANIE TRAS
// ══════════════════════════════════════════════════════════
export function drawCompletedSegments(ctx, segments, drawnUpTo, cMercX, cMercY, zoom, W, H) {
    if (drawnUpTo === 0) return;
    const sc = Math.pow(2, zoom);
    const w  = Math.max(2, W * 0.004);

    ctx.save();
    ctx.lineWidth  = w;
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';

    // ── Drogi (road/auto/moto) ──
    const roadColor = segments.slice(0, drawnUpTo).find(s => s.type !== 'ferry')?.color ?? '#f0a500';
    ctx.strokeStyle = roadColor;
    ctx.setLineDash([]);
    ctx.beginPath();
    let hasSolid = false;

    for (let i = 0; i < drawnUpTo; i++) {
        const seg = segments[i];
        if (seg.type === 'ferry' || !seg.mercCoords || seg.mercCoords.length < 2) continue;
        const mc = seg.mercCoords;
        ctx.moveTo((mc[0][0] - cMercX) * sc + W / 2, (mc[0][1] - cMercY) * sc + H / 2);
        for (let j = 1; j < mc.length; j++) {
            ctx.lineTo((mc[j][0] - cMercX) * sc + W / 2, (mc[j][1] - cMercY) * sc + H / 2);
        }
        hasSolid = true;
    }
    if (hasSolid) ctx.stroke();

    // ── Promy ──
    ctx.strokeStyle = '#38bdf8';
    ctx.setLineDash([w * 2.5, w * 2]);
    ctx.beginPath();
    let hasFerry = false;

    for (let i = 0; i < drawnUpTo; i++) {
        const seg = segments[i];
        if (seg.type !== 'ferry' || !seg.mercCoords || seg.mercCoords.length < 2) continue;
        const mc = seg.mercCoords;
        ctx.moveTo((mc[0][0] - cMercX) * sc + W / 2, (mc[0][1] - cMercY) * sc + H / 2);
        for (let j = 1; j < mc.length; j++) {
            ctx.lineTo((mc[j][0] - cMercX) * sc + W / 2, (mc[j][1] - cMercY) * sc + H / 2);
        }
        hasFerry = true;
    }
    if (hasFerry) ctx.stroke();

    ctx.restore();
}

export function drawPartialSegment(ctx, seg, frac, cMercX, cMercY, zoom, W, H) {
    if (!seg.mercCoords || seg.mercCoords.length < 2) return;
    const sc  = Math.pow(2, zoom);
    const frc = Math.max(0, Math.min(1, frac));

    // Wyznacz punkt końcowy na podstawie frac
    const target = frc * seg.distKm;
    let hi = 1;
    while (hi < seg.cum.length - 1 && seg.cum[hi] < target) hi++;
    const lo = hi - 1;
    const t  = (target - seg.cum[lo]) / (seg.cum[hi] - seg.cum[lo] + 1e-12);
    const endX = seg.mercCoords[lo][0] + (seg.mercCoords[hi][0] - seg.mercCoords[lo][0]) * t;
    const endY = seg.mercCoords[lo][1] + (seg.mercCoords[hi][1] - seg.mercCoords[lo][1]) * t;

    const w = Math.max(2, W * 0.004);
    ctx.save();
    ctx.strokeStyle = seg.type === 'ferry' ? '#38bdf8' : (seg.color ?? '#f0a500');
    ctx.lineWidth   = w;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    if (seg.type === 'ferry') ctx.setLineDash([w * 2.5, w * 2]);

    ctx.beginPath();
    const mc = seg.mercCoords;
    ctx.moveTo((mc[0][0] - cMercX) * sc + W / 2, (mc[0][1] - cMercY) * sc + H / 2);
    for (let j = 1; j < hi; j++) {
        ctx.lineTo((mc[j][0] - cMercX) * sc + W / 2, (mc[j][1] - cMercY) * sc + H / 2);
    }
    ctx.lineTo((endX - cMercX) * sc + W / 2, (endY - cMercY) * sc + H / 2);
    ctx.stroke();
    ctx.restore();
}

// ══════════════════════════════════════════════════════════
// POJAZD I FLAGI
// ══════════════════════════════════════════════════════════
export function drawVehicle(ctx, lat, lon, type, cMercX, cMercY, zoom, W, H) {
    const p   = geoToPixelFast(lat, lon, cMercX, cMercY, zoom, W, H);
    const em  = type === 'ferry' ? '⛴️' : type === 'auto' ? '🚗' : '🏍️';
    const sz  = Math.round(W * 0.042);
    const col = type === 'ferry' ? 'rgba(56,189,248,0.6)' : 'rgba(240,165,0,0.6)';

    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, sz * 0.75, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.shadowColor = col; ctx.shadowBlur = 20;
    ctx.stroke();

    ctx.beginPath(); ctx.arc(p.x, p.y, sz * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,11,15,0.88)'; ctx.fill();
    ctx.restore();

    ctx.font = `${sz}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(em, p.x, p.y);
}

export function drawStopMarker(ctx, stop, cMercX, cMercY, zoom, W, H) {
    const p  = geoToPixelFast(stop.lat, stop.lon, cMercX, cMercY, zoom, W, H);
    const fs = Math.round(W * 0.024);
    ctx.font = `${fs}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(stop.flag, p.x, p.y);
}

export function drawStopLabel(ctx, stop, alpha, cMercX, cMercY, zoom, W, H) {
    const p   = geoToPixelFast(stop.lat, stop.lon, cMercX, cMercY, zoom, W, H);
    const fs  = Math.round(W * 0.022);
    const pad = fs * 0.6;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `bold ${fs}px "Share Tech Mono", monospace`;
    const tw = ctx.measureText(stop.name).width;
    const bw = tw + pad * 2, bh = fs * 1.65;
    const bx = p.x - bw / 2, by = p.y - bh - fs * 1.6;

    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(8,11,15,0.9)'; ctx.fill();
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
    ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 14;
    ctx.stroke();

    ctx.fillStyle = '#4ade80'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowBlur = 0;
    ctx.fillText(stop.name, p.x, by + bh / 2);

    ctx.beginPath(); ctx.moveTo(p.x, by + bh); ctx.lineTo(p.x, p.y - fs * 0.7);
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();
}

// ══════════════════════════════════════════════════════════
// HUD (cache'owany – przerysowywany tylko przy zmianie wartości)
// ══════════════════════════════════════════════════════════
let hudCanvas  = null;
let hudLastKey = null;

export function resetHudState() {
    hudCanvas  = null;
    hudLastKey = null;
}

function getHudKey(pct, fuel, cost, elapsed) {
    // Klucz zmienia się max co 1s i co 0.5% postępu – eliminuje zbędne przerysowania
    return `${Math.round(pct * 200)}_${fuel.toFixed(0)}_${Math.round(cost)}_${Math.floor(elapsed / 1000)}`;
}

function ensureHudCanvas(W, H) {
    if (!hudCanvas || hudCanvas.width !== W || hudCanvas.height !== H) {
        hudCanvas  = document.createElement('canvas');
        hudCanvas.width = W; hudCanvas.height = H;
        hudLastKey = null;
    }
}

function drawWatermark(ctx, W, H, fs) {
    ctx.font = `${fs * 0.32}px "Share Tech Mono",monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.shadowBlur = 0;
    const pad = W * 0.02;
    const bottomOffset = recSettings.showStats ? (H > W ? fs * 5.8 : fs * 3.4) + pad : pad;
    ctx.fillText('made by 🏍️ EXPEDITION 🚗', W - pad, H - bottomOffset);
}

function renderHudToCache(W, H, pct, elapsed, fuel, cost) {
    const ctx  = hudCanvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const isV  = H > W;
    const fs   = W * 0.026;
    const pad  = W * 0.04;
    const barH = fs * 2.6;

    // ── Górny pasek z tytułem ──
    ctx.fillStyle = 'rgba(8,11,15,0.86)';
    ctx.fillRect(0, 0, W, barH);

    const tourTitle = S.tourName || '🏍️ Expedition 🚗';
    ctx.font = `bold ${fs * 0.8}px "Share Tech Mono", monospace`;
    ctx.fillStyle = '#f0a500'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(240,165,0,0.4)'; ctx.shadowBlur = 10;
    ctx.fillText(tourTitle, W / 2, barH / 2);
    ctx.shadowBlur = 0;

    if (!recSettings.showStats) {
        if (recSettings.showWatermark) drawWatermark(ctx, W, H, fs);
        return;
    }

    // ── Dolny panel statystyk ──
    const statsH = isV ? fs * 5.8 : fs * 3.4;
    ctx.fillStyle = 'rgba(8,11,15,0.86)';
    ctx.fillRect(0, H - statsH, W, statsH);

    const totalKm = Math.round(S.totalMotoKm + S.totalFerryKm);
    const doneKm  = Math.round(totalKm * pct);
    const stats   = [
        { label: 'TOTAL',    value: `${totalKm} km` },
        { label: 'COVERED',  value: `${doneKm} km`  },
        { label: 'PROGRESS', value: `${Math.round(pct * 100)}%` },
        { label: 'FUEL',     value: `${fuel.toFixed(1)} L`      },
        { label: 'COST',     value: `${Math.round(cost)}`       },
    ];
    const cols  = isV ? 3 : 5;
    const colW  = W / cols;
    const yBase = H - statsH + statsH * 0.28;

    stats.slice(0, cols).forEach((st, i) => {
        const cx = colW * i + colW / 2;
        ctx.font = `${fs * 0.4}px "Share Tech Mono",monospace`;
        ctx.fillStyle = '#4a5568'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowBlur = 0;
        ctx.fillText(st.label, cx, yBase);
        ctx.font = `bold ${fs * 0.72}px "Share Tech Mono",monospace`;
        ctx.fillStyle = '#f0a500';
        ctx.fillText(st.value, cx, yBase + fs * 0.88);
    });

    // ── Pasek postępu ──
    const bh = Math.max(4, H * 0.007);
    const bw = W * 0.9;
    const bx = (W - bw) / 2;
    const by = H - bh - statsH * 0.1;

    ctx.fillStyle = '#1a2030';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh / 2); ctx.fill();

    if (pct > 0) {
        ctx.fillStyle = '#f0a500';
        ctx.shadowColor = 'rgba(240,165,0,0.7)'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.roundRect(bx, by, bw * Math.min(pct, 1), bh, bh / 2); ctx.fill();
        ctx.shadowBlur = 0;
    }

    if (recSettings.showWatermark) drawWatermark(ctx, W, H, fs);
}

export function drawHUD(ctx, W, H, pct, elapsed, fuel, cost) {
    ensureHudCanvas(W, H);
    const key = getHudKey(pct, fuel, cost, elapsed);
    if (key !== hudLastKey) {
        renderHudToCache(W, H, pct, elapsed, fuel, cost);
        hudLastKey = key;
    }
    ctx.drawImage(hudCanvas, 0, 0);
}