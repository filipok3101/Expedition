// ══════════════════════════════════════════════════════════
// ENKODERY — wspólny interfejs:
//   { addFrame(canvas, frameIdx), finalize() → {blob, ext, mime}, cancel() }
//
// MP4: WebCodecs (VideoEncoder, H.264) + mp4-muxer — enkodowanie
//      szybsze niż czas rzeczywisty, niezależne od widoczności karty.
// GIF: gifenc — kwantyzacja per klatka, downscale do GIF_MAX_DIM.
// Obie biblioteki ładowane dynamicznie z CDN dopiero przy exporcie.
// ══════════════════════════════════════════════════════════
import { CDN_MP4_MUXER, CDN_GIFENC, GIF_MAX_DIM } from './config.js';

// ── MP4 (zwraca null gdy przeglądarka nie wspiera WebCodecs/H.264) ──
export async function createMp4Encoder({ width, height, fps }) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;

    // Profil/poziom H.264 — od najlepszego do najbardziej kompatybilnego
    const candidates = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032'];
    const baseConfig = {
        width, height,
        framerate: fps,
        // ~0.1 bit/px/klatkę, w granicach 2–12 Mb/s
        bitrate: Math.max(2_000_000, Math.min(12_000_000, Math.round(width * height * fps * 0.1))),
    };

    let codec = null;
    for (const c of candidates) {
        try {
            const { supported } = await VideoEncoder.isConfigSupported({ ...baseConfig, codec: c });
            if (supported) { codec = c; break; }
        } catch { /* nieznany codec string — próbuj następny */ }
    }
    if (!codec) return null;

    let muxerMod;
    try {
        muxerMod = await import(CDN_MP4_MUXER);
    } catch (e) {
        console.warn('mp4-muxer CDN load failed:', e.message);
        return null;
    }
    const { Muxer, ArrayBufferTarget } = muxerMod;

    const muxer = new Muxer({
        target:    new ArrayBufferTarget(),
        video:     { codec: 'avc', width, height },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
    });

    let encError = null;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error:  e => { encError = e; },
    });
    encoder.configure({ ...baseConfig, codec });

    const usPerFrame = 1e6 / fps;

    return {
        async addFrame(canvas, frameIdx) {
            if (encError) throw encError;
            // Backpressure — nie zalewaj kolejki enkodera
            while (encoder.encodeQueueSize > 4) {
                await new Promise(r => setTimeout(r, 4));
                if (encError) throw encError;
            }
            const frame = new VideoFrame(canvas, {
                timestamp: Math.round(frameIdx * usPerFrame),
                duration:  Math.round(usPerFrame),
            });
            encoder.encode(frame, { keyFrame: frameIdx % (fps * 2) === 0 });
            frame.close();
        },
        async finalize() {
            await encoder.flush();
            encoder.close();
            muxer.finalize();
            if (encError) throw encError;
            return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', mime: 'video/mp4' };
        },
        cancel() {
            try { encoder.close(); } catch { /* już zamknięty */ }
        },
    };
}

// ── GIF ──
export async function createGifEncoder({ width, height, fps }) {
    let gifMod;
    try {
        gifMod = await import(CDN_GIFENC);
    } catch (e) {
        console.warn('gifenc CDN load failed:', e.message);
        return null;
    }
    const { GIFEncoder, quantize, applyPalette } = gifMod;

    // Downscale — pełne 1080p w GIF-ie to setki MB
    const scale = Math.min(1, GIF_MAX_DIM / Math.max(width, height));
    const gw = Math.max(2, 2 * Math.round(width  * scale / 2));
    const gh = Math.max(2, 2 * Math.round(height * scale / 2));

    const tmp  = document.createElement('canvas');
    tmp.width  = gw;
    tmp.height = gh;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });

    const gif   = GIFEncoder();
    const delay = Math.round(1000 / fps);
    let first   = true;

    return {
        async addFrame(canvas) {
            tctx.drawImage(canvas, 0, 0, gw, gh);
            const { data } = tctx.getImageData(0, 0, gw, gh);
            const palette  = quantize(data, 256, { format: 'rgb444' });
            const index    = applyPalette(data, palette, 'rgb444');
            gif.writeFrame(index, gw, gh, { palette, delay, ...(first ? { repeat: 0 } : {}) });
            first = false;
        },
        async finalize() {
            gif.finish();
            return { blob: new Blob([gif.bytesView()], { type: 'image/gif' }), ext: 'gif', mime: 'image/gif' };
        },
        cancel() { /* brak zasobów do zwolnienia */ },
    };
}
