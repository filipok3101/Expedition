// ══════════════════════════════════════════════════════════
// EXPORT WIDEO — MP4 / GIF / WebM (fallback)
//
// Architektura:
//  1. walkFrames(fps) — deterministyczny generator stanów klatek
//     (pozycja pojazdu, pauzy na przystankach, etykiety, finałowy hold).
//     Czas liczony W CZASIE FILMU (nr klatki / fps), nie zegarem —
//     dzięki temu wynik jest identyczny niezależnie od tempa renderu.
//  2. Tryb offline (MP4/GIF): pętla async renderuje klatki tak szybko,
//     jak to możliwe i karmi enkoder z encoders.js.
//  3. Tryb realtime (WebM): gdy brak WebCodecs — MediaRecorder +
//     canvas.captureStream, ten sam generator taktowany rAF-em.
// ══════════════════════════════════════════════════════════
import * as S from '../state.js';
import {
    LAYOUTS, recSettings, LABEL_DURATION, LABEL_FADE, STOP_PAUSE_MS,
    FINAL_HOLD_MS, MIN_FRAMES_PER_SEG, REC_KM_PER_S, VIDEO_FPS, GIF_FPS,
} from './config.js';
import { kmToZoom, interpSegPos, downloadBlob, slugify, getNormMercX, getNormMercY } from './utils.js';
import {
    drawMapTiles, drawCompletedSegments, drawPartialSegment, drawVehicle,
    drawStopMarker, drawStopLabel, drawHUD, resetHudState,
} from './video-renderer.js';
import { createMp4Encoder, createGifEncoder } from './encoders.js';
import { t } from '../translations.js';

// ── Stan exportu ───────────────────────────────────────────
let exporting       = false;
let cancelRequested = false;
let activeLabels    = [];   // { stopIdx, triggeredAtMs } — ms czasu filmu
let segStartKm      = [];

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
    const si   = Math.min(segIdx, S.routeSegments.length - 1);
    const sf   = (segIdx >= S.routeSegments.length) ? 1 : segFrac;
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

// ══════════════════════════════════════════════════════════
// GENERATOR KLATEK
// Stan klatki: { segIdx, segFrac, drawnUpTo, label, final }
//   label — indeks przystanku, którego etykietę wyzwolić w tej klatce
// ══════════════════════════════════════════════════════════
function* walkFrames(fps) {
    const segs        = S.routeSegments;
    const dt          = 1 / fps;
    const pauseFrames = Math.max(1, Math.round(STOP_PAUSE_MS / 1000 * fps));
    const holdFrames  = Math.max(1, Math.round(FINAL_HOLD_MS / 1000 * fps));
    const zoomKm      = Math.max(25, recSettings.zoomKm);
    const speed       = Math.min(REC_KM_PER_S, (zoomKm / 40) * REC_KM_PER_S); // km/s filmu
    const maxStep     = 1 / MIN_FRAMES_PER_SEG;   // krótkie segmenty nie znikają w 1 klatce
    const shown       = new Set([0]);

    let segIdx = 0, segFrac = 0, drawnUpTo = 0;

    // Klatka startowa — pojazd na starcie + etykieta pierwszego przystanku
    yield { segIdx, segFrac, drawnUpTo, label: 0, final: false };

    while (segIdx < segs.length) {
        const dist = Math.max(0.001, segs[segIdx].distKm);
        segFrac   += Math.min(speed * dt / dist, maxStep);

        if (segFrac >= 1) {
            drawnUpTo = segIdx + 1;
            segIdx++;
            segFrac = 0;

            // Pauza + etykieta przy dotarciu do przystanku użytkownika
            if (segIdx < segs.length) {
                const prev = segs[segIdx - 1];
                if (prev.segTo !== '〜') {
                    const toIdx = S.STOPS.findIndex(s => s.name === prev.to);
                    if (toIdx > 0 && !shown.has(toIdx)) {
                        shown.add(toIdx);
                        yield { segIdx, segFrac: 0, drawnUpTo, label: toIdx, final: false };
                        for (let p = 1; p < pauseFrames; p++)
                            yield { segIdx, segFrac: 0, drawnUpTo, label: null, final: false };
                    }
                }
            }
            continue;
        }

        yield { segIdx, segFrac, drawnUpTo, label: null, final: false };
    }

    // Finał — pojazd na mecie, wszystkie flagi, etykieta celu, hold
    const lastStopIdx = S.STOPS.length - 1;
    const needLabel   = !shown.has(lastStopIdx);
    for (let i = 0; i < holdFrames; i++) {
        yield {
            segIdx:    segs.length - 1,
            segFrac:   1,
            drawnUpTo: segs.length,
            label:     (i === 0 && needLabel) ? lastStopIdx : null,
            final:     true,
        };
    }
}

function countFrames(fps) {
    let n = 0;
    for (const _ of walkFrames(fps)) n++;
    return n;
}

// ══════════════════════════════════════════════════════════
// RYSOWANIE KLATKI (czas = ms filmu)
// ══════════════════════════════════════════════════════════
async function drawFrame(ctx, W, H, st, mediaMs, fuel, cost, waitForNetwork) {
    const pct = globalProgress(st.final ? S.routeSegments.length : st.segIdx, st.segFrac);

    // Pozycja kamery / pojazdu
    const seg = S.routeSegments[st.segIdx];
    const [camLat, camLon] = interpSegPos(seg, st.segFrac);
    const camType = seg.type;

    const zoom   = kmToZoom(Math.max(25, recSettings.zoomKm), Math.min(W, H));
    const cMercX = getNormMercX(camLon);
    const cMercY = getNormMercY(camLat);

    // Tło
    ctx.fillStyle = '#050709';
    ctx.fillRect(0, 0, W, H);

    // Mapa
    await drawMapTiles(ctx, camLat, camLon, zoom, W, H, waitForNetwork);

    // Ukończone segmenty
    drawCompletedSegments(ctx, S.routeSegments, st.drawnUpTo, cMercX, cMercY, zoom, W, H);

    // Bieżący segment (częściowy)
    if (!st.final && st.segFrac > 0) {
        drawPartialSegment(ctx, seg, st.segFrac, cMercX, cMercY, zoom, W, H);
    }

    // Flagi przystanków, do których już dotarliśmy
    let arrivedStopIdx = 0;
    if (st.drawnUpTo > 0) {
        const last = S.routeSegments[st.drawnUpTo - 1];
        const idx  = S.STOPS.findIndex(s => s.name === last?.to);
        if (idx >= 0) arrivedStopIdx = idx;
    }
    if (st.final) arrivedStopIdx = S.STOPS.length - 1;

    S.STOPS.forEach((stop, idx) => {
        if (idx <= arrivedStopIdx) drawStopMarker(ctx, stop, cMercX, cMercY, zoom, W, H);
    });

    // Etykiety przystanków (fade in/out — czas filmu)
    activeLabels = activeLabels.filter(l => mediaMs - l.triggeredAtMs < LABEL_DURATION);
    activeLabels.forEach(({ stopIdx, triggeredAtMs }) => {
        const age   = mediaMs - triggeredAtMs;
        const alpha = age < LABEL_FADE ? age / LABEL_FADE
            : age > LABEL_DURATION - LABEL_FADE ? (LABEL_DURATION - age) / LABEL_FADE : 1;
        const stop  = S.STOPS[stopIdx];
        if (stop) drawStopLabel(ctx, stop, alpha, cMercX, cMercY, zoom, W, H);
    });

    // Pojazd
    drawVehicle(ctx, camLat, camLon, camType, cMercX, cMercY, zoom, W, H);

    // HUD
    drawHUD(ctx, W, H, pct, mediaMs, fuel, cost);
}

function renderState(st, mediaMs) {
    if (st.label !== null) activeLabels.push({ stopIdx: st.label, triggeredAtMs: mediaMs });
    const pct = globalProgress(st.final ? S.routeSegments.length : st.segIdx, st.segFrac);
    return getSimulatedStats(pct);
}

// ══════════════════════════════════════════════════════════
// TRYB OFFLINE — MP4 / GIF (szybciej niż czas rzeczywisty)
// ══════════════════════════════════════════════════════════
async function runOfflineExport(encoder, w, h, fps) {
    const canvas  = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx     = canvas.getContext('2d');

    const totalFrames = countFrames(fps);
    let frameIdx      = 0;

    updateExportPanel(t('exp_status_tiles'));

    for (const st of walkFrames(fps)) {
        if (cancelRequested) {
            encoder.cancel();
            updateExportPanel(t('exp_status_cancelled'));
            return;
        }

        const mediaMs        = frameIdx / fps * 1000;
        const { fuel, cost } = renderState(st, mediaMs);

        // waitForNetwork=true — deterministyczna kompletność kafelków
        // (cache trafia niemal zawsze, więc nie spowalnia istotnie)
        await drawFrame(ctx, w, h, st, mediaMs, fuel, cost, true);
        await encoder.addFrame(canvas, frameIdx);
        frameIdx++;

        if (frameIdx % 5 === 0) {
            updateExportPanel(t('exp_status_rendering', { pct: Math.round(frameIdx / totalFrames * 100) }));
            await new Promise(r => setTimeout(r, 0));   // oddech dla UI
        }
    }

    updateExportPanel(t('exp_status_encoding'));
    const { blob, ext } = await encoder.finalize();
    downloadBlob(blob, exportFilename(ext), blob.type);
    updateExportPanel(t('exp_status_done'));
    setTimeout(() => updateExportPanel(''), 3000);
}

// ══════════════════════════════════════════════════════════
// TRYB REALTIME — WebM (fallback bez WebCodecs)
// ══════════════════════════════════════════════════════════
async function runRealtimeWebmExport(w, h, fps) {
    const canvas  = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx     = canvas.getContext('2d');

    updateExportPanel(t('exp_status_tiles'));
    // Pre-load pierwszej klatki, żeby film nie zaczynał się czarnym ekranem
    const firstGen = walkFrames(fps);
    const first    = firstGen.next().value;
    {
        const { fuel, cost } = renderState(first, 0);
        await drawFrame(ctx, w, h, first, 0, fuel, cost, true);
    }
    activeLabels = [];

    const stream   = canvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

    updateExportPanel(t('exp_status_webm_rt'));
    recorder.start(100);

    const gen           = walkFrames(fps);
    const frameInterval = 1000 / fps;
    let   frameIdx      = 0;
    let   lastTs        = null;

    await new Promise(resolve => {
        async function tick(ts) {
            if (cancelRequested) { resolve(); return; }
            if (lastTs === null) lastTs = ts;
            if (ts - lastTs < frameInterval) {
                requestAnimationFrame(tick);
                return;
            }
            lastTs = ts - ((ts - lastTs) % frameInterval);

            const { value: st, done } = gen.next();
            if (done) { resolve(); return; }

            const mediaMs        = frameIdx / fps * 1000;
            const { fuel, cost } = renderState(st, mediaMs);
            await drawFrame(ctx, w, h, st, mediaMs, fuel, cost, false);
            frameIdx++;

            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    });

    await new Promise(resolve => {
        recorder.onstop = resolve;
        recorder.stop();
    });

    if (cancelRequested) {
        updateExportPanel(t('exp_status_cancelled'));
        return;
    }

    const blob = new Blob(chunks, { type: 'video/webm' });
    downloadBlob(blob, exportFilename('webm'), 'video/webm');
    updateExportPanel(t('exp_status_done'));
    setTimeout(() => updateExportPanel(''), 3000);
}

// ══════════════════════════════════════════════════════════
// PUBLICZNE API
// ══════════════════════════════════════════════════════════
export async function startVideoExport() {
    if (!S.routeSegments.length) { alert(t('alert_no_route')); return; }

    // Drugi klik = anulowanie trwającego exportu
    if (exporting) { cancelRequested = true; return; }

    exporting       = true;
    cancelRequested = false;
    activeLabels    = [];
    resetHudState();
    setRecordBtn(true);

    try {
        const { w, h } = LAYOUTS[recSettings.layout];

        // Min. zoom 25 km — zsynchronizuj suwak
        recSettings.zoomKm = Math.max(25, recSettings.zoomKm);
        const zoomInput = document.querySelector('#adv-zoom');
        if (zoomInput && Number(zoomInput.value) < 25) {
            zoomInput.value = '25';
            const zv = document.getElementById('adv-zoom-val');
            if (zv) zv.textContent = '25 km';
        }

        // Prekalkulacja Mercatora (raz, nie co klatkę)
        S.routeSegments.forEach(seg => {
            if (!seg.mercCoords) {
                seg.mercCoords = seg.coords.map(([lat, lon]) => [getNormMercX(lon), getNormMercY(lat)]);
            }
        });

        // Liczniki dystansu dla HUD
        S.resetKm();
        S.routeSegments.forEach(seg => S.addTotalKm(seg.type, seg.distKm));
        buildSegStartKm();

        if (recSettings.format === 'gif') {
            const encoder = await createGifEncoder({ width: w, height: h, fps: GIF_FPS });
            if (!encoder) throw new Error('GIF encoder unavailable');
            await runOfflineExport(encoder, w, h, GIF_FPS);
        } else {
            const encoder = await createMp4Encoder({ width: w, height: h, fps: VIDEO_FPS });
            if (encoder) {
                await runOfflineExport(encoder, w, h, VIDEO_FPS);
            } else {
                // Brak WebCodecs/H.264 → WebM w czasie rzeczywistym
                await runRealtimeWebmExport(w, h, VIDEO_FPS);
            }
        }
    } catch (e) {
        console.error('Video export failed:', e);
        updateExportPanel(t('exp_status_error', { msg: e.message }));
    } finally {
        exporting       = false;
        cancelRequested = false;
        activeLabels    = [];
        // Zwolnij prekalkulowane współrzędne
        S.routeSegments.forEach(seg => { delete seg.mercCoords; });
        setRecordBtn(false);
        resetHudState();
    }
}

function exportFilename(ext) {
    const name = S.tourName || S.STOPS.map(s => s.name).join('-');
    return `expedition-${recSettings.layout}-${slugify(name)}.${ext}`;
}

function setRecordBtn(rec) {
    const btn = document.getElementById('exp-mp4-btn');
    if (!btn) return;
    btn.textContent       = rec ? t('exp_btn_stop') : t('exp_mp4_btn');
    btn.style.background  = rec ? 'rgba(248,113,113,0.15)' : '';
    btn.style.borderColor = rec ? '#f87171' : '';
    btn.style.color       = rec ? '#f87171' : '';
}

function updateExportPanel(msg) {
    const el = document.getElementById('exp-status');
    if (el) el.textContent = msg;
}
