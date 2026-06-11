// ══════════════════════════════════════════════════════════
// SETUP — ekran budowania trasy + ekran zaawansowany
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { t, uiLang } from './translations.js';
import { nominatimSearch, reverseGeocodeCountry } from './api.js';

let setupMap    = null;
let setupMarker = null;
let pickedLat   = null;
let pickedLon   = null;

// Stan wyszukiwarki (debounce + nawigacja klawiaturą)
let searchTimer  = null;
let lastQuery    = '';
let srItems      = [];
let srActiveIdx  = -1;

// Cache wykrytych krajów: sygnatura trasy → Set nazw krajów
const detectedCountriesCache = new Map();

function setPickedFromMap(lat, lng, flyTo = true) {
    pickedLat = lat;
    pickedLon = lng;
    const ll = L.latLng(lat, lng);
    if (!setupMarker) {
        setupMarker = L.marker(ll, { draggable: true }).addTo(setupMap);
        setupMarker.on('dragend', () => {
            const p = setupMarker.getLatLng();
            pickedLat = p.lat;
            pickedLon = p.lng;
        });
    } else {
        setupMarker.setLatLng(ll);
    }
    if (flyTo) setupMap.flyTo(ll, Math.max(setupMap.getZoom(), 10), { duration: 0.4 });
    // Mobile: rozwiń bottom-sheet, by pola nazwy i przycisk ADD były widoczne
    document.dispatchEvent(new CustomEvent('expedition:pin-picked', { detail: { lat, lng } }));
}

function clearPickedPoint() {
    pickedLat = null;
    pickedLon = null;
    if (setupMarker && setupMap) { setupMap.removeLayer(setupMarker); setupMarker = null; }
}

function clearSearchResults() {
    const box = document.getElementById('place-search-results');
    if (!box) return;
    box.classList.remove('open', 'loading');
    srItems     = [];
    srActiveIdx = -1;
}

function setActiveItem(idx) {
    srItems.forEach((el, i) => el.classList.toggle('active', i === idx));
    srActiveIdx = idx;
    srItems[idx]?.scrollIntoView({ block: 'nearest' });
}

async function searchPlaces() {
    const input     = document.getElementById('place-search');
    const q         = input?.value.trim();
    const resultsEl = document.getElementById('place-search-results');
    if (!q || !resultsEl) return;
    lastQuery = q;

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

    try {
        const data = await nominatimSearch(q, lang);

        // Użytkownik zdążył wpisać coś innego — ignoruj przeterminowaną odpowiedź
        if (input.value.trim() !== q) return;

        resultsEl.classList.remove('loading');
        const resultsDiv = resultsEl.querySelector('.sr-results');
        srItems     = [];
        srActiveIdx = -1;

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
            srItems.push(row);
        });
    } catch (e) {
        console.warn('Nominatim search failed:', e.message);
        resultsEl.classList.remove('loading');
        const resultsDiv = resultsEl.querySelector('.sr-results');
        if (resultsDiv) resultsDiv.innerHTML = `<div class="sr-item"><span class="sr-flag">⚠️</span><div class="sr-name">${t('err_search_failed')}</div></div>`;
    }
}

function initSearchBox() {
    const input = document.getElementById('place-search');
    if (!input) return;

    document.getElementById('btn-place-search')?.addEventListener('click', searchPlaces);

    // Debounced autocomplete — szanuje limit Nominatim (≤1 zapytanie/s)
    input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = input.value.trim();
        if (q.length < 3) { clearSearchResults(); return; }
        searchTimer = setTimeout(() => {
            if (q !== lastQuery) searchPlaces();
        }, 450);
    });

    // Nawigacja klawiaturą po wynikach (↑↓ / ↵ / ESC)
    input.addEventListener('keydown', ev => {
        const dropdownOpen = srItems.length > 0;
        switch (ev.key) {
            case 'ArrowDown':
                if (!dropdownOpen) return;
                ev.preventDefault();
                setActiveItem(Math.min(srActiveIdx + 1, srItems.length - 1));
                break;
            case 'ArrowUp':
                if (!dropdownOpen) return;
                ev.preventDefault();
                setActiveItem(Math.max(srActiveIdx - 1, 0));
                break;
            case 'Enter':
                ev.preventDefault();
                clearTimeout(searchTimer);
                if (dropdownOpen && srActiveIdx >= 0) srItems[srActiveIdx].click();
                else searchPlaces();
                break;
            case 'Escape':
                clearSearchResults();
                break;
        }
    });
}

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

    initSearchBox();

    document.addEventListener('click', e => {
        if (!e.target.closest('.setup-dock-add')) clearSearchResults();
    });

    requestAnimationFrame(() => setupMap.invalidateSize());
}

export async function addDestination() {
    const name = document.getElementById('location-name').value.trim();
    const type = document.getElementById('transport-type').value; // 'auto' | 'moto'

    if (pickedLat === null || pickedLon === null) { alert(t('err_no_point')); return; }
    if (!name) { alert(t('err_no_name')); return; }

    const parsedLat = pickedLat;
    const parsedLon = pickedLon;

    const btn = document.getElementById('btn-add-destination');
    btn.disabled = true;
    btn.textContent = t('btn_add_loading');

    // Zawsze po angielsku — nazwa kraju jest kluczem cen paliwa (patrz api.js)
    const country = (await reverseGeocodeCountry(parsedLat, parsedLon)) ?? t('country_unknown');

    S.customStops.push({ name, lat: parsedLat, lon: parsedLon, type, country });
    S.uniqueCountries.add(country);
    S.uniqueTransports.add(type);

    updateStopsList();
    document.getElementById('location-name').value = '';
    document.getElementById('place-search').value  = '';
    clearSearchResults();
    clearPickedPoint();
    btn.disabled = false;
    btn.textContent = t('btn_add');
}

export function updateStopsList() {
    const list    = document.getElementById('custom-stop-list');
    const countEl = document.getElementById('stop-count');
    list.innerHTML = '';

    if (S.customStops.length === 0) {
        list.innerHTML = `<p class="stops-empty">${t('empty_route')}</p>`;
        document.getElementById('btn-next').disabled = true;
        const peekBtnE = document.getElementById('btn-next-peek');
        if (peekBtnE) peekBtnE.disabled = true;
        if (countEl) countEl.textContent = '0';
        const countMobileE = document.getElementById('stop-count-mobile');
        if (countMobileE) countMobileE.textContent = '0';
        return;
    }

    S.uniqueCountries.clear();
    S.uniqueTransports.clear();

    S.customStops.forEach((stop, index) => {
        S.uniqueCountries.add(stop.country);
        S.uniqueTransports.add(stop.type);

        const modeIcon = stop.type === 'moto' ? '🏍️' : '🚗';
        const num = String(index + 1).padStart(2, '0');
        const isFirst = index === 0;
        const isLast  = index === S.customStops.length - 1;
        const card = document.createElement('div');
        card.className = 'stop-card';
        card.draggable = true;
        card.dataset.index = index;
        card.innerHTML = `
            <span class="stop-handle">↕</span>
            <span class="stop-num">${num}</span>
            <div class="stop-card-name">${stop.name}<span class="stop-country"> (${stop.country})</span></div>
            <span class="stop-reorder" data-index="${index}">
                <button class="btn-move-up"   data-dir="-1" ${isFirst ? 'disabled' : ''} title="Move up">▲</button>
                <button class="btn-move-down" data-dir="1"  ${isLast  ? 'disabled' : ''} title="Move down">▼</button>
            </span>
            <span class="stop-mode">${modeIcon}</span>
            <button class="btn-remove-stop" data-index="${index}" title="Remove">✖</button>`;
        list.appendChild(card);
    });

    if (countEl) countEl.textContent = S.customStops.length;
    const countMobile = document.getElementById('stop-count-mobile');
    if (countMobile) countMobile.textContent = S.customStops.length;
    document.getElementById('btn-next').disabled = S.customStops.length < 2;
    const peekBtn = document.getElementById('btn-next-peek');
    if (peekBtn) peekBtn.disabled = S.customStops.length < 2;

    list.querySelectorAll('.btn-remove-stop').forEach(b =>
        b.addEventListener('click', e => removeStop(parseInt(e.currentTarget.getAttribute('data-index'), 10)))
    );
    list.querySelectorAll('.stop-reorder button').forEach(b =>
        b.addEventListener('click', e => {
            const idx = parseInt(e.currentTarget.parentElement.getAttribute('data-index'), 10);
            const dir = parseInt(e.currentTarget.getAttribute('data-dir'), 10);
            moveStop(idx, dir);
        })
    );
    list.querySelectorAll('.stop-card').forEach(item => {
        item.addEventListener('dragstart', dragStart);
        item.addEventListener('dragover',  dragOver);
        item.addEventListener('drop',      drop);
        item.addEventListener('dragenter', dragEnter);
        item.addEventListener('dragleave', dragLeave);
    });
}

function moveStop(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= S.customStops.length) return;
    const item = S.customStops.splice(index, 1)[0];
    S.customStops.splice(target, 0, item);
    updateStopsList();
}

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
export function removeStop(index) {
    S.customStops.splice(index, 1);
    updateStopsList();
}

function buildCountriesList() {
    const div = document.getElementById('countries-fuel-list');
    // Zachowaj wartości wpisane przez użytkownika przed przebudową listy
    const saved = {};
    div.querySelectorAll('input[type="number"]').forEach(inp => { saved[inp.id] = inp.value; });

    div.innerHTML = '';
    [...S.uniqueCountries].sort().forEach(country => {
        const row = document.createElement('div');
        row.className = 'adv-input-row';
        const label = document.createElement('span');
        label.className = 'adv-input-label';
        label.textContent = country;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.id = `price-${country}`;
        inp.className = 'adv-input-field';
        inp.placeholder = 'e.g. 1.65';
        inp.step = '0.01';
        inp.min = '0';
        inp.value = saved[inp.id] ?? '';
        row.append(label, inp);
        div.appendChild(row);
    });

    div.querySelectorAll('input[type="number"]').forEach(inp => inp.addEventListener('input', validateAdvancedForm));
    validateAdvancedForm();
}

// Sygnatura trasy do cache'u wykrytych krajów
function routeSignature() {
    return S.customStops.map(s => `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`).join('|');
}

async function detectRouteCountries() {
    if (S.customStops.length < 2) return;

    const msg = document.getElementById('countries-detecting-msg');
    const sig = routeSignature();

    // Trasa już przeskanowana — odtwórz z cache'u bez zapytań sieciowych
    if (detectedCountriesCache.has(sig)) {
        detectedCountriesCache.get(sig).forEach(c => S.uniqueCountries.add(c));
        buildCountriesList();
        return;
    }

    msg.style.display = 'flex';
    msg.textContent   = t('detecting_countries');

    // 4 próbki pośrednie wzdłuż każdego odcinka (po linii prostej)
    const samplePoints = [];
    for (let i = 0; i < S.customStops.length - 1; i++) {
        const a = S.customStops[i];
        const b = S.customStops[i + 1];
        for (const frac of [0.2, 0.4, 0.6, 0.8]) {
            samplePoints.push([
                a.lat + (b.lat - a.lat) * frac,
                a.lon + (b.lon - a.lon) * frac,
            ]);
        }
    }

    const results  = await Promise.allSettled(
        samplePoints.map(([lat, lon]) => reverseGeocodeCountry(lat, lon))
    );

    const detected = new Set();
    for (const r of results) {
        if (r.status === 'fulfilled' && r.value) detected.add(r.value);
    }
    detectedCountriesCache.set(sig, detected);

    let changed = false;
    detected.forEach(c => {
        if (!S.uniqueCountries.has(c)) { S.uniqueCountries.add(c); changed = true; }
    });
    if (changed) buildCountriesList();

    msg.style.display = 'none';
}

export function goToAdvanced() {
    if (S.customStops.length < 2) { alert(t('alert_min_two_stops')); return; }

    document.getElementById('setup-screen').style.display    = 'none';
    document.getElementById('advanced-screen').style.display = 'flex';

    // ── Spalanie (z zachowaniem wpisanych wartości) ──
    const transportDiv = document.getElementById('transport-consumption-list');
    const savedCons = {};
    transportDiv.querySelectorAll('input[type="number"]').forEach(inp => { savedCons[inp.id] = inp.value; });
    transportDiv.innerHTML = '';
    S.uniqueTransports.forEach(type => {
        if (type === 'ferry') return;
        const icon = type === 'moto' ? '🏍️' : '🚗';
        const row = document.createElement('div');
        row.className = 'adv-input-row';
        row.innerHTML = `
            <span class="adv-input-label">${icon} ${S.transportNames[type] ?? type}</span>
            <input type="number" id="cons-${type}" class="adv-input-field"
                placeholder="e.g. 6.5" step="0.1" min="0">`;
        transportDiv.appendChild(row);
        const inp = row.querySelector('input');
        inp.value = savedCons[inp.id] ?? '';
    });

    // ── Inicjalizacja per-segment motorway ──
    const nSegs = S.customStops.length - 1;
    const cur   = S.routeOptions.motorwayPerSegment;
    if (cur.length !== nSegs) {
        S.routeOptions.motorwayPerSegment = Array.from(
            { length: nSegs },
            (_, i) => i < cur.length ? cur[i] : S.routeOptions.avoidMotorways
        );
    }

    // ── Opcje trasy ──
    const optDiv = document.getElementById('route-options-list');
    optDiv.innerHTML = `
        <div class="adv-option-row">
            <div>
                <div class="adv-option-label">⛴️ AVOID FERRIES</div>
                <div class="adv-option-sub">Route around sea crossings</div>
            </div>
            <label class="exp-switch">
                <input type="checkbox" id="opt-avoid-ferries">
                <span class="exp-switch-slider"></span>
            </label>
        </div>
        <div class="adv-option-row">
            <div class="adv-option-main">
                <div>
                    <div class="adv-option-label">🛣️ AVOID MOTORWAYS</div>
                    <div class="adv-option-sub">No highways — route drawn in <span style="color:#e53935;font-weight:600">red</span></div>
                </div>
                <button id="opt-motorways-cfg" class="adv-settings-btn" title="Per-segment settings">⚙</button>
            </div>
            <label class="exp-switch">
                <input type="checkbox" id="opt-avoid-motorways">
                <span class="exp-switch-slider"></span>
            </label>
        </div>
        <div id="mw-per-segment" class="mw-per-segment"></div>`;

    document.getElementById('opt-avoid-ferries').checked = S.routeOptions.avoidFerries;
    document.getElementById('opt-avoid-ferries').addEventListener('change', e => {
        S.setRouteOptions({ avoidFerries: e.target.checked });
    });

    const mwCheckbox = document.getElementById('opt-avoid-motorways');
    const mwCfgBtn   = document.getElementById('opt-motorways-cfg');
    const mwPanel    = document.getElementById('mw-per-segment');

    function setMwPanelOpen(open) {
        mwPanel.classList.toggle('open', open);
        mwCfgBtn.classList.toggle('open', open);
    }

    function buildMwPanel() {
        mwPanel.innerHTML = '';
        for (let i = 0; i < nSegs; i++) {
            const a    = S.customStops[i];
            const b    = S.customStops[i + 1];
            const icon = b.type === 'moto' ? '🏍️' : '🚗';
            mwPanel.innerHTML += `
                <div class="mw-seg-row">
                    <span class="mw-seg-label">${icon} ${a.name} → ${b.name}</span>
                    <label class="exp-switch">
                        <input type="checkbox" id="mw-seg-${i}" ${S.routeOptions.motorwayPerSegment[i] ? 'checked' : ''}>
                        <span class="exp-switch-slider"></span>
                    </label>
                </div>`;
        }
        for (let i = 0; i < nSegs; i++) {
            document.getElementById(`mw-seg-${i}`).addEventListener('change', e => {
                S.routeOptions.motorwayPerSegment[i] = e.target.checked;
                const anyOn = S.routeOptions.motorwayPerSegment.some(v => v);
                S.setRouteOptions({ avoidMotorways: anyOn });
                mwCheckbox.checked = anyOn;
            });
        }
    }

    function syncMwUI() {
        const on = S.routeOptions.avoidMotorways;
        mwCfgBtn.style.display = on ? 'inline-flex' : 'none';
        if (!on) setMwPanelOpen(false);
    }

    mwCheckbox.checked = S.routeOptions.avoidMotorways;
    mwCheckbox.addEventListener('change', e => {
        const val = e.target.checked;
        S.routeOptions.motorwayPerSegment.fill(val);
        S.setRouteOptions({ avoidMotorways: val });
        buildMwPanel();
        syncMwUI();
        if (val) setMwPanelOpen(true);
    });

    mwCfgBtn.addEventListener('click', () => {
        setMwPanelOpen(!mwPanel.classList.contains('open'));
    });

    buildMwPanel();
    syncMwUI();
    if (S.routeOptions.avoidMotorways) setMwPanelOpen(true);

    // ── Kraje — najpierw znane przystanki, potem detekcja wzdłuż trasy ──
    buildCountriesList();
    detectRouteCountries();

    // Walidacja spalania
    document.querySelectorAll('#transport-consumption-list input[type="number"]')
        .forEach(inp => inp.addEventListener('input', validateAdvancedForm));
    validateAdvancedForm();
}

export function backToSetup() {
    document.getElementById('advanced-screen').style.display = 'none';
    document.getElementById('setup-screen').style.display    = 'block';
    requestAnimationFrame(() => setupMap?.invalidateSize());
}

export function validateAdvancedForm() {
    const inputs = document.querySelectorAll('#advanced-screen input[type="number"]');
    const allFilled = [...inputs].every(i => i.value.trim() !== '');
    document.getElementById('btn-start-sim').disabled = !allFilled;
}

export function resetAllStops() {
    S.customStops.length = 0;
    S.uniqueCountries.clear();
    S.uniqueTransports.clear();
    updateStopsList();
}
