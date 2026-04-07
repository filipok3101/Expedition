// ══════════════════════════════════════════════════════════
// SETUP — ekran konfiguracji trasy (krok 1 i 2)
// ══════════════════════════════════════════════════════════
import * as S from './state.js';
import { startFinalJourney } from './main.js';

// ── Dodawanie przystanku ──
export async function addDestination() {
    const lat  = document.getElementById('latitude').value.trim();
    const lon  = document.getElementById('longitude').value.trim();
    const name = document.getElementById('location-name').value.trim();
    const type = document.getElementById('transport-type').value;

    if (!lat || !lon || !name) {
        alert("Wypełnij wszystkie pola (Szerokość, Długość i Nazwa)!");
        return;
    }

    const parsedLat = parseFloat(lat.replace(',', '.'));
    const parsedLon = parseFloat(lon.replace(',', '.'));

    if (isNaN(parsedLat) || isNaN(parsedLon)) {
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

    S.customStops.push({ name, lat: parsedLat, lon: parsedLon, type, country });
    S.uniqueCountries.add(country);
    S.uniqueTransports.add(type);

    updateStopsList();

    document.getElementById('latitude').value = '';
    document.getElementById('longitude').value = '';
    document.getElementById('location-name').value = '';

    btn.disabled = false;
    btn.innerText = "+ DODAJ MIEJSCE";
}

// ── Lista przystanków z drag&drop ──
// ── Lista przystanków z drag&drop ──
export function updateStopsList() {
    const list = document.getElementById('custom-stop-list');
    list.innerHTML = '';

    if (S.customStops.length === 0) {
        list.innerHTML = '<p style="color: var(--dim); font-size: 0.8rem; text-align: center; margin-top: 20px;">Trasa jest pusta 😒</p>';
        document.getElementById('btn-next').disabled = true;
        return;
    }

    S.uniqueCountries.clear();
    S.uniqueTransports.clear();

    S.customStops.forEach((stop, index) => {
        S.uniqueCountries.add(stop.country);
        S.uniqueTransports.add(stop.type);

        // Zwróć uwagę na brak onclick i ondrag - dodaliśmy za to data-index="${index}"
        list.innerHTML += `
            <div class="draggable-stop"
                 draggable="true"
                 data-index="${index}">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="cursor: grab; font-size: 1.2rem;">↕️</span>
                    <span><strong>${index + 1}. ${stop.name}</strong>
                        <span style="color: var(--dim); font-size: 0.8rem;">(${stop.country})</span>
                    </span>
                </div>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span>${S.transportNames[stop.type]}</span>
                    <button class="btn-remove-stop" data-index="${index}"
                        style="background: transparent; border: none; color: #ff4d4d; cursor: pointer; font-size: 1.2rem;"
                        title="Usuń przystanek">✖</button>
                </div>
            </div>
        `;
    });

    document.getElementById('btn-next').disabled = S.customStops.length < 2;

    // --- NOWE: Podpinanie zdarzeń zaraz po wygenerowaniu HTML ---
    
    // 1. Podpinanie usuwania
    const removeBtns = list.querySelectorAll('.btn-remove-stop');
    removeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Pobieramy index z klikniętego przycisku
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            removeStop(idx);
        });
    });

    // 2. Podpinanie Drag & Drop
    const dragItems = list.querySelectorAll('.draggable-stop');
    dragItems.forEach(item => {
        item.addEventListener('dragstart', dragStart);
        item.addEventListener('dragover', dragOver);
        item.addEventListener('drop', drop);
        item.addEventListener('dragenter', dragEnter);
        item.addEventListener('dragleave', dragLeave);
    });
}

// ── Drag & Drop ──
export function dragStart(e) {
    // Odczytujemy index z elementu HTML, który właśnie złapaliśmy
    const index = parseInt(e.currentTarget.getAttribute('data-index'));
    S.setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => e.target.classList.add('dragging'), 0);
}

export function dragOver(e)  { e.preventDefault(); }

export function dragEnter(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}

export function dragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

export function drop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    // Odczytujemy index elementu, nad którym upuściliśmy obiekt
    const targetIndex = parseInt(e.currentTarget.getAttribute('data-index'));
    
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


// ── Nawigacja między ekranami ──
export function goToAdvanced() {
    if (S.customStops.length < 2) {
        alert("Musisz dodać co najmniej punkt startowy i końcowy (2 miejsca)!");
        return;
    }

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('advanced-screen').style.display = 'flex';

    // Spalanie
    const transportDiv = document.getElementById('transport-consumption-list');
    transportDiv.innerHTML = '';
    S.uniqueTransports.forEach(type => {
        transportDiv.innerHTML += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:var(--panel2); margin-bottom:8px; border:1px solid var(--border);">
                <span style="font-weight:bold; color:var(--accent);">${S.transportNames[type]}</span>
                <input type="number" id="cons-${type}" placeholder="np. 6.5" step="0.1"
                    style="width:100px; padding:5px; background:var(--bg); border:1px solid var(--border); color:white;">
            </div>
        `;
    });

    // Ceny paliwa
    const countriesDiv = document.getElementById('countries-fuel-list');
    countriesDiv.innerHTML = '';
    S.uniqueCountries.forEach(country => {
        countriesDiv.innerHTML += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:var(--panel2); margin-bottom:8px; border:1px solid var(--border);">
                <span style="font-weight:bold; color:var(--accent);">${country}</span>
                <input type="number" id="price-${country}" placeholder="Cena / litr" step="0.01"
                    style="width:120px; padding:5px; background:var(--bg); border:1px solid var(--border); color:white;">
            </div>
        `;
    });

    validateAdvancedForm();
    document.querySelectorAll('#advanced-screen input[type="number"]')
        .forEach(input => input.addEventListener('input', validateAdvancedForm));
}

export function backToSetup() {
    document.getElementById('advanced-screen').style.display = 'none';
    document.getElementById('setup-screen').style.display = 'flex';
}

export function validateAdvancedForm() {
    const inputs = document.querySelectorAll('#advanced-screen input[type="number"]');
    const allFilled = [...inputs].every(i => i.value.trim() !== '');
    document.getElementById('btn-start-sim').disabled = !allFilled;
}