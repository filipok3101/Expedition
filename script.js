    // ══════════════════════════════════════════════════════════
// DANE KONFIGURACYJNE (Wypełniane przez użytkownika)
// ══════════════════════════════════════════════════════════
let STOPS = [];
let customStops = [];
let uniqueCountries = new Set();
let uniqueTransports = new Set();

let fuelPricesByCountry = {};
let consumptionByType = {};

const transportNames = {
    'auto': '🚗 Auto',
    'moto': '🏍️ Motocykl',
    'ferry': '⛴️ Prom',
    'train': '🚂 Pociąg'
};

const lineColors = { moto:'#f0a500', auto:'#f0a500', ferry:'#38bdf8', train:'#86efac' };
const lineDash   = { moto:null, auto:null, ferry:'10,7', train:'5,4' };
const lineWeight = { moto:3.5, auto:3.5, ferry:2.5, train:2.5 };

// ── SPEED ──────────────────────────────────────────────
const ROAD_SPEEDS_KMS = [5, 10, 20, 40, 80, 160, 320, 640];
const SPEED_LABELS    = ['¼×','½×','1×','2×','4×','8×','16×','32×'];
let speedIdx = 2; // default: 1× = 20 virtual km/s

const FERRY_KMS = 80;
const TRAIN_KMS = 80;

// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
let routeSegments = [];
let totalMotoKm = 0, totalFerryKm = 0, totalTrainKm = 0;
let animRunning = false, animFrame = null;
let curSeg = 0;
let segFrac = 0;   
let lastTs  = null;

let accumMotoKm = 0, accumFerryKm = 0, accumTrainKm = 0;
let doneMotoKm = 0, doneFerryKm = 0, doneTrainKm = 0;

// Nowe zmienne do statystyk na żywo
let accumFuel = 0, doneFuel = 0;
let accumCost = 0, doneCost = 0;

let drawnPolylines = [];
let currentPolyline = null;
let vehicleMarker = null;
let flagMarkers = [];

// ══════════════════════════════════════════════════════════
// MAP - inicjalizowana dopiero gdy #app jest widoczny
// ══════════════════════════════════════════════════════════
let map = null;

function initMap() {
  if (map) return;
  map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    center: [62, 18],
    zoom: 4,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
}

// ══════════════════════════════════════════════════════════
// ROUTING via OSRM
// ══════════════════════════════════════════════════════════
function haversineKm(a, b) {
  const R=6371, dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
  const s = Math.sin(dLat/2)**2 + Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));
}

function densify(coords, maxGapKm=10) {
  const out=[];
  for(let i=0;i<coords.length-1;i++){
    out.push(coords[i]);
    const d=haversineKm(coords[i],coords[i+1]);
    const n=Math.ceil(d/maxGapKm);
    for(let k=1;k<n;k++){
      const t=k/n;
      out.push([coords[i][0]+(coords[i+1][0]-coords[i][0])*t,
                coords[i][1]+(coords[i+1][1]-coords[i][1])*t]);
    }
  }
  out.push(coords[coords.length-1]);
  return out;
}

async function fetchOsrmRoute(from, to) {
  const url = `https://router.project-osrm.org/route/v1/car/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(()=>ctrl.abort(), 10000);
      const r = await fetch(url, {signal:ctrl.signal});
      clearTimeout(tid);
      if (!r.ok) throw new Error('HTTP '+r.status);
      const d = await r.json();
      if (d.routes?.[0]?.geometry?.coordinates) {
        const raw = d.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
        return densify(raw, 5);
      }
      throw new Error('Brak trasy w odpowiedzi OSRM');
    } catch(e) {
      console.warn(`OSRM próba ${attempt} nieudana:`, e.message);
      if (attempt < 2) await new Promise(r=>setTimeout(r, 1000));
    }
  }
  console.error('OSRM całkowicie niedostępny – używam linii prostej');
  return densify([[from[0],from[1]],[to[0],to[1]]], 8);
}

// ══════════════════════════════════════════════════════════
// SETUP SCREENS - LOGIKA DODAWANIA PRZYSTANKÓW
// ══════════════════════════════════════════════════════════
async function addDestination() {
    const lat = document.getElementById('latitude').value.trim();
    const lon = document.getElementById('longitude').value.trim();
    const name = document.getElementById('location-name').value.trim();
    const type = document.getElementById('transport-type').value;

    if(!lat || !lon || !name) {
        alert("Wypełnij wszystkie pola (Szerokość, Długość i Nazwa)!");
        return;
    }

    const parsedLat = parseFloat(lat.replace(',', '.'));
    const parsedLon = parseFloat(lon.replace(',', '.'));

    if(isNaN(parsedLat) || isNaN(parsedLon)) {
        alert("Nieprawidłowe współrzędne — podaj liczby np. 52.23 i 21.01");
        return;
    }

    const btn = document.querySelector('.setup-left .btn');
    btn.disabled = true;
    btn.innerText = "⏳ SZUKANIE PAŃSTWA...";

    let country = "Nieznane";
    try {
        const response = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${parsedLat}&longitude=${parsedLon}&localityLanguage=pl`
        );
        const data = await response.json();
        country = data.countryName || "Nieznane";
    } catch(e) {
        console.warn("Geocoding niedostępny:", e.message);
    }

    customStops.push({ 
        name: name, 
        lat: parsedLat, 
        lon: parsedLon, 
        type: type, 
        country: country 
    });
    
    uniqueCountries.add(country);
    uniqueTransports.add(type); 

    updateStopsList();
    
    document.getElementById('latitude').value = '';
    document.getElementById('longitude').value = '';
    document.getElementById('location-name').value = '';

    btn.disabled = false;
    btn.innerText = "+ DODAJ MIEJSCE";
}

let draggedIndex = null;
function updateStopsList() {
    const list = document.getElementById('custom-stop-list');
    list.innerHTML = ''; 
    
    if(customStops.length === 0) {
        list.innerHTML = '<p style="color: var(--dim); font-size: 0.8rem; text-align: center; margin-top: 20px;">Trasa jest pusta 😒</p>';
        return;
    }

    // Czyścimy i budujemy na nowo zbiory państw/transportów, 
    // aby na ekranie kosztów nie było tych, które usunęliśmy.
    uniqueCountries.clear();
    uniqueTransports.clear();

    customStops.forEach((stop, index) => {
        uniqueCountries.add(stop.country);
        uniqueTransports.add(stop.type);

        // Tworzymy element z atrybutami Drag&Drop
        list.innerHTML += `
            <div class="draggable-stop" 
                 draggable="true" 
                 ondragstart="dragStart(event, ${index})" 
                 ondragover="dragOver(event)" 
                 ondrop="drop(event, ${index})"
                 ondragenter="dragEnter(event)"
                 ondragleave="dragLeave(event)">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="cursor: grab; font-size: 1.2rem;">↕️</span>
                    <span><strong>${index + 1}. ${stop.name}</strong> <span style="color: var(--dim); font-size: 0.8rem;">(${stop.country})</span></span>
                </div>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span>${transportNames[stop.type]}</span>
                    <button onclick="removeStop(${index})" style="background: transparent; border: none; color: #ff4d4d; cursor: pointer; font-size: 1.2rem;" title="Usuń przystanek">✖</button>
                </div>
            </div>
        `;
    });
    const btnNext = document.getElementById('btn-next');
    if (customStops.length >= 2) {
        btnNext.disabled = false;
    } else {
        btnNext.disabled = true;
    }
}

function validateAdvancedForm() {
    const inputs = document.querySelectorAll('#advanced-screen input[type="number"]');
    let allFilled = true;
    
    inputs.forEach(input => {
        if (input.value.trim() === '') {
            allFilled = false;
        }
    });
    
    document.getElementById('btn-start-sim').disabled = !allFilled;
}

function removeStop(index) {
    customStops.splice(index, 1); // Usuwamy 1 element z tablicy
    updateStopsList();            // Odświeżamy listę
}

function dragStart(e, index) {
    draggedIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => e.target.classList.add('dragging'), 0);
}

function dragOver(e) {
    e.preventDefault(); // Wymagane, aby pozwolić na upuszczenie
}

function dragEnter(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over'); // Efekt wizualny najechania
}

function dragLeave(e) {
    e.currentTarget.classList.remove('drag-over'); // Usunięcie efektu
}

function drop(e, targetIndex) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    if (draggedIndex === targetIndex || draggedIndex === null) return;

    // Wycinamy przesuwany element i wstawiamy w nowe miejsce
    const item = customStops.splice(draggedIndex, 1)[0];
    customStops.splice(targetIndex, 0, item);
    
    draggedIndex = null;
    updateStopsList();
}

function goToAdvanced() {
    if(customStops.length < 2) {
        alert("Musisz dodać co najmniej punkt startowy i końcowy (2 miejsca)!");
        return;
    }

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('advanced-screen').style.display = 'flex';

    const transportDiv = document.getElementById('transport-consumption-list');
    transportDiv.innerHTML = '';
    
    uniqueTransports.forEach(type => {
        transportDiv.innerHTML += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: var(--panel2); margin-bottom: 8px; border: 1px solid var(--border);">
                <span style="font-weight: bold; color: var(--accent);">${transportNames[type]}</span>
                <input type="number" id="cons-${type}" placeholder="np. 6.5" step="0.1" style="width: 100px; padding: 5px; background: var(--bg); border: 1px solid var(--border); color: white;">
            </div>
        `;
    });


    const countriesDiv = document.getElementById('countries-fuel-list');
    countriesDiv.innerHTML = '';
    
    uniqueCountries.forEach(country => {
        countriesDiv.innerHTML += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: var(--panel2); margin-bottom: 8px; border: 1px solid var(--border);">
                <span style="font-weight: bold; color: var(--accent);">${country}</span>
                <input type="number" id="price-${country}" placeholder="Cena / litr" step="0.01" style="width: 120px; padding: 5px; background: var(--bg); border: 1px solid var(--border); color: white;">
            </div>
        `;
    });
    validateAdvancedForm();
    const advancedInputs = document.querySelectorAll('#advanced-screen input[type="number"]');
    advancedInputs.forEach(input => {
        input.addEventListener('input', validateAdvancedForm);
    });
}
function backToSetup(){
    document.getElementById('advanced-screen').style.display = 'none';
    document.getElementById('setup-screen').style.display = 'flex';
}

// ══════════════════════════════════════════════════════════
// FINAL START & PRELOAD
// ══════════════════════════════════════════════════════════
function startFinalJourney() {
    uniqueTransports.forEach(type => {
        const consValue = document.getElementById(`cons-${type}`).value;
        consumptionByType[type] = parseFloat(consValue) || 0;
    });

    uniqueCountries.forEach(country => {
        const priceValue = document.getElementById(`price-${country}`).value;
        fuelPricesByCountry[country] = parseFloat(priceValue) || 0;
    });

    document.getElementById('advanced-screen').style.display = 'none';
    document.getElementById('app').style.display = 'grid';

    STOPS = [...customStops];
    
    // Przypisanie flag
    STOPS.forEach((s, idx) => {
        if (idx === 0 || idx === STOPS.length - 1) s.flag = "🏁";
        else s.flag = "🚩";
    });

    // Budowanie paska przystanków (prawy panel w głównej aplikacji)
    const stopListEl = document.getElementById('stop-list');
    stopListEl.innerHTML = '';
    STOPS.forEach((s,i)=>{
      const cls  = s.type==='ferry'?'ferry-stop':s.type==='train'?'train-stop':'';
      const icon = s.type==='ferry'?'⛴️':s.type==='train'?'🚂':s.type==='auto'?'🚗':'🏍️';
      const d = document.createElement('div');
      d.className=`stop-row ${cls}`; d.id=`stop-${i}`;
      d.innerHTML=`<div class="stop-dot"></div><span>${icon} ${s.name}</span>`;
      stopListEl.appendChild(d);
    });

    //budowanie tytułu trasy
    const title = STOPS.map(s => s.name).join(' → ');
    document.getElementById('route-title').textContent = `${title}`;

    document.getElementById('loading').style.display = 'flex';
    
    initMap();

    // Czekamy na layout przeglądarki żeby #map miał rzeczywiste wymiary
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            map.invalidateSize(true);
            updateStats();
            preloadRoutes();
        });
    });
}

async function preloadRoutes() {
  const fill = document.getElementById('loading-fill');
  const msg  = document.getElementById('loading-msg');
  routeSegments = [];
  totalMotoKm=0; totalFerryKm=0; totalTrainKm=0;

  for(let i=0;i<STOPS.length-1;i++){
    const from=STOPS[i], to=STOPS[i+1], type=STOPS[i+1].type;
    msg.textContent=`Trasa ${i+1}/${STOPS.length-1}: ${from.name} → ${to.name}`;
    fill.style.width=((i/(STOPS.length-2))*100)+'%';

    let coords;
    if(type==='ferry' || type==='train'){
      coords = densify([[from.lat,from.lon],[to.lat,to.lon]], 8);
    } else {
      coords = await fetchOsrmRoute([from.lat,from.lon],[to.lat,to.lon]);
    }

    const cum=[0];
    for(let k=1;k<coords.length;k++) cum.push(cum[k-1]+haversineKm(coords[k-1],coords[k]));
    const distKm=cum[cum.length-1];

    routeSegments.push({ coords, cum, type, distKm, from:from.name, to:to.name, country: from.country });
    
    if(type==='moto' || type==='auto') totalMotoKm+=distKm;
    else if(type==='ferry') totalFerryKm+=distKm;
    else totalTrainKm+=distKm;

    await new Promise(r=>setTimeout(r,80));
  }

  fill.style.width='100%';
  msg.textContent='Trasy załadowane! Gotowy do startu.';
  await new Promise(r=>setTimeout(r,600));
  document.getElementById('loading').style.display='none';

  routeSegments.forEach((seg, i) => {
    const distEl = document.createElement('div');
    distEl.className = 'stop-dist';
    distEl.textContent = `↓ ~${Math.round(seg.distKm)} km`;
    const stopRow = document.getElementById(`stop-${i}`);
    if (stopRow) stopRow.insertAdjacentElement('afterend', distEl);
  });
  
  placeFlag(STOPS[0], 0);
  document.getElementById('stop-0').classList.add('current');
}

// ══════════════════════════════════════════════════════════
// MAP HELPERS & ICONS
// ══════════════════════════════════════════════════════════
function interpPos(seg, frac) {
  const { coords, cum, distKm } = seg;
  if(frac<=0) return coords[0];
  if(frac>=1) return coords[coords.length-1];
  const target = frac * distKm;
  let lo=0, hi=cum.length-1;
  while(lo<hi-1){ const mid=(lo+hi)>>1; if(cum[mid]<=target) lo=mid; else hi=mid; }
  const t=(target-cum[lo])/(cum[hi]-cum[lo]+1e-12);
  return [
    coords[lo][0]+(coords[hi][0]-coords[lo][0])*t,
    coords[lo][1]+(coords[hi][1]-coords[lo][1])*t
  ];
}

function partialCoords(seg, frac) {
  const { coords, cum, distKm } = seg;
  const target = frac * distKm;
  let hi=1;
  while(hi<cum.length-1 && cum[hi]<target) hi++;
  const sub=coords.slice(0, hi);
  sub.push(interpPos(seg, frac));
  return sub;
}

function vehIcon(type) {
  const em  = type==='ferry'?'⛴️':type==='train'?'🚂':type==='auto'?'🚗':'🏍️';
  const cls = type==='ferry'?'ferry-v':type==='train'?'train-v':type==='auto'?'auto-v':'';
  return L.divIcon({ html:`<div class="vmarker ${cls}">${em}</div>`, iconSize:[38,38], iconAnchor:[19,19], className:'' });
}

function flagIcon(stop) {
  return L.divIcon({ html:`<div class="flag-mk" title="${stop.name}">${stop.flag}</div>`, iconSize:[22,22], iconAnchor:[2,20], className:'' });
}

function placeFlag(stop, idx) {
  const m=L.marker([stop.lat,stop.lon],{icon:flagIcon(stop),zIndexOffset:200}).addTo(map);
  m.bindTooltip(`<b>${stop.name}</b><br><small>${stop.country}</small>`,{direction:'top',offset:[0,-6]});
  flagMarkers.push(m);
  const el=document.getElementById(`stop-${idx}`);
  if(el){ el.classList.remove('current'); el.classList.add('done'); }
}

// ══════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════
function updateStats() {
  const total=accumMotoKm+accumFerryKm+accumTrainKm;
  document.getElementById('stat-total-km').textContent=Math.round(total).toLocaleString('pl-PL');
  // W statystykach moto zliczamy wszystkie drogi (auto+moto)
  document.getElementById('stat-moto-km').textContent=Math.round(accumMotoKm).toLocaleString('pl-PL');
  document.getElementById('stat-ferry-km').textContent=Math.round(accumFerryKm).toLocaleString('pl-PL');
  document.getElementById('stat-train-km').textContent=Math.round(accumTrainKm).toLocaleString('pl-PL');
  
  document.getElementById('stat-fuel').textContent=accumFuel.toFixed(1);
  document.getElementById('stat-cost').textContent=Math.round(accumCost).toLocaleString('pl-PL');
}

// ══════════════════════════════════════════════════════════
// ANIMATION
// ══════════════════════════════════════════════════════════
function getKmPerSec(type) {
  if(type==='ferry') return FERRY_KMS;
  if(type==='train') return TRAIN_KMS;
  return ROAD_SPEEDS_KMS[speedIdx];
}

function animStep(ts) {
  if(!animRunning) return;
  if(curSeg>=routeSegments.length){ finishJourney(); return; }

  const seg=routeSegments[curSeg];
  const dt = lastTs===null ? 0 : Math.min((ts-lastTs)/1000, 0.1); 
  lastTs=ts;

  if(dt>0) segFrac += getKmPerSec(seg.type) * dt / seg.distKm;

  if(segFrac>=1){
    segFrac=1;
    if(currentPolyline){ currentPolyline.setLatLngs(seg.coords); drawnPolylines.push(currentPolyline); currentPolyline=null; }
    
    if(seg.type==='moto' || seg.type==='auto') doneMotoKm+=seg.distKm;
    else if(seg.type==='ferry') doneFerryKm+=seg.distKm;
    else doneTrainKm+=seg.distKm;

    // Obliczanie finalnego kosztu za segment
    let segFuel = (seg.distKm / 100) * (consumptionByType[seg.type] || 0);
    let segCost = segFuel * (fuelPricesByCountry[seg.country] || 0);
    doneFuel += segFuel;
    doneCost += segCost;

    const si=curSeg+1;
    if(si<STOPS.length){
      placeFlag(STOPS[si],si);
      const nxt=document.getElementById(`stop-${si}`);
      if(nxt) nxt.classList.add('current');
    }
    curSeg++; segFrac=0; lastTs=null;
    if(curSeg>=routeSegments.length){ finishJourney(); return; }
    startSegment();
    animFrame=requestAnimationFrame(animStep);
    return;
  }

  const pos=interpPos(seg, segFrac);
  if(currentPolyline) currentPolyline.setLatLngs(partialCoords(seg, segFrac));

  if(!vehicleMarker){
    vehicleMarker=L.marker(pos,{icon:vehIcon(seg.type),zIndexOffset:600}).addTo(map);
  } else {
    vehicleMarker.setLatLng(pos);
    vehicleMarker.setIcon(vehIcon(seg.type));
  }

  map.panTo(pos, {animate:false});

  const partial=seg.distKm*segFrac;
  accumMotoKm  = (seg.type==='moto' || seg.type==='auto') ? doneMotoKm+partial : doneMotoKm;
  accumFerryKm = seg.type==='ferry' ? doneFerryKm+partial : doneFerryKm;
  accumTrainKm = seg.type==='train' ? doneTrainKm+partial : doneTrainKm;

  // Koszty liczone w locie podczas jazdy na podstawie państwa początkowego
  let partialFuel = (partial / 100) * (consumptionByType[seg.type] || 0);
  let partialCost = partialFuel * (fuelPricesByCountry[seg.country] || 0);
  accumFuel = doneFuel + partialFuel;
  accumCost = doneCost + partialCost;

  updateStats();

  const totalKm=totalMotoKm+totalFerryKm+totalTrainKm;
  const doneKm=accumMotoKm+accumFerryKm+accumTrainKm;
  document.getElementById('progress-fill').style.width=(doneKm/totalKm*100)+'%';

  updateInfoBar(seg);
  animFrame=requestAnimationFrame(animStep);
}

function startSegment() {
  if(curSeg>=routeSegments.length) return;
  const seg=routeSegments[curSeg];
  const opts={color:lineColors[seg.type], weight:lineWeight[seg.type], opacity:.9};
  if(lineDash[seg.type]) opts.dashArray=lineDash[seg.type];
  currentPolyline=L.polyline([seg.coords[0]], opts).addTo(map);
}

function updateInfoBar(seg) {
  document.getElementById('info-stage').textContent=`${seg.from} → ${seg.to}`;
  const labels={moto:'🏍️ MOTOR', auto:'🚗 AUTO', ferry:'⛴️ PROM', train:'🚂 POCIĄG'};
  const badge=document.getElementById('vbadge');
  badge.className=`vbadge ${seg.type}`;
  badge.textContent=labels[seg.type];
  document.getElementById('info-sub').textContent=`Odcinek: ~${Math.round(seg.distKm)} km · ${Math.round(segFrac*100)}%`;
}

function finishJourney() {
  animRunning=false;
  document.getElementById('playBtn').textContent='✓ META';
  document.getElementById('playBtn').classList.remove('active');
  document.getElementById('info-stage').textContent='🏁 Wyprawa ukończona!';
  document.getElementById('info-sub').textContent='Dojechaliśmy do celu!';
  document.getElementById('progress-fill').style.width='100%';
  accumMotoKm=totalMotoKm; accumFerryKm=totalFerryKm; accumTrainKm=totalTrainKm;
  updateStats();
  STOPS.forEach((_,i)=>{ const e=document.getElementById(`stop-${i}`); if(e){e.classList.add('done');e.classList.remove('current');} });
}

// ══════════════════════════════════════════════════════════
// CONTROLS
// ══════════════════════════════════════════════════════════
function togglePlay() {
  if(animRunning){
    animRunning=false; lastTs=null;
    cancelAnimationFrame(animFrame);
    document.getElementById('playBtn').textContent='▶ WZNÓW';
    document.getElementById('playBtn').classList.remove('active');
  } else {
    animRunning=true;
    document.getElementById('playBtn').textContent='⏸ PAUZA';
    document.getElementById('playBtn').classList.add('active');
    if(curSeg===0&&segFrac===0){
      startSegment();
      document.getElementById('stop-0').classList.add('done');
      map.setView([STOPS[0].lat,STOPS[0].lon],11,{animate:true});
    }
    animFrame=requestAnimationFrame(animStep);
  }
}

function changeSpeed(dir){
  speedIdx=Math.max(0,Math.min(ROAD_SPEEDS_KMS.length-1,speedIdx+dir));
  document.getElementById('speed-label').textContent=SPEED_LABELS[speedIdx];
}

function resetJourney(){
  animRunning=false; lastTs=null; cancelAnimationFrame(animFrame);
  curSeg=0; segFrac=0;
  accumMotoKm=0; accumFerryKm=0; accumTrainKm=0;
  doneMotoKm=0;  doneFerryKm=0;  doneTrainKm=0;
  accumFuel=0;   doneFuel=0;
  accumCost=0;   doneCost=0;
  
  drawnPolylines.forEach(p=>map.removeLayer(p)); drawnPolylines=[];
  flagMarkers.forEach(m=>map.removeLayer(m)); flagMarkers=[];
  if(currentPolyline){map.removeLayer(currentPolyline);currentPolyline=null;}
  if(vehicleMarker){map.removeLayer(vehicleMarker);vehicleMarker=null;}
  
  STOPS.forEach((_,i)=>{const e=document.getElementById(`stop-${i}`);if(e){e.classList.remove('done','current');}});
  
  document.getElementById('playBtn').textContent='▶ START';
  document.getElementById('playBtn').classList.remove('active');
  document.getElementById('info-stage').textContent='GOTOWY DO STARTU';
  document.getElementById('info-sub').textContent='Naciśnij START aby rozpocząć podróż';
  document.getElementById('progress-fill').style.width='0%';
  document.getElementById('stop-0').classList.add('current');
  
  placeFlag(STOPS[0],0);
  updateStats();
  map.setView([STOPS[0].lat,STOPS[0].lon],4,{animate:true});
}