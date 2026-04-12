import * as S from '../state.js';
import { recSettings, TILE_PROVIDERS } from './config.js';
import { lonToMercX, latToMercY, geoToPixel } from './utils.js';

const tileCache = new Map();

async function loadTile(x, y, z) {
    const key = `${recSettings.tileProvider}/${z}/${x}/${y}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    return new Promise(resolve => {
        img.onload  = () => { tileCache.set(key, img); resolve(img); };
        img.onerror = () => resolve(null);
        img.src = TILE_PROVIDERS[recSettings.tileProvider](x, y, z);
    });
}

export async function drawMapTiles(ctx, cLat, cLon, zoom, W, H) {
    const TILE = 256;
    const sc   = Math.pow(2, zoom);
    const tX   = lonToMercX(cLon, sc) / TILE;
    const tY   = latToMercY(cLat, sc) / TILE;
    const offX = (tX - Math.floor(tX)) * TILE;
    const offY = (tY - Math.floor(tY)) * TILE;
    const sX   = Math.floor(tX) - Math.ceil(W/2/TILE) - 1;
    const sY   = Math.floor(tY) - Math.ceil(H/2/TILE) - 1;
    const cols = Math.ceil(W/TILE) + 3;
    const rows = Math.ceil(H/TILE) + 3;
    const jobs = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const tx = sX+c, ty = sY+r;
        const px = W/2 - offX + (tx - Math.floor(tX))*TILE;
        const py = H/2 - offY + (ty - Math.floor(tY))*TILE;
        const nx = ((tx%sc)+sc)%sc, ny = ((ty%sc)+sc)%sc;
        jobs.push(loadTile(nx, ny, zoom).then(img => {
            if (img) ctx.drawImage(img, Math.round(px), Math.round(py), TILE, TILE);
        }));
    }
    await Promise.all(jobs);
}

export function drawSegmentLine(ctx, seg, coords, cLat, cLon, zoom, W, H) {
    if (coords.length < 2) return;
    const col = seg.type === 'ferry' ? '#38bdf8' : '#f0a500';
    const w   = Math.max(2, W*0.004);
    ctx.save();
    ctx.strokeStyle=col; ctx.lineWidth=w; ctx.lineCap='round'; ctx.lineJoin='round';
    if (seg.type === 'ferry') ctx.setLineDash([w*2.5, w*2]); else ctx.setLineDash([]);
    ctx.beginPath();
    const f = geoToPixel(coords[0][0], coords[0][1], cLat, cLon, zoom, W, H);
    ctx.moveTo(f.x, f.y);
    for (let i=1; i<coords.length; i++) {
        const p = geoToPixel(coords[i][0], coords[i][1], cLat, cLon, zoom, W, H);
        ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
}

export function drawVehicle(ctx, lat, lon, type, cLat, cLon, zoom, W, H) {
    const p   = geoToPixel(lat, lon, cLat, cLon, zoom, W, H);
    const em  = type === 'ferry' ? '⛴️' : type === 'auto' ? '🚗' : '🏍️';
    const sz  = Math.round(W*0.042);
    const col = type === 'ferry' ? 'rgba(56,189,248,0.6)' : 'rgba(240,165,0,0.6)';
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, sz*0.75, 0, Math.PI*2);
    ctx.strokeStyle=col; ctx.lineWidth=3; ctx.shadowColor=col; ctx.shadowBlur=20; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, sz*0.45, 0, Math.PI*2);
    ctx.fillStyle='rgba(8,11,15,0.88)'; ctx.fill();
    ctx.restore();
    ctx.font=`${sz}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(em, p.x, p.y);
}

export function drawStopMarker(ctx, stop, cLat, cLon, zoom, W, H) {
    const p  = geoToPixel(stop.lat, stop.lon, cLat, cLon, zoom, W, H);
    const fs = Math.round(W*0.024);
    ctx.font=`${fs}px serif`; ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.fillText(stop.flag, p.x, p.y);
}

export function drawStopLabel(ctx, stop, alpha, cLat, cLon, zoom, W, H) {
    const p   = geoToPixel(stop.lat, stop.lon, cLat, cLon, zoom, W, H);
    const fs  = Math.round(W*0.022);
    const pad = fs*0.6;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `bold ${fs}px "Share Tech Mono", monospace`;
    const tw = ctx.measureText(stop.name).width;
    const bw = tw+pad*2, bh = fs*1.65;
    const bx = p.x-bw/2, by = p.y-bh-fs*1.6;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh/2);
    ctx.fillStyle='rgba(8,11,15,0.9)'; ctx.fill();
    ctx.strokeStyle='#4ade80'; ctx.lineWidth=2; ctx.shadowColor='#4ade80'; ctx.shadowBlur=14; ctx.stroke();
    ctx.fillStyle='#4ade80'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.shadowBlur=0;
    ctx.fillText(stop.name, p.x, by+bh/2);
    ctx.beginPath(); ctx.moveTo(p.x, by+bh); ctx.lineTo(p.x, p.y-fs*0.7);
    ctx.strokeStyle='#4ade80'; ctx.lineWidth=1.5; ctx.shadowColor='#4ade80'; ctx.shadowBlur=8; ctx.stroke();
    ctx.restore();
}

let hudCanvas  = null;
let hudLastKey = null;

export function resetHudState() {
    hudLastKey = null;
    hudCanvas = null;
}

function getHudKey(pct, fuel, cost, elapsed) {
    return `${Math.round(pct*200)}_${fuel.toFixed(0)}_${Math.round(cost)}_${Math.floor(elapsed/1000)}`;
}

function ensureHudCanvas(W, H) {
    if (!hudCanvas || hudCanvas.width !== W || hudCanvas.height !== H) {
        hudCanvas = document.createElement('canvas');
        hudCanvas.width = W; hudCanvas.height = H;
        hudLastKey = null;
    }
}

function drawWatermark(ctx, W, H, fs, pad) {
    ctx.font=`${fs*0.32}px "Share Tech Mono",monospace`;
    ctx.fillStyle='rgba(255,255,255,0.22)';
    ctx.textAlign='right'; ctx.textBaseline='bottom'; ctx.shadowBlur=0;
    ctx.fillText('made by 🏍️ EXPEDITION 🚗', W-pad*0.3, H - (recSettings.showStats ? (H>W ? fs*5.8 : fs*3.4)+pad*0.2 : pad*0.2));
}

function renderHudToCache(W, H, pct, elapsed, fuel, cost) {
    const ctx = hudCanvas.getContext('2d');
    ctx.clearRect(0,0,W,H);
    const isV = H > W;
    const fs  = W * 0.026;
    const pad = W * 0.04;

    const barH = fs*2.6;
    ctx.fillStyle = 'rgba(8,11,15,0.86)';
    ctx.fillRect(0,0,W,barH);

    const tourTitle = S.tourName || '🏍️ Expedition 🚗';
    ctx.font = `bold ${fs*0.8}px "Share Tech Mono", monospace`;
    ctx.fillStyle='#f0a500'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='rgba(240,165,0,0.4)'; ctx.shadowBlur=10;
    ctx.fillText(tourTitle, W/2, barH/2);
    ctx.shadowBlur=0;

    if (!recSettings.showStats) {
        if (recSettings.showWatermark) drawWatermark(ctx, W, H, fs, pad);
        return;
    }

    const statsH = isV ? fs*5.8 : fs*3.4;
    ctx.fillStyle='rgba(8,11,15,0.86)';
    ctx.fillRect(0,H-statsH,W,statsH);

    const totalKm = Math.round(S.totalMotoKm + S.totalFerryKm);
    const doneKm  = Math.round(totalKm * pct);
    const stats = [
        { label:'TOTAL',    value:`${totalKm} km` },
        { label:'COVERED',  value:`${doneKm} km`  },
        { label:'PROGRESS', value:`${Math.round(pct*100)}%` },
        { label:'FUEL',     value:`${fuel.toFixed(1)} L`    },
        { label:'COST',     value:`${Math.round(cost)}`     },
    ];
    const cols = isV ? 3 : 5;
    const colW = W/cols;
    const yBase = H-statsH+statsH*0.28;
    stats.slice(0,cols).forEach((st,i) => {
        const cx = colW*i + colW/2;
        ctx.font=`${fs*0.4}px "Share Tech Mono",monospace`;
        ctx.fillStyle='#4a5568'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.shadowBlur=0;
        ctx.fillText(st.label,cx,yBase);
        ctx.font=`bold ${fs*0.72}px "Share Tech Mono",monospace`;
        ctx.fillStyle='#f0a500';
        ctx.fillText(st.value,cx,yBase+fs*0.88);
    });

    const bh = Math.max(4,H*0.007);
    const bw = W*0.9;
    const bx = (W-bw)/2;
    const by = H-bh-statsH*0.1;
    ctx.fillStyle='#1a2030';
    ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,bh/2); ctx.fill();
    if (pct > 0) {
        ctx.fillStyle='#f0a500'; ctx.shadowColor='rgba(240,165,0,0.7)'; ctx.shadowBlur=10;
        ctx.beginPath(); ctx.roundRect(bx,by,bw*pct,bh,bh/2); ctx.fill();
        ctx.shadowBlur=0;
    }

    if (recSettings.showWatermark) drawWatermark(ctx, W, H, fs, pad);
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