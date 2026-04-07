// ══════════════════════════════════════════════════════════
// STATE — wspólny stan całej aplikacji
// Importowany przez wszystkie pozostałe moduły
// ══════════════════════════════════════════════════════════

// ── Konfiguracja tras (wypełniana przez użytkownika w setup) ──
export let STOPS = [];
export let customStops = [];
export let uniqueCountries = new Set();
export let uniqueTransports = new Set();
export let fuelPricesByCountry = {};
export let consumptionByType = {};

// ── Stałe transportu ──
export const transportNames = {
    'auto':  '🚗 Auto',
    'moto':  '🏍️ Motocykl',
    'ferry': '⛴️ Prom',
    'train': '🚂 Pociąg'
};

export const lineColors  = { moto:'#f0a500', auto:'#f0a500', ferry:'#38bdf8', train:'#86efac' };
export const lineDash    = { moto:null, auto:null, ferry:'10,7', train:'5,4' };
export const lineWeight  = { moto:3.5, auto:3.5, ferry:2.5, train:2.5 };

// ── Prędkości animacji ──
export const ROAD_SPEEDS_KMS = [5, 10, 20, 40, 80, 160, 320, 640];
export const SPEED_LABELS    = ['¼×','½×','1×','2×','4×','8×','16×','32×'];
export let speedIdx = 2;

export const FERRY_KMS = 80;
export const TRAIN_KMS = 80;

// ── Stan animacji ──
export let routeSegments = [];
export let totalMotoKm = 0, totalFerryKm = 0, totalTrainKm = 0;
export let animRunning = false, animFrame = null;
export let curSeg = 0;
export let segFrac = 0;
export let lastTs  = null;

export let accumMotoKm = 0, accumFerryKm = 0, accumTrainKm = 0;
export let doneMotoKm  = 0, doneFerryKm  = 0, doneTrainKm  = 0;
export let accumFuel = 0, doneFuel = 0;
export let accumCost = 0, doneCost = 0;

// ── Stan mapy ──
export let map = null;
export let drawnPolylines = [];
export let currentPolyline = null;
export let vehicleMarker = null;
export let flagMarkers = [];
export let draggedIndex = null;

// ══════════════════════════════════════════════════════════
// Settery — pozwalają modułom modyfikować stan
// (eksportowane zmienne let można reassignować tylko przez settery)
// ══════════════════════════════════════════════════════════
export function setMap(m)                   { map = m; }
export function setSpeedIdx(i)              { speedIdx = i; }
export function setAnimRunning(v)           { animRunning = v; }
export function setAnimFrame(v)             { animFrame = v; }
export function setCurSeg(v)               { curSeg = v; }
export function setSegFrac(v)              { segFrac = v; }
export function setLastTs(v)               { lastTs = v; }
export function setCurrentPolyline(v)      { currentPolyline = v; }
export function setVehicleMarker(v)        { vehicleMarker = v; }
export function setDraggedIndex(v)         { draggedIndex = v; }
export function setRouteSegments(v)        { routeSegments = v; }
export function setSTOPS(v)                { STOPS = v; }

export function resetKm() {
    totalMotoKm = 0; totalFerryKm = 0; totalTrainKm = 0;
    accumMotoKm = 0; accumFerryKm = 0; accumTrainKm = 0;
    doneMotoKm  = 0; doneFerryKm  = 0; doneTrainKm  = 0;
    accumFuel = 0; doneFuel = 0;
    accumCost = 0; doneCost = 0;
}

export function addTotalKm(type, km) {
    if (type === 'moto' || type === 'auto') totalMotoKm += km;
    else if (type === 'ferry') totalFerryKm += km;
    else totalTrainKm += km;
}

export function addDoneKm(type, km) {
    if (type === 'moto' || type === 'auto') doneMotoKm += km;
    else if (type === 'ferry') doneFerryKm += km;
    else doneTrainKm += km;
}

export function updateAccum(type, partial) {
    accumMotoKm  = (type === 'moto' || type === 'auto') ? doneMotoKm + partial : doneMotoKm;
    accumFerryKm = type === 'ferry' ? doneFerryKm + partial : doneFerryKm;
    accumTrainKm = type === 'train' ? doneTrainKm + partial : doneTrainKm;
}

export function addDoneFuelCost(fuel, cost) {
    doneFuel += fuel;
    doneCost += cost;
    accumFuel = doneFuel;
    accumCost = doneCost;
}

export function updateAccumFuelCost(partialFuel, partialCost) {
    accumFuel = doneFuel + partialFuel;
    accumCost = doneCost + partialCost;
}

export function finalizeAccum() {
    accumMotoKm = totalMotoKm;
    accumFerryKm = totalFerryKm;
    accumTrainKm = totalTrainKm;
}