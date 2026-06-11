// ══════════════════════════════════════════════════════════
// API — pojedynczy punkt dostępu do zewnętrznych usług
// (Valhalla, OSRM fallback, Nominatim, BigDataCloud)
// Wspólna obsługa: timeout (AbortController), retry z backoffem.
// ══════════════════════════════════════════════════════════

const VALHALLA_URL  = 'https://valhalla1.openstreetmap.de/route';
const OSRM_URL      = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const BDC_URL       = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/**
 * fetch → JSON z timeoutem i ponawianiem.
 * @param {string} url
 * @param {object} opts { timeoutMs, retries, retryDelayMs, init }
 */
export async function fetchJSON(url, { timeoutMs = 15000, retries = 1, retryDelayMs = 1200, init = {} } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...init, signal: ctrl.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            lastErr = e;
            if (attempt < retries) {
                // Backoff liniowy: 1×, 2×, 3× retryDelayMs
                await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
            }
        } finally {
            clearTimeout(tid);
        }
    }
    throw lastErr;
}

// ── Valhalla (główny router: profile auto/motorcycle, opcje trasy) ──
export function valhallaRoute(body) {
    return fetchJSON(VALHALLA_URL, {
        timeoutMs: 15000,
        retries:   1,
        retryDelayMs: 1500,
        init: {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        },
    });
}

// ── OSRM (router zapasowy: tylko profil driving, bez opcji trasy) ──
// steps=true → step.mode === 'ferry' pozwala wykryć przeprawy promowe.
export function osrmRoute(from, to) {
    const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`; // lon,lat
    const url = `${OSRM_URL}/${coords}?overview=false&steps=true&geometries=geojson`;
    return fetchJSON(url, { timeoutMs: 15000, retries: 1 });
}

// ── Nominatim (wyszukiwarka miejsc) ──
// Polityka użycia: identyfikacja przez Referer (przeglądarka wysyła
// automatycznie) + maks. 1 zapytanie/s — debounce zapewnia setup.js.
export function nominatimSearch(query, lang = 'en') {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}`
        + `&format=json&limit=8&addressdetails=1&dedupe=1&accept-language=${lang}`;
    return fetchJSON(url, {
        timeoutMs: 10000,
        retries:   0,
        init: { headers: { Accept: 'application/json' } },
    });
}

// ── BigDataCloud (odwrotne geokodowanie → nazwa kraju) ──
// UWAGA: zawsze localityLanguage=en — nazwy krajów są kluczami w
// fuelPricesByCountry; mieszanie języków tworzyłoby duplikaty
// („Niemcy" i „Germany" jako dwa różne kraje).
export async function reverseGeocodeCountry(lat, lon) {
    try {
        const data = await fetchJSON(
            `${BDC_URL}?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
            { timeoutMs: 8000, retries: 0 },
        );
        return data.countryName?.trim() || null;
    } catch {
        return null; // miękka degradacja — wywołujący decyduje co dalej
    }
}
