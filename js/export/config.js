// ══════════════════════════════════════════════════════════
// KONFIGURACJA EXPORTU WIDEO
// ══════════════════════════════════════════════════════════

export const LAYOUTS = {
    tiktok:    { w: 1080, h: 1920 },
    instagram: { w: 1080, h: 1080 },
    fullhd:    { w: 1920, h: 1080 },
};

export const TILE_PROVIDERS = {
    dark: (x,y,z) => { const s=['a','b','c'][Math.abs(x+y)%3]; return `https://${s}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`; },
    osm:  (x,y,z) => { const s=['a','b','c'][Math.abs(x+y)%3]; return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`; },
};

export const recSettings = {
    zoomKm:        40,
    showStats:     true,
    showWatermark: true,
    tileProvider:  'dark',
    layout:        'fullhd',
    format:        'mp4',     // 'mp4' | 'gif' (webm = automatyczny fallback)
};

// ── Animacja nagrania ──
export const REC_KM_PER_S        = 40;     // km trasy na sekundę filmu (przy zoomie 40 km)
export const LABEL_DURATION      = 2800;   // ms czasu filmu — życie etykiety przystanku
export const LABEL_FADE          = 500;    // ms — fade in/out etykiety
export const STOP_PAUSE_MS       = 250;    // ms — pauza pojazdu na przystanku
export const FINAL_HOLD_MS       = 3000;   // ms — zatrzymanie ostatniej klatki na końcu
export const MIN_FRAMES_PER_SEG  = 2;      // min. klatek na segment (krótkie odcinki nie znikają)

// ── Parametry enkoderów ──
export const VIDEO_FPS   = 30;
export const GIF_FPS     = 15;
export const GIF_MAX_DIM = 540;            // dłuższy bok GIF-a po przeskalowaniu

// ── Biblioteki enkodujące (ESM z CDN, ładowane dynamicznie przy exporcie) ──
export const CDN_MP4_MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';
export const CDN_GIFENC    = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm';

