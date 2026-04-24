
import * as S from './state.js';
import { t, uiLang } from './translations.js';

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';

let setupMap    = null;
let setupMarker = null;
let pickedLat   = null;
let pickedLon   = null;

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
}

function clearPickedPoint() {
    pickedLat = null;
    pickedLon = null;
    if (setupMarker && setupMap) { setupMap.removeLayer(setupMarker); setupMarker = null; }
}

function clearSearchResults() {
    const box = document.getElementById('place-search-results');
    if (!box) return;
    box.innerHTML = '';
    box.hidden = true;
}

async function searchPlaces() {
    const input    = document.getElementById('place-search');
    const q        = input?.value.trim();
    const resultsEl = document.getElementById('place-search-results');
    if (!q || !resultsEl) return;

    const lang = uiLang.code === 'pl' ? 'pl' : 'en';
    const url  = `${NOMINATIM_SEARCH}?q=${encodeURIComponent(q)}&format=json&limit=8&addressdetails=1&accept-language=${lang}`;

    try {
        const res  = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('nominatim');
        const data = await res.json();
        if (!data.length) { alert(t('err_no_results')); clearSearchResults(); return; }

        resultsEl.innerHTML = '';
        data.forEach(item => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'place-search-result';
            row.textContent = item.display_name || item.name || `${item.lat}, ${item.lon}`;
            row.addEventListener('click', () => {
                const lat = parseFloat(item.lat);
                const lon = parseFloat(item.lon);
                if (Number.isNaN(lat) || Number.isNaN(lon)) return;
                setPickedFromMap(lat, lon, true);
                const nameInput = document.getElementById('location-name');
                if (nameInput) nameInput.value = item.name || (item.display_name || '').split(',')[0].trim();
                clearSearchResults();
                input.value = '';
            });
            resultsEl.appendChild(row);
        });
        resultsEl.hidden = false;
    } catch (e) {
        console.warn(e);
        alert(t('err_search_failed'));
    }
}

export function initSetupMap() {
    if (setupMap) return;
    const el = document.getElementById('setup-map');
    if (!el || typeof L === 'undefined') return;

    setupMap = L.map('setup-map', { zoomControl: true, center: [52.1, 19.3], zoom: 5 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(setupMap);

    setupMap.on('click', e => setPickedFromMap(e.latlng.lat, e.latlng.lng, false));
    document.getElementById('btn-place-search')?.addEventListener('click', searchPlaces);
    document.getElementById('place-search')?.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); searchPlaces(); }
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

    let country = t('country_unknown');
    const locLang = uiLang.code === 'pl' ? 'pl' : 'en';
    try {
        const res  = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${parsedLat}&longitude=${parsedLon}&localityLanguage=${locLang}`);
        const data = await res.json();
        country = data.countryName || t('country_unknown');
    } catch (e) {
        console.warn('Geocoding unavailable:', e.message);
    }

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
    const list = document.getElementById('custom-stop-list');
    list.innerHTML = '';

    if (S.customStops.length === 0) {
        list.innerHTML = `<p style="color:var(--dim);font-size:1.25rem;text-align:center;margin-top:20px;">${t('empty_route')}</p>`;
        document.getElementById('btn-next').disabled = true;
        return;
    }

    S.uniqueCountries.clear();
    S.uniqueTransports.clear();

    S.customStops.forEach((stop, index) => {
        S.uniqueCountries.add(stop.country);
        S.uniqueTransports.add(stop.type);

        list.innerHTML += `
            <div class="draggable-stop" draggable="true" data-index="${index}">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="cursor:grab;font-size:1.2rem;">↕️</span>
                    <span><strong>${index + 1}. ${stop.name}</strong>
                        <span style="color:var(--dim);font-size:0.8rem;">(${stop.country})</span>
                    </span>
                </div>
                <div style="display:flex;align-items:center;gap:15px;">
                    <span>${S.transportNames[stop.type] ?? stop.type}</span>
                    <button class="btn-remove-stop" data-index="${index}"
                        style="background:transparent;border:none;color:#ff4d4d;cursor:pointer;font-size:1.2rem;"
                        title="Remove">✖</button>
                </div>
            </div>`;
    });

    document.getElementById('btn-next').disabled = S.customStops.length < 2;

    list.querySelectorAll('.btn-remove-stop').forEach(b =>
        b.addEventListener('click', e => removeStop(parseInt(e.currentTarget.getAttribute('data-index'), 10)))
    );
    list.querySelectorAll('.draggable-stop').forEach(item => {
        item.addEventListener('dragstart', dragStart);
        item.addEventListener('dragover',  dragOver);
        item.addEventListener('drop',      drop);
        item.addEventListener('dragenter', dragEnter);
        item.addEventListener('dragleave', dragLeave);
    });
}

export function dragStart(e) {
    S.setDraggedIndex(parseInt(e.currentTarget.getAttribute('data-index'), 10));
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => e.target.classList.add('dragging'), 0);
}
export function dragOver(e)  { e.preventDefault(); }
export function dragEnter(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
export function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
export function drop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
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
        const savedVal = saved[`price-${CSS.escape(country)}`] ?? saved[`price-${country}`] ?? '';
        div.innerHTML += `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--panel2);margin-bottom:8px;border:1px solid var(--border);">
                <span style="font-weight:bold;color:var(--accent);">${country}</span>
                <input type="number" id="price-${country}" placeholder="e.g. 1.65" step="0.01"
                    value="${savedVal}"
                    style="width:110px;padding:5px;background:var(--bg);border:1px solid var(--border);color:white;">
            </div>`;
    });

    div.querySelectorAll('input[type="number"]').forEach(inp => inp.addEventListener('input', validateAdvancedForm));
    validateAdvancedForm();
}

async function detectRouteCountries() {
    const msg = document.getElementById('countries-detecting-msg');
    msg.style.display = 'flex';
    msg.textContent   = 'Detecting countries along the route…';

    const locLang = 'en';
    for (let i = 0; i < S.customStops.length - 1; i++) {
        const a = S.customStops[i];
        const b = S.customStops[i + 1];
        // 4 próbki pośrednie wzdłuż odcinka po linii prostej
        for (const frac of [0.2, 0.4, 0.6, 0.8]) {
            const lat = a.lat + (b.lat - a.lat) * frac;
            const lon = a.lon + (b.lon - a.lon) * frac;
            try {
                const res  = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${locLang}`);
                const data = await res.json();
                const country = data.countryName?.trim();
                if (country && !S.uniqueCountries.has(country)) {
                    S.uniqueCountries.add(country);
                    buildCountriesList();
                }
            } catch { /* cicha obsługa — pomijamy punkt */ }
        }
    }

    msg.style.display = 'none';
}

export function goToAdvanced() {
    if (S.customStops.length < 2) { alert(t('alert_min_two_stops')); return; }

    document.getElementById('setup-screen').style.display    = 'none';
    document.getElementById('advanced-screen').style.display = 'flex';

    // ── Spalanie ──
    const transportDiv = document.getElementById('transport-consumption-list');
    transportDiv.innerHTML = '';
    S.uniqueTransports.forEach(type => {
        if (type === 'ferry') return;
        transportDiv.innerHTML += `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--panel2);margin-bottom:8px;border:1px solid var(--border);">
                <span style="font-weight:bold;color:var(--accent);">${S.transportNames[type] ?? type}</span>
                <input type="number" id="cons-${type}" placeholder="e.g. 6.5" step="0.1"
                    style="width:100px;padding:5px;background:var(--bg);border:1px solid var(--border);color:white;">
            </div>`;
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

    // ── Kraje — najpierw znane przystanki, potem detekcja ──
    buildCountriesList();
    detectRouteCountries();

    // Walidacja spalania
    document.querySelectorAll('#transport-consumption-list input[type="number"]')
        .forEach(inp => inp.addEventListener('input', validateAdvancedForm));
    validateAdvancedForm();
}

export function backToSetup() {
    document.getElementById('advanced-screen').style.display = 'none';
    document.getElementById('setup-screen').style.display    = 'flex';
    requestAnimationFrame(() => setupMap?.invalidateSize());
}

export function validateAdvancedForm() {
    const inputs = document.querySelectorAll('#advanced-screen input[type="number"]');
    const allFilled = [...inputs].every(i => i.value.trim() !== '');
    document.getElementById('btn-start-sim').disabled = !allFilled;
}