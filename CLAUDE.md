# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

Expedition is a browser-based travel route simulator. Users build a multi-stop route on a map, set fuel/cost parameters, then watch an animated vehicle travel the route. Routes are fetched from Valhalla (with automatic OSRM fallback and ferry detection), and the finished route can be exported as GPX, an `.mp4` video, or an animated `.gif` (with `.webm` as a last-resort fallback).

No build step, no bundler, no test suite. All JS is native ES modules loaded via `<script type="module">`, which requires HTTP — opening `index.html` as a `file://` URL will not work.

## Running locally

Serve the project with any static file server:

```bash
npx serve .
# or
python -m http.server 8080
```

Video export uses WebCodecs (`VideoEncoder`) for MP4 — supported in Chrome/Edge/Safari 16.4+/Firefox 130+. Browsers without WebCodecs automatically fall back to a real-time `MediaRecorder` WebM recording. The MP4 muxer (`mp4-muxer`) and GIF encoder (`gifenc`) are dynamically imported from jsDelivr at export time, so video export requires network access.

## Architecture

The app is a single-page application with three sequential screens managed by `display` toggling:

1. **Setup screen** (`#setup-screen`) — add/reorder stops, search via Nominatim (debounced autocomplete + keyboard navigation), reverse-geocode countries via BigDataCloud.
2. **Advanced screen** (`#advanced-screen`) — set fuel consumption per transport type, fuel price per country, route options (avoid ferries, avoid motorways — globally or per segment).
3. **Simulation screen** (`#app`) — animated map + right panel with stats, stop list, and export controls. On mobile (≤768px) the right panel becomes a bottom sheet.

### Module overview

| File | Responsibility |
|---|---|
| `js/state.js` | Single source of truth. All shared mutable state lives here as exported `let` variables, mutated only through exported setter functions. |
| `js/api.js` | All external HTTP access: `fetchJSON` (timeout + retry + backoff), Valhalla, OSRM fallback, Nominatim, BigDataCloud. Country names are always fetched with `localityLanguage=en` because they are keys in `fuelPricesByCountry`. |
| `js/main.js` | App entry point. Owns the Leaflet map instance, `DOMContentLoaded` wiring, speed controls, language switcher (persisted in `localStorage`), export panel event handling, mobile bottom sheets for setup and sim screens. |
| `js/setup.js` | Setup screen logic: debounced Nominatim autocomplete with ↑↓/↵/ESC keyboard navigation, map click picking, stop list with drag-and-drop reordering, advanced screen (fuel, route options), route-country detection with per-route caching. |
| `js/routing.js` | Fetches routes from Valhalla (`costing: auto/motorcycle`, `use_ferry`/`use_highways` options), parses ferry sub-segments by `maneuver.type === 28` (FerryEnter), falls back to OSRM (`step.mode === 'ferry'`) when Valhalla is down, densifies coordinates, builds `routeSegments[]`, shows warning banners (forced ferry, OSRM fallback). |
| `js/animation.js` | `requestAnimationFrame` loop that advances `segFrac` each tick, interpolates vehicle position, draws polylines incrementally on the Leaflet map. |
| `js/bottom-sheet.js` | Reusable `BottomSheet` class (peek/half/full snap states, drag + tap). Used by the setup screen shell and the sim-screen right panel on mobile. |
| `js/translations.js` | EN/PL string lookup. `t(key, vars)` supports `{placeholder}` interpolation. `uiLang.code` is a mutable object so all modules share the same reference. |
| `js/export.js` | Barrel re-export: `exportGPX`, `startVideoExport`, `recSettings`. |
| `js/export/config.js` | Layout dimensions, tile provider URLs, `recSettings` object (incl. `format: 'mp4'|'gif'`), animation/encoder constants, CDN URLs. |
| `js/export/gpx.js` | Builds and downloads a GPX file from `S.STOPS` and `S.routeSegments`. |
| `js/export/video.js` | `walkFrames(fps)` — deterministic frame-state generator (vehicle position, stop pauses, label triggers, final hold) operating in **media time** (frame index / fps), not wall-clock time. Drives either the offline export loop (MP4/GIF, faster than real time) or the real-time WebM fallback. |
| `js/export/encoders.js` | Encoder factories with a common interface (`addFrame`/`finalize`/`cancel`): MP4 via WebCodecs + mp4-muxer (dynamic CDN import, codec negotiation, backpressure), GIF via gifenc (downscaled to 540px, per-frame quantization). |
| `js/export/video-renderer.js` | Canvas drawing primitives: map tile cache/loading (LRU), route polylines, vehicle emoji, stop flags/labels, HUD (cached to a secondary canvas to avoid per-frame redraws). |
| `js/export/utils.js` | Pure helpers: Mercator projection math, `geoToPixelFast`, `kmToZoom`, `downloadBlob`, `escXml`, `slugify`. |

### CSS structure

Stylesheets in `css/` are loaded in cascade order from `index.html` — keep that order if adding files:
`base.css` (variables/reset) → `sim.css` → `advanced.css` → `setup.css` → `export.css` → `mobile.css` (all `@media (max-width: 768px)` rules live here).

### Key data flow

1. `setup.js` populates `S.customStops[]` with `{ name, lat, lon, type, country }`.
2. `main.js#startFinalJourney` copies `customStops` → `S.STOPS`, then calls `routing.js#preloadRoutes`.
3. `preloadRoutes` fetches Valhalla (or OSRM) for each consecutive stop pair, splits the response into road/ferry sub-segments, and populates `S.routeSegments[]` — each entry has `{ coords, cum, type, distKm, from, to, segFrom, segTo, country, noFuel, color }`.
4. `animation.js#animStep` walks `routeSegments` using `S.curSeg` / `S.segFrac`, drawing onto the Leaflet map.
5. `export/video.js#startVideoExport` independently re-walks the same `routeSegments` on an off-screen canvas via `walkFrames(fps)`, feeding an encoder from `encoders.js` (MP4/GIF) or a `MediaRecorder` stream (WebM fallback).

### State mutation pattern

All state is in `state.js`. Modules import the state object (`import * as S from './state.js'`) and call setter functions (`S.setSegFrac(...)`) rather than assigning directly. Arrays like `S.drawnPolylines` and `S.flagMarkers` are mutated in place (`.push`, `.splice`) — there are no setters for these.

### Coordinate conventions

- Geographic coords throughout the app are `[lat, lon]` arrays.
- Valhalla returns an encoded polyline with 1e-6 precision — decoded by `decodePolyline6()` in `routing.js`.
- OSRM GeoJSON returns `[lon, lat]` — converted when parsing steps in `routing.js#fetchOsrmChunk`.
- Mercator normalized coords (`getNormMercX/Y`) are scaled so that the full world = 256 units, matching the tile grid math.

### Video export internals

- **Media time, not wall-clock**: every timing decision (stop pauses, label fade in/out, HUD clock, final hold) is computed from `frameIdx / fps`. This makes the output identical whether frames render faster (MP4/GIF offline) or exactly at real time (WebM fallback).
- `walkFrames(fps)` yields `{ segIdx, segFrac, drawnUpTo, label, final }` per frame; `countFrames(fps)` pre-runs it to compute export progress percentages.
- MP4 encoding applies backpressure (`encodeQueueSize`), negotiates an H.264 codec string via `VideoEncoder.isConfigSupported`, keyframes every 2 s, and muxes in-memory (`fastStart: 'in-memory'`).
- GIF frames are downscaled (longest side ≤ 540 px, even dimensions) and quantized per frame (`rgb444`, 256 colors, infinite loop).
- Tile loading: offline export uses `waitForNetwork=true` per frame for deterministic completeness (LRU cache makes most hits instant); the real-time fallback only awaits tiles on the first frame.
- `seg.mercCoords` is pre-calculated once before export starts and deleted afterwards.

### External APIs

All network access goes through `js/api.js` — do not call `fetch` directly from feature modules. Services: Valhalla (`valhalla1.openstreetmap.de`, primary routing), OSRM demo (`router.project-osrm.org`, automatic fallback — no motorcycle profile, no motorway avoidance), Nominatim (place search, debounced ≥450 ms to respect the 1 req/s policy), BigDataCloud (reverse geocoding, always English country names).
