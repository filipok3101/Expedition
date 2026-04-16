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
};

export const REC_KM_PER_S   = 40;
export const LABEL_DURATION = 2800;
export const LABEL_FADE     = 500;
export const STOP_PAUSE_MS  = 250;