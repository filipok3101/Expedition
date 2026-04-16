# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

Expedition is a browser-based travel route simulator. Users build a multi-stop route on a map, set fuel/cost parameters, then watch an animated vehicle travel the route. Routes are fetched from OSRM (with automatic ferry detection), and the finished route can be exported as GPX or as an animated `.webm` video.

No build step, no bundler, no test suite. All JS is native ES modules loaded via `<script type="module">`, which requires HTTP — opening `index.html` as a `file://` URL will not work.

## Running locally

Serve the project with any static file server:

```bash
npx serve .
# or
python -m http.server 8080
```

Video export (`startMP4Recording`) uses `MediaRecorder` + `canvas.captureStream` — works in Chrome/Edge, not Firefox/Safari.

## Architecture

The app is a single-page application with three sequential screens managed by `display` toggling:

1. **Setup screen** (`#setup-screen`) — add/reorder stops, search via Nominatim, reverse-geocode countries via BigDataCloud.
2. **Advanced screen** (`#advanced-screen`) — set fuel consumption per transport type and fuel price per country.
3. **Simulation screen** (`#app`) — animated map + right panel with stats, stop list, and export controls.

### Module overview

| File | Responsibility |
|---|---|
| `js/state.js` | Single source of truth. All shared mutable state lives here as exported `let` variables, mutated only through exported setter functions. |
| `js/main.js` | App entry point. Owns the Leaflet map instance, `DOMContentLoaded` wiring, speed controls, language switcher, and export panel event handling. |
| `js/setup.js` | Setup screen logic: Nominatim place search, map click picking, stop list with drag-and-drop reordering, navigation to advanced screen. |
| `js/routing.js` | Fetches routes from OSRM (`steps=true`), parses ferry sub-segments by `step.mode === 'ferry'`, densifies coordinates, builds `routeSegments[]`. |
| `js/animation.js` | `requestAnimationFrame` loop that advances `segFrac` each tick, interpolates vehicle position, draws polylines incrementally on the Leaflet map. |
| `js/translations.js` | EN/PL string lookup. `uiLang.code` is a mutable object so all modules share the same reference. |
| `js/export.js` | Barrel re-export: `exportGPX`, `startMP4Recording`, `recSettings`. |
| `js/export/config.js` | Layout dimensions, tile provider URLs, `recSettings` object, animation constants. |
| `js/export/gpx.js` | Builds and downloads a GPX file from `S.STOPS` and `S.routeSegments`. |
| `js/export/video.js` | `MediaRecorder`-based video loop: advances `segIdx/segFrac` at fixed 30 fps, calls `drawFrame`, handles stop-arrival pauses and the final hold. |
| `js/export/video-renderer.js` | Canvas drawing primitives: map tile cache/loading, route polylines, vehicle emoji, stop flags/labels, HUD (cached to a secondary canvas to avoid per-frame redraws). |
| `js/export/utils.js` | Pure helpers: Mercator projection math, `geoToPixelFast`, `kmToZoom`, `downloadBlob`, `escXml`, `slugify`. |

### Key data flow

1. `setup.js` populates `S.customStops[]` with `{ name, lat, lon, type, country }`.
2. `main.js#startFinalJourney` copies `customStops` → `S.STOPS`, then calls `routing.js#preloadRoutes`.
3. `preloadRoutes` fetches OSRM for each consecutive stop pair, splits the response into road/ferry sub-segments, and populates `S.routeSegments[]` — each entry has `{ coords, cum, type, distKm, from, to, segFrom, segTo, country, noFuel }`.
4. `animation.js#animStep` walks `routeSegments` using `S.curSeg` / `S.segFrac`, drawing onto the Leaflet map.
5. `export/video.js#startMP4Recording` independently re-walks the same `routeSegments` on an off-screen canvas at fixed 30 fps, producing a `.webm` blob.

### State mutation pattern

All state is in `state.js`. Modules import the state object (`import * as S from './state.js'`) and call setter functions (`S.setSegFrac(...)`) rather than assigning directly. Arrays like `S.drawnPolylines` and `S.flagMarkers` are mutated in place (`.push`, `.splice`) — there are no setters for these.

### Coordinate conventions

- Geographic coords throughout the app are `[lat, lon]` arrays.
- OSRM GeoJSON returns `[lon, lat]` — the conversion happens in `stepCoords()` in `routing.js`.
- Mercator normalized coords (`getNormMercX/Y`) are scaled so that the full world = 256 units, matching the tile grid math.

### Video export internals

- Two canvases: `canvas` (captured by `MediaRecorder`) and `bufferCanvas` (rendered to, then blitted).
- HUD is cached on a third `hudCanvas` and only re-rendered when the key (progress + fuel + cost rounded) changes.
- Tile loading: first frame uses `waitForNetwork=true` (awaits all tiles); subsequent frames use the cache synchronously and trigger background loads for misses without blocking the frame loop.
- `seg.mercCoords` is pre-calculated once before recording starts to avoid per-frame Mercator conversions.
