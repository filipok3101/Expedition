// ══════════════════════════════════════════════════════════
// STATE — wspólny stan całej aplikacji
// ══════════════════════════════════════════════════════════

export let STOPS = [];
export let customStops = [];
export let uniqueCountries = new Set();
export let uniqueTransports = new Set();
export let fuelPricesByCountry = {};
export let consumptionByType = {};

// Nazwa trasy nadana przez użytkownika
export let tourName = '';
export function setTourName(v) { tourName = v; }

// Opcje trasy — wypełniane w advanced screen przed symulacją
export let routeOptions = { avoidFerries: false, avoidMotorways: false, motorwayPerSegment: [] };
export function setRouteOptions(opts) { Object.assign(routeOptions, opts); }

// Tylko auto i moto — ferry wykrywane automatycznie z OSRM, train usunięty
export const transportNames = {
    'auto': '🚗 Auto',
    'moto': '🏍️ Moto',
};

export const lineColors = { moto: '#f0a500', auto: '#f0a500', ferry: '#38bdf8' };
export const lineDash   = { moto: null,      auto: null,      ferry: '10,7'    };
export const lineWeight = { moto: 3.5,       auto: 3.5,       ferry: 2.5       };

// Prędkości animacji
export const ROAD_SPEEDS_KMS = [5, 10, 20, 40, 80, 160, 320, 640];
export const SPEED_LABELS    = ['¼×', '½×', '1×', '2×', '4×', '8×', '16×', '32×'];
export let speedIdx = 2;

// Prędkość animacji promu (km/s w skali animacji) — taka sama jak droga
export const FERRY_KMS = 20;

// Stan animacji
export let routeSegments = [];
export let totalMotoKm = 0, totalFerryKm = 0;
export let animRunning = false, animFrame = null;
export let curSeg  = 0;
export let segFrac = 0;
export let lastTs  = null;

export let accumMotoKm = 0, accumFerryKm = 0;
export let doneMotoKm  = 0, doneFerryKm  = 0;
export let accumFuel = 0, doneFuel = 0;
export let accumCost = 0, doneCost = 0;

// Stan mapy
export let map = null;
export let drawnPolylines = [];
export let currentPolyline = null;
export let vehicleMarker = null;
export let flagMarkers = [];
export let draggedIndex = null;

// Settery
export function setMap(m)              { map = m; }
export function setSpeedIdx(i)         { speedIdx = i; }
export function setAnimRunning(v)      { animRunning = v; }
export function setAnimFrame(v)        { animFrame = v; }
export function setCurSeg(v)           { curSeg = v; }
export function setSegFrac(v)          { segFrac = v; }
export function setLastTs(v)           { lastTs = v; }
export function setCurrentPolyline(v)  { currentPolyline = v; }
export function setVehicleMarker(v)    { vehicleMarker = v; }
export function setDraggedIndex(v)     { draggedIndex = v; }
export function setRouteSegments(v)    { routeSegments = v; }
export function setSTOPS(v)            { STOPS = v; }

export function resetKm() {
    totalMotoKm = 0; totalFerryKm = 0;
    accumMotoKm = 0; accumFerryKm = 0;
    doneMotoKm  = 0; doneFerryKm  = 0;
    accumFuel = 0; doneFuel = 0;
    accumCost = 0; doneCost = 0;
}

export function addTotalKm(type, km) {
    if (type === 'ferry') totalFerryKm += km;
    else totalMotoKm += km;
}

export function addDoneKm(type, km) {
    if (type === 'ferry') doneFerryKm += km;
    else doneMotoKm += km;
}

export function updateAccum(type, partial) {
    accumMotoKm  = type === 'ferry' ? doneMotoKm  : doneMotoKm  + partial;
    accumFerryKm = type === 'ferry' ? doneFerryKm + partial : doneFerryKm;
}

export function addDoneFuelCost(fuel, cost) {
    doneFuel += fuel; doneCost += cost;
    accumFuel = doneFuel; accumCost = doneCost;
}

export function updateAccumFuelCost(partialFuel, partialCost) {
    accumFuel = doneFuel + partialFuel;
    accumCost = doneCost + partialCost;
}

export function finalizeAccum() {
    accumMotoKm  = totalMotoKm;
    accumFerryKm = totalFerryKm;
}