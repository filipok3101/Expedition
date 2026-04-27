# Setup Screen v5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Expedition setup screen with the v5 mockup design — fullscreen Leaflet map background, floating docks, animated search dropdown with loading state, redesigned stop cards, improved drag states.

**Architecture:** `#setup-screen` becomes a fixed fullscreen container; `#setup-map` fills it at z-index 0; two docks (`.setup-dock-add` left, `.setup-dock-route` right) float via `position: absolute`; a bottom pill replaces the old footer. All element IDs consumed by `main.js` (`#btn-pl`, `#btn-en`, `#btn-next`, `#btn-add-destination`, `#place-search`, `#location-name`, `#transport-type`, `#custom-stop-list`, `#tour-name-input`) are preserved. `#advanced-screen` and `#app` are untouched.

**Tech Stack:** Vanilla JS ES modules, Leaflet 1.9.4, native HTML5 drag-and-drop, CSS custom properties, Bebas Neue + Share Tech Mono (Google Fonts).

**Reference:** Design approved from `mockup-v5.html`. Drop zone text ("DROP HERE") is intentionally omitted — only visual classes are applied.

---

## File map

| File | What changes |
|------|-------------|
| `index.html` | Restructure `#setup-screen` (lines 15–71); `#advanced-screen` + `#app` unchanged |
| `style.css` | Remove old setup CSS (~lines 100–243); add new v5 setup CSS; add 4 CSS vars; keep `#setup-header`, export panel, app screen CSS |
| `js/setup.js` | `initSetupMap()` — fullscreen map + outside-click listener; `searchPlaces()` — loading state + sr-item markup; `clearSearchResults()` — `.open` class; `updateStopsList()` — stop-card grid; drag class names; add `resetAllStops()` |
| `js/translations.js` | Add `stops_label`, `btn_reset`; update `btn_search` values |
| `js/main.js` | Import `resetAllStops`; wire `#btn-reset-stops`; update `changeLanguage()` lang-button styling |

---

### Task 1 — Restructure `#setup-screen` in `index.html`

**Files:**
- Modify: `index.html` lines 15–71

- [ ] **Step 1: Replace the `#setup-screen` block**

Delete lines 15–71 (from `<div id="setup-screen">` through its closing `</div>`) and replace with:

```html
<div id="setup-screen">
  <!-- Fullscreen map — z-index 0, sits behind all panels -->
  <div id="setup-map"></div>
  <div class="edge-vignette"></div>

  <!-- Top bar -->
  <div class="setup-topbar">
    <div class="setup-brand">EXPEDITION ▸</div>
    <div class="setup-toptools">
      <a href="https://buymeacoffee.com/filipok3101" target="_blank" rel="noopener" class="setup-ghost-btn">☕</a>
      <a href="https://github.com/filipok3101/Expedition" target="_blank" rel="noopener" class="setup-ghost-btn">👾</a>
      <button id="btn-pl" class="setup-ghost-btn">PL</button>
      <button id="btn-en" class="setup-ghost-btn active">EN</button>
    </div>
  </div>

  <!-- Left dock: add stop -->
  <div class="setup-dock setup-dock-add">
    <div class="setup-section-label">▸ ADD STOP</div>
    <div class="setup-section-sub" data-i18n="add_stop_desc">Search a place or click anywhere on the map</div>
    <div class="setup-row">
      <div class="search-wrap">
        <input type="text" class="setup-ipt" id="place-search"
          data-i18n="placeholder_search" placeholder="Search for a place…"
          autocomplete="off" spellcheck="false">
        <div class="search-dropdown" id="place-search-results"></div>
      </div>
      <button type="button" class="setup-btn-primary" id="btn-place-search"
        data-i18n="btn_search">SCAN</button>
    </div>
    <input type="text" class="setup-ipt" id="location-name"
      data-i18n="placeholder_name" placeholder="Location name">
    <div class="setup-row">
      <select class="setup-ipt" id="transport-type" style="flex:1;cursor:pointer">
        <option value="auto">🚗 Auto</option>
        <option value="moto">🏍️ Moto</option>
      </select>
      <button class="setup-btn-primary" id="btn-add-destination"
        data-i18n="btn_add">+ ADD</button>
    </div>
  </div>

  <!-- Right dock: route list -->
  <div class="setup-dock setup-dock-route">
    <div class="setup-section-label">
      ▸ <span data-i18n="your_route_title">YOUR ROUTE</span>
      / <span id="stop-count">0</span>
      <span data-i18n="stops_label">STOPS</span>
    </div>
    <div class="setup-tour-name-block">
      <div class="setup-tour-lbl" data-i18n="tour_name_label">NAME YOUR TOUR:</div>
      <input type="text" id="tour-name-input" class="setup-tour-input"
        data-i18n="tour_name_placeholder" placeholder="e.g. Alpine Summer 2026"
        maxlength="60" autocomplete="off">
    </div>
    <div class="setup-stop-list" id="custom-stop-list">
      <p class="stops-empty" data-i18n="empty_route">The route is empty for now... 😒</p>
    </div>
  </div>

  <!-- Bottom pill -->
  <div class="setup-bottom-pill">
    <button class="setup-btn-ghost" id="btn-reset-stops" data-i18n="btn_reset">⏮ RESET</button>
    <button class="setup-btn-primary large" id="btn-next"
      data-i18n="btn_next" disabled>NEXT ▸</button>
  </div>
</div>
```

- [ ] **Step 2: Verify IDs consumed by `main.js` are all present**

Check that these IDs appear exactly once in the new block:
`#place-search`, `#btn-place-search`, `#place-search-results`, `#location-name`, `#transport-type`, `#btn-add-destination`, `#tour-name-input`, `#custom-stop-list`, `#btn-next`, `#btn-pl`, `#btn-en`, `#btn-reset-stops`

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "refactor: restructure setup-screen to fullscreen map + floating docks layout"
```

---

### Task 2 — Overhaul setup CSS in `style.css`

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Add 4 new CSS variables**

In `:root` (top of file), after `--accent-glow:` line, insert:

```css
--top-bar:     #06080d;
--accent-hot:  #ff8c1a;
--accent-soft: rgba(240,124,0,.12);
--route-glow:  rgba(240,124,0,.55);
```

- [ ] **Step 2: Remove old setup CSS — identify exact lines to delete**

Delete all of these selectors/blocks (leave the rest of the file intact):

- `/* ── SETUP SCREENS ── */` comment + `#setup-screen { ... }` + `#advanced-screen { ... }` + `#setup-header { ... }` + `#setup-header h2 { ... }` + `#setup-header p { ... }` (lines ~100–106)
- `.setup-content { ... }` (line ~107)
- `.adv-main-content`, `.adv-top-row`, `.adv-panel-top`, `.adv-countries-panel`, `.adv-countries-panel::-webkit-scrollbar`, `.adv-countries-panel::-webkit-scrollbar-thumb`, `.adv-detecting-msg`, `@keyframes spin` — keep these (they belong to the advanced screen, which is untouched)
- `.setup-left { ... }`, `.setup-right { ... }`, `.list-wrapper { ... }` (lines ~164–166)
- `.setup-left h3, .setup-right h3 { ... }`, `.setup-left p, .setup-right p { ... }`, `.setup-left .btn, .setup-right .btn { ... }` (lines ~167–169)
- `.setup-left #destination-inputs { ... }`, `#destination-inputs input, #destination-inputs select { ... }`, `#destination-inputs input:focus, #destination-inputs select:focus { ... }` (lines ~171–173)
- `.setup-search-row { ... }`, `.setup-search-row input { ... }`, `.setup-search-row .btn-setup-search { ... }` (lines ~175–177)
- `#setup-map { ... }` (line ~179)
- `.place-search-results { ... }`, `.place-search-results[hidden] { ... }`, `button.place-search-result { ... }`, `button.place-search-result:hover { ... }`, `button.place-search-result:focus { ... }` (lines ~181–185)
- `#custom-stop-list { ... }` (line ~187)
- `.setup-footer { ... }`, `.setup-footer p { ... }`, `.setup-footer .btn { ... }`, `.setup-footer .btn:hover { ... }` (lines ~195–199)
- `.lang-switcher { ... }`, `.lang-switcher #btn-pl, .lang-switcher #btn-en { ... }`, `.lang-switcher #btn-pl:hover, .lang-switcher #btn-en:hover { ... }` (lines ~200–202)
- `/* ── DRAG & DROP ── */` block: `.draggable-stop { ... }`, `.draggable-stop:hover { ... }`, `.draggable-stop.dragging { ... }`, `.draggable-stop.drag-over { ... }` (lines ~204–209)
- `/* ── TOUR NAME INPUT ── */` block: `.tour-name-row { ... }`, `.tour-name-label { ... }`, `.tour-name-input { ... }`, `.tour-name-input::placeholder { ... }`, `.tour-name-input:focus { ... }` (lines ~210–243)

- [ ] **Step 3: Re-add `#setup-screen`, `#advanced-screen`, `#setup-header` as standalone rules**

After the delete, add these back (they were mixed in the removed block):

```css
/* ── SCREENS ── */
#setup-screen {
  position: fixed; inset: 0;
  background: var(--bg); z-index: 10000;
  overflow: hidden;
  font-family: 'Share Tech Mono', monospace;
}
#advanced-screen {
  position: fixed; inset: 0;
  background: var(--bg); display: none; flex-direction: column;
  z-index: 10000; padding: 3vh 5vw;
  font-family: 'Share Tech Mono', monospace;
  overflow-y: auto; align-items: center; justify-content: center;
}
#setup-header { text-align: center; margin-bottom: 30px; flex-shrink: 0; }
#setup-header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 4rem; letter-spacing: 6px; color: var(--accent); text-shadow: 0 0 18px var(--accent-glow); }
#setup-header p { font-size: 1.1rem; color: var(--text); margin-top: 10px; }
```

- [ ] **Step 4: Append new setup screen v5 CSS**

Add the following block right after the rules from Step 3:

```css
/* ══════════════════════════════════════════════════════════
   SETUP SCREEN v5 — fullscreen map + floating docks
   ══════════════════════════════════════════════════════════ */

/* Fullscreen map */
#setup-map { position: absolute; inset: 0; z-index: 0; background: #050709; }
#setup-screen .leaflet-tile-pane { filter: saturate(0.72) contrast(1.02) brightness(0.97); }

/* Edge vignette */
.edge-vignette {
  position: absolute; inset: 0; z-index: 100; pointer-events: none;
  background: radial-gradient(ellipse 110% 90% at 50% 50%, transparent 55%, rgba(0,0,0,.35) 100%);
}

/* ── Top bar ── */
.setup-topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 50px; z-index: 500;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px;
  background: var(--top-bar);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0,0,0,.6);
  animation: s-slideDown .4s ease-out both;
}
.setup-topbar::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.07) 0 1px, transparent 1px 3px);
  z-index: 1;
}
.setup-topbar::before {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent) 30%, var(--accent) 70%, transparent);
  box-shadow: 0 0 10px var(--accent-glow); opacity: .85; z-index: 2;
}
.setup-brand {
  font-family: 'Bebas Neue', sans-serif; color: var(--accent);
  font-size: 1.45rem; letter-spacing: 4px;
  text-shadow: 0 0 12px var(--accent-glow); position: relative; z-index: 3;
}
.setup-toptools { display: flex; gap: 6px; position: relative; z-index: 3; }
.setup-ghost-btn {
  background: transparent; border: 1px solid var(--border); color: var(--text);
  font-family: 'Share Tech Mono', monospace; font-size: .65rem; letter-spacing: 2px;
  padding: 6px 11px; cursor: pointer; transition: all .2s; text-transform: uppercase;
  text-decoration: none; display: inline-block;
}
.setup-ghost-btn:hover { border-color: var(--accent); color: var(--accent); box-shadow: 0 0 6px var(--accent-glow); }
.setup-ghost-btn.active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

/* ── Dock base ── */
.setup-dock {
  position: absolute; z-index: 400;
  background: rgba(8,10,16,.84);
  border: 1px solid var(--border);
  backdrop-filter: blur(14px) saturate(1.3);
  box-shadow: 0 12px 36px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.2);
  display: flex; flex-direction: column;
  overflow: visible;
}
.setup-dock::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.07) 0 1px, transparent 1px 3px);
  z-index: 0;
}
.setup-dock > * { position: relative; z-index: 2; }

/* ── Add dock (left) ── */
.setup-dock-add {
  top: 66px; left: 18px; width: 320px;
  padding: 16px; gap: 10px;
  animation: s-fadeInL .5s .12s ease-out both;
}
.setup-dock-add::after {
  content: ''; position: absolute; left: 0; top: 16px; bottom: 16px; width: 2px;
  background: linear-gradient(180deg, transparent, var(--accent) 20%, var(--accent) 80%, transparent);
  box-shadow: 0 0 10px var(--accent-glow); z-index: 1;
}

/* ── Route dock (right) ── */
.setup-dock-route {
  top: 66px; right: 18px; width: 300px; bottom: 84px;
  padding: 14px 16px 16px; gap: 8px;
  animation: s-fadeInR .5s .24s ease-out both;
}
.setup-dock-route::after {
  content: ''; position: absolute; right: 0; top: 16px; bottom: 16px; width: 2px;
  background: linear-gradient(180deg, transparent, var(--accent) 20%, var(--accent) 80%, transparent);
  box-shadow: 0 0 10px var(--accent-glow); z-index: 1;
}

/* ── Form elements ── */
.setup-section-label { font-size: .6rem; letter-spacing: 2.5px; color: var(--accent); text-transform: uppercase; margin-bottom: 2px; }
.setup-section-sub   { font-size: .58rem; letter-spacing: 1px; color: var(--dim); margin-bottom: 4px; line-height: 1.5; }
.setup-row { display: flex; gap: 8px; }

.setup-ipt {
  background: rgba(14,17,23,.85);
  border: 1px solid var(--border); border-left: 2px solid var(--accent);
  color: var(--text); padding: 10px 12px;
  font-family: 'Share Tech Mono', monospace; font-size: .85rem; letter-spacing: .5px;
  outline: none; transition: border-color .2s, box-shadow .2s; width: 100%;
}
.setup-ipt:focus { border-color: var(--accent); box-shadow: 0 0 10px var(--accent-glow); }
.setup-ipt::placeholder { color: var(--dim); }

.setup-btn-primary {
  background: var(--accent-soft); border: 1px solid var(--accent); color: var(--accent);
  font-family: 'Share Tech Mono', monospace; font-size: .7rem; letter-spacing: 2.5px;
  padding: 10px 14px; cursor: pointer; text-transform: uppercase;
  box-shadow: 0 0 12px var(--accent-glow), inset 0 0 8px rgba(240,124,0,.05);
  transition: all .2s; white-space: nowrap;
}
.setup-btn-primary:hover { background: rgba(240,124,0,.22); box-shadow: 0 0 18px var(--accent-glow); color: var(--accent-hot); }
.setup-btn-primary.large { font-size: .9rem; letter-spacing: 4px; padding: 13px 30px; }
.setup-btn-primary.large:not(:disabled) { animation: s-breathe 2.4s ease-in-out infinite; }
.setup-btn-primary:disabled { opacity: .35; cursor: not-allowed; animation: none !important; box-shadow: none !important; }

.setup-btn-ghost {
  background: rgba(8,10,16,.5); border: 1px solid var(--border); color: var(--text);
  font-family: 'Share Tech Mono', monospace; font-size: .65rem; letter-spacing: 2px;
  padding: 9px 13px; cursor: pointer; text-transform: uppercase; transition: all .2s;
}
.setup-btn-ghost:hover { border-color: var(--accent); color: var(--accent); box-shadow: 0 0 6px var(--accent-glow); }

/* ── Search dropdown ── */
.search-wrap { position: relative; flex: 1; }
.search-wrap .setup-ipt { width: 100%; }

.search-dropdown {
  position: absolute; top: calc(100% + 3px); left: 0; right: 0; z-index: 800;
  background: rgba(5,7,12,.97);
  border: 1px solid var(--border); border-top: 2px solid var(--accent);
  box-shadow: 0 20px 48px rgba(0,0,0,.75);
  display: none; flex-direction: column; overflow: hidden;
  transform-origin: top center;
}
.search-dropdown.open {
  display: flex;
  animation: s-dropDown .16s cubic-bezier(.16,1,.3,1);
}
.search-dropdown.loading .sr-loading  { display: flex; }
.search-dropdown.loading .sr-results  { display: none !important; }
.search-dropdown:not(.loading) .sr-loading { display: none; }
.search-dropdown:not(.loading) .sr-results { display: flex; flex-direction: column; }

.sr-loading {
  padding: 13px 14px; font-size: .68rem; letter-spacing: 2px; color: var(--dim);
  align-items: center; gap: 10px;
}
.sr-dots { display: flex; gap: 5px; }
.sr-dots span {
  width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
  animation: s-dotPulse 1.1s ease-in-out infinite;
}
.sr-dots span:nth-child(2) { animation-delay: .18s; }
.sr-dots span:nth-child(3) { animation-delay: .36s; }

.sr-item {
  display: grid; grid-template-columns: 26px 1fr; align-items: center;
  padding: 9px 14px; gap: 10px;
  border-bottom: 1px solid rgba(29,34,48,.6); cursor: pointer; transition: background .1s;
}
.sr-item:last-child { border-bottom: none; }
.sr-item:hover { background: var(--accent-soft); }
.sr-item:hover .sr-name { color: var(--accent); }
.sr-flag { font-size: 1rem; text-align: center; line-height: 1; }
.sr-name { font-size: .82rem; color: var(--text); letter-spacing: .3px; line-height: 1.2; }
.sr-name small { display: block; color: var(--dim); font-size: .58rem; letter-spacing: 1.5px; margin-top: 2px; }

.sr-footer {
  padding: 6px 14px; border-top: 1px solid var(--border);
  font-size: .53rem; letter-spacing: 1px; color: var(--dim);
  display: flex; gap: 14px; align-items: center;
  background: rgba(6,8,13,.7);
}
.sr-key {
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); padding: 1px 5px;
  font-size: .52rem; color: var(--text); min-width: 20px; line-height: 1.6;
  background: rgba(20,24,32,.9); font-family: 'Share Tech Mono', monospace;
}
.sr-footer span { display: flex; align-items: center; gap: 5px; }

/* ── Tour name block ── */
.setup-tour-name-block {
  padding: 9px 11px; flex-shrink: 0;
  background: var(--accent-soft);
  border: 1px solid var(--border); border-left: 2px solid var(--accent);
  box-shadow: inset 0 0 12px rgba(240,124,0,.05);
}
.setup-tour-lbl { font-size: .55rem; letter-spacing: 2px; color: var(--accent); text-transform: uppercase; margin-bottom: 3px; }
.setup-tour-input {
  width: 100%; background: transparent; border: none; color: var(--text);
  font-family: 'Share Tech Mono', monospace; font-size: .9rem; letter-spacing: 1px;
  outline: none; border-bottom: 1px solid var(--border); padding: 2px 0;
  transition: border-color .2s;
}
.setup-tour-input::placeholder { color: var(--dim); font-size: .8rem; }
.setup-tour-input:focus { border-bottom-color: var(--accent); }

/* ── Stop list ── */
.setup-stop-list {
  flex: 1; overflow-y: auto; padding-right: 4px;
  scrollbar-width: thin; scrollbar-color: var(--border) transparent;
}
.setup-stop-list::-webkit-scrollbar { width: 4px; }
.setup-stop-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.stops-empty { color: var(--dim); font-size: .85rem; text-align: center; margin-top: 20px; letter-spacing: 1px; }

/* ── Stop card ── */
.stop-card {
  display: grid; grid-template-columns: 16px 28px 1fr auto auto; align-items: center; gap: 8px;
  padding: 9px 10px; margin-bottom: 6px;
  background: rgba(20,24,34,.85);
  border: 1px solid var(--border); border-left: 3px solid var(--accent);
  transition: background .2s, transform .2s, box-shadow .2s, opacity .25s;
  cursor: grab; user-select: none;
}
.stop-card.ferry-leg { border-left-color: var(--ferry); }
.stop-card:not(.is-source):hover { background: rgba(28,33,46,.95); transform: translateX(2px); box-shadow: 0 4px 12px rgba(0,0,0,.4); }

.stop-handle { color: var(--dim); font-size: .9rem; cursor: grab; }
.stop-num {
  font-family: 'Bebas Neue', sans-serif; color: var(--accent);
  font-size: 1.15rem; letter-spacing: 2px; line-height: 1;
  text-shadow: 0 0 6px var(--accent-glow);
}
.stop-card-name { font-size: .85rem; color: var(--text); }
.stop-card-name .stop-country { color: var(--dim); font-size: .7rem; margin-left: 4px; }
.stop-mode { font-size: 1rem; }
.btn-remove-stop {
  background: transparent; border: none; color: var(--dim);
  font-size: .9rem; cursor: pointer; padding: 2px 4px; transition: color .15s;
}
.btn-remove-stop:hover { color: var(--red); }

/* Drag: source slot (faded placeholder) */
.stop-card.is-source {
  opacity: 0.22 !important; transform: none !important;
  box-shadow: none !important; background: rgba(10,12,18,.5) !important;
  border-style: dashed; cursor: default;
}
/* Drag: target slot (orange top border) */
.stop-card.is-drag-target {
  border-top: 2px solid var(--accent) !important;
  box-shadow: 0 -2px 8px var(--accent-glow) !important;
}

/* ── Bottom pill ── */
.setup-bottom-pill {
  position: absolute; bottom: 26px; left: 50%; transform: translateX(-50%); z-index: 500;
  display: flex; gap: 8px; padding: 9px;
  background: rgba(8,10,16,.84);
  border: 1px solid var(--border);
  backdrop-filter: blur(14px) saturate(1.3);
  box-shadow: 0 12px 36px rgba(0,0,0,.55);
  animation: s-fadeInUp .5s .34s ease-out both;
}
.setup-bottom-pill::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.07) 0 1px, transparent 1px 3px);
}
.setup-bottom-pill::after {
  content: ''; position: absolute; left: 12px; right: 12px; top: 0; height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent) 50%, transparent);
  box-shadow: 0 0 8px var(--accent-glow); opacity: .85;
}

/* ── Entry + micro animations ── */
@keyframes s-slideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes s-fadeInL   { from { transform: translateX(-30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes s-fadeInR   { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes s-fadeInUp  { from { transform: translate(-50%, 30px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
@keyframes s-breathe   { 0%,100% { box-shadow: 0 0 12px var(--accent-glow); } 50% { box-shadow: 0 0 22px var(--accent-glow), 0 0 36px rgba(240,124,0,.25); } }
@keyframes s-dropDown  { from { opacity: 0; transform: scaleY(.92) translateY(-4px); } to { opacity: 1; transform: scaleY(1) translateY(0); } }
@keyframes s-dotPulse  { 0%,80%,100% { transform: scale(.5); opacity:.25 } 40% { transform: scale(1); opacity: 1; } }
```

- [ ] **Step 5: Commit**

```bash
git add style.css
git commit -m "refactor: replace setup screen CSS with dock/dropdown/stop-card v5 design"
```

---

### Task 3 — Update `js/setup.js`

**Files:**
- Modify: `js/setup.js`

- [ ] **Step 1: Replace `initSetupMap()`**

```js
export function initSetupMap() {
    if (setupMap) return;
    const el = document.getElementById('setup-map');
    if (!el || typeof L === 'undefined') return;

    setupMap = L.map('setup-map', {
        zoomControl: false, attributionControl: false,
        center: [52.1, 19.3], zoom: 5,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(setupMap);

    setupMap.on('click', e => setPickedFromMap(e.latlng.lat, e.latlng.lng, false));

    document.getElementById('btn-place-search')?.addEventListener('click', searchPlaces);
    document.getElementById('place-search')?.addEventListener('keydown', ev => {
        if (ev.key === 'Enter')  { ev.preventDefault(); searchPlaces(); }
        if (ev.key === 'Escape') { clearSearchResults(); }
    });

    // Close dropdown when clicking outside the add dock
    document.addEventListener('click', e => {
        if (!e.target.closest('.setup-dock-add')) clearSearchResults();
    });

    requestAnimationFrame(() => setupMap.invalidateSize());
}
```

- [ ] **Step 2: Replace `searchPlaces()`**

```js
async function searchPlaces() {
    const input     = document.getElementById('place-search');
    const q         = input?.value.trim();
    const resultsEl = document.getElementById('place-search-results');
    if (!q || !resultsEl) return;

    resultsEl.innerHTML = `
        <div class="sr-loading">
            <div class="sr-dots"><span></span><span></span><span></span></div>
            SCANNING...
        </div>
        <div class="sr-results"></div>
        <div class="sr-footer">
            <span><kbd class="sr-key">↑↓</kbd> NAVIGATE</span>
            <span><kbd class="sr-key">↵</kbd> SELECT</span>
            <span><kbd class="sr-key">ESC</kbd> CLOSE</span>
        </div>`;
    resultsEl.classList.add('open', 'loading');

    const lang = uiLang.code === 'pl' ? 'pl' : 'en';
    const url  = `${NOMINATIM_SEARCH}?q=${encodeURIComponent(q)}&format=json&limit=8&addressdetails=1&accept-language=${lang}`;

    try {
        const res  = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('nominatim');
        const data = await res.json();

        resultsEl.classList.remove('loading');
        const resultsDiv = resultsEl.querySelector('.sr-results');

        if (!data.length) {
            resultsDiv.innerHTML = `<div class="sr-item"><span class="sr-flag">🔍</span><div class="sr-name">${t('err_no_results')}</div></div>`;
            return;
        }

        resultsDiv.innerHTML = '';
        data.forEach(item => {
            const cc   = (item.address?.country_code ?? '').toUpperCase();
            const flag = cc.length === 2
                ? String.fromCodePoint(...[...cc].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))
                : '📍';
            const city    = item.name || (item.display_name || '').split(',')[0].trim();
            const country = item.address?.country ?? (item.display_name || '').split(',').slice(-1)[0]?.trim() ?? '';

            const row = document.createElement('div');
            row.className = 'sr-item';
            row.innerHTML = `<span class="sr-flag">${flag}</span>
                <div class="sr-name">${city}<small>${country}</small></div>`;
            row.addEventListener('click', () => {
                const lat = parseFloat(item.lat);
                const lon = parseFloat(item.lon);
                if (Number.isNaN(lat) || Number.isNaN(lon)) return;
                setPickedFromMap(lat, lon, true);
                const nameInput = document.getElementById('location-name');
                if (nameInput) nameInput.value = city;
                clearSearchResults();
                input.value = '';
            });
            resultsDiv.appendChild(row);
        });
    } catch (e) {
        console.warn(e);
        resultsEl.classList.remove('loading');
        const resultsDiv = resultsEl.querySelector('.sr-results');
        if (resultsDiv) resultsDiv.innerHTML = `<div class="sr-item"><span class="sr-flag">⚠️</span><div class="sr-name">${t('err_search_failed')}</div></div>`;
    }
}
```

- [ ] **Step 3: Replace `clearSearchResults()`**

```js
function clearSearchResults() {
    const box = document.getElementById('place-search-results');
    if (!box) return;
    box.classList.remove('open', 'loading');
}
```

- [ ] **Step 4: Replace `updateStopsList()`**

```js
export function updateStopsList() {
    const list    = document.getElementById('custom-stop-list');
    const countEl = document.getElementById('stop-count');
    list.innerHTML = '';

    if (S.customStops.length === 0) {
        list.innerHTML = `<p class="stops-empty">${t('empty_route')}</p>`;
        document.getElementById('btn-next').disabled = true;
        if (countEl) countEl.textContent = '0';
        return;
    }

    S.uniqueCountries.clear();
    S.uniqueTransports.clear();

    S.customStops.forEach((stop, index) => {
        S.uniqueCountries.add(stop.country);
        S.uniqueTransports.add(stop.type);

        const modeIcon = stop.type === 'moto' ? '🏍️' : '🚗';
        const num = String(index + 1).padStart(2, '0');
        const card = document.createElement('div');
        card.className = 'stop-card';
        card.draggable = true;
        card.dataset.index = index;
        card.innerHTML = `
            <span class="stop-handle">↕</span>
            <span class="stop-num">${num}</span>
            <div class="stop-card-name">${stop.name}<span class="stop-country"> (${stop.country})</span></div>
            <span class="stop-mode">${modeIcon}</span>
            <button class="btn-remove-stop" data-index="${index}" title="Remove">✖</button>`;
        list.appendChild(card);
    });

    if (countEl) countEl.textContent = S.customStops.length;
    document.getElementById('btn-next').disabled = S.customStops.length < 2;

    list.querySelectorAll('.btn-remove-stop').forEach(b =>
        b.addEventListener('click', e => removeStop(parseInt(e.currentTarget.getAttribute('data-index'), 10)))
    );
    list.querySelectorAll('.stop-card').forEach(item => {
        item.addEventListener('dragstart', dragStart);
        item.addEventListener('dragover',  dragOver);
        item.addEventListener('drop',      drop);
        item.addEventListener('dragenter', dragEnter);
        item.addEventListener('dragleave', dragLeave);
    });
}
```

- [ ] **Step 5: Replace drag handlers (class name update only)**

```js
export function dragStart(e) {
    S.setDraggedIndex(parseInt(e.currentTarget.getAttribute('data-index'), 10));
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => e.currentTarget.classList.add('is-source'), 0);
}
export function dragOver(e)  { e.preventDefault(); }
export function dragEnter(e) { e.preventDefault(); e.currentTarget.classList.add('is-drag-target'); }
export function dragLeave(e) { e.currentTarget.classList.remove('is-drag-target'); }
export function drop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('is-drag-target');
    const targetIndex = parseInt(e.currentTarget.getAttribute('data-index'), 10);
    if (S.draggedIndex === targetIndex || S.draggedIndex === null) return;
    const item = S.customStops.splice(S.draggedIndex, 1)[0];
    S.customStops.splice(targetIndex, 0, item);
    S.setDraggedIndex(null);
    updateStopsList();
}
```

- [ ] **Step 6: Add `resetAllStops()` at the bottom of `setup.js`**

```js
export function resetAllStops() {
    S.customStops.length = 0;
    S.uniqueCountries.clear();
    S.uniqueTransports.clear();
    updateStopsList();
}
```

- [ ] **Step 7: Commit**

```bash
git add js/setup.js
git commit -m "refactor: update setup.js — search dropdown, stop-card grid, drag classes, reset"
```

---

### Task 4 — Update `js/translations.js` and `js/main.js`

**Files:**
- Modify: `js/translations.js`
- Modify: `js/main.js`

- [ ] **Step 1: Update `btn_search` and add new keys in `translations.js`**

In `pl` object, update `btn_search` and add two keys after `empty_route`:
```js
btn_search:   'SZUKAJ',
// after empty_route:
stops_label:  'PRZYSTANKI',
btn_reset:    'RESET',
```

In `en` object, update `btn_search` and add two keys after `empty_route`:
```js
btn_search:   'SCAN',
// after empty_route:
stops_label:  'STOPS',
btn_reset:    'RESET',
```

- [ ] **Step 2: Update `changeLanguage()` lang button styling in `main.js`**

The new lang buttons use the `.active` CSS class (not inline styles). Replace in `changeLanguage()`:

```js
// OLD — remove this block:
const btnEn = document.getElementById('btn-en');
const btnPl = document.getElementById('btn-pl');
if (btnEn && btnPl) {
    btnEn.style.background = lang === 'en' ? 'var(--accent)' : 'var(--panel2)';
    btnEn.style.color      = lang === 'en' ? 'var(--bg)'     : 'var(--text)';
    btnPl.style.background = lang === 'pl' ? 'var(--accent)' : 'var(--panel2)';
    btnPl.style.color      = lang === 'pl' ? 'var(--bg)'     : 'var(--text)';
}

// NEW — replace with:
document.getElementById('btn-en')?.classList.toggle('active', lang === 'en');
document.getElementById('btn-pl')?.classList.toggle('active', lang === 'pl');
```

- [ ] **Step 3: Import `resetAllStops` in `main.js`**

Update the import from `./setup.js`:
```js
import {
    addDestination, updateStopsList, resetAllStops,
    goToAdvanced, backToSetup,
    dragStart, dragOver, dragEnter, dragLeave, drop, removeStop,
    initSetupMap,
} from './setup.js';
```

- [ ] **Step 4: Wire `#btn-reset-stops` in `DOMContentLoaded`**

In the `DOMContentLoaded` callback, after `document.getElementById('btn-next').addEventListener(...)`, add:
```js
document.getElementById('btn-reset-stops')?.addEventListener('click', resetAllStops);
```

- [ ] **Step 5: Commit**

```bash
git add js/translations.js js/main.js
git commit -m "feat: add stops_label/btn_reset translations; wire reset button; use CSS class for lang btns"
```

---

### Task 5 — Smoke test (manual, no code changes)

**Files:** none

- [ ] **Step 1: Serve and open**

```bash
npx serve .
```
Navigate to `http://localhost:3000`. Confirm:
- Setup screen: fullscreen map (desaturated), top bar with EXPEDITION brand + PL/EN/☕/👾 buttons
- Left dock slides in from left with search input + SCAN button + name input + transport select + ADD button
- Right dock slides in from right with section label "▸ YOUR ROUTE / 0 STOPS" + tour name block + empty state text
- Bottom pill fades up with RESET + NEXT (disabled, no glow)
- No browser console errors

- [ ] **Step 2: Search flow**

Type "Warsaw" in the search input. Verify:
- Dropdown opens with 3-dot loading animation + "SCANNING..." text
- After ~1s: results appear with flag emoji, city name, small country subtitle
- Hover on a result: orange background highlight
- Click a result: map pans to Warsaw, location name fills in, dropdown closes

- [ ] **Step 3: Add stops + stop cards**

1. Fill location name → click ADD → stop 01 appears in right dock (grid: handle / 01 / Warsaw (Poland) / 🚗 / ✖)
2. Add 2 more stops → count reaches 3 → NEXT gains `.active` glow + breathing animation

- [ ] **Step 4: Drag reorder**

Drag stop 01 onto stop 03. Verify:
- Dragged card fades to 22% opacity with dashed border (`.is-source`)
- Hovered target card shows orange top border (`.is-drag-target`)
- After drop: cards renumber correctly, no ghost classes remain

- [ ] **Step 5: RESET button**

Click RESET → all cards clear, count back to "0 STOPS", NEXT disabled again.

- [ ] **Step 6: Language switch**

Click PL → all `data-i18n` labels translate, PL button gets orange `.active` style, EN loses it.

- [ ] **Step 7: Full flow end-to-end**

Add 2+ stops → NEXT → advanced screen (unchanged style) → START JOURNEY → simulation screen (unchanged) → verify simulation plays normally.
