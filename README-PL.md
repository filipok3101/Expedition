# 🏍️ Expedition 🚗

Expedition to elegancka aplikacja jednostronicowa (SPA) stworzona dla podróżników, motocyklistów i miłośników road tripów. Nie tylko planuje trasę — ożywia Twoją podróż dzięki dynamicznym animacjom, jednocześnie pilnując budżetu paliwowego na trasie przez różne kraje.

![Expedition demo](assets/demo.gif)

---

## ✨ Główne funkcje

- **Inteligentne planowanie** — Dodawaj przystanki wyszukując miejsca lub klikając bezpośrednio na mapę. Zmieniaj kolejność metodą drag & drop.
- **Nazwij swoją wyprawę** — Nadaj ekspedycji własną nazwę (np. *Alpy Lato 2026*), która pojawi się w nagłówku, metadanych GPX i eksportowanych filmach.
- **Dynamiczna animacja trasy** — Obserwuj jak Twoja podróż ożywa w czasie rzeczywistym. Kontroluj prędkość pojazdu (¼× do 32×) i wizualizuj trasę zanim ruszysz w drogę.
- **Kalkulator paliwa i kosztów** — Wprowadź spalanie pojazdu i lokalne ceny paliwa w każdym kraju, aby otrzymać precyzyjny szacunek kosztów podróży.
- **Automatyczne wykrywanie promów** — System inteligentnie identyfikuje przeprawy morskie z danych routingu OSRM i automatycznie wyłącza je z obliczeń paliwowych.
- **Eksport GPX** — Pobierz pełną trasę jako plik `.gpx` z punktami, śladem i metadanymi. Importuj bezpośrednio do Garmin, Google Maps, OsmAnd, Komoot i wielu innych.
- **Eksport wideo** — Nagraj animowany przejazd trasy jako film `.webm`. Wybierz jeden z trzech formatów:
  - 🖥️ **Full HD** (1920×1080) — do YouTube i na pulpit
  - 🟥 **Instagram** (1080×1080) — kwadratowy format na posty
  - 📱 **TikTok** (1080×1920) — pionowy format na Reels i TikTok
- **Zaawansowane ustawienia wideo** — Dostosuj eksport: zoom kamery, styl mapy (ciemna lub OSM), przełączany panel statystyk i opcjonalny watermark.
- **Dwujęzyczny interfejs** — Przełączaj między angielskim a polskim w dowolnym momencie.

> **⚠️ Uwaga dotycząca eksportu wideo:** Karta z aplikacją Expedition musi pozostać aktywna i widoczna przez cały czas nagrywania. Przejście do innej karty przeglądarki spowoduje spowolnienie animacji, co skutkuje klatkowaniem, zacinaniem lub przerwami w wyeksportowanym filmie.

---

## 🚀 Jak zacząć

Nie wymaga żadnego procesu budowania — Expedition działa w całości w przeglądarce przy użyciu natywnych modułów JS.

1. Sklonuj repozytorium:
   ```bash
   git clone https://github.com/filipok3101/Expedition.git
   cd Expedition
   ```

2. Uruchom projekt za pomocą dowolnego lokalnego serwera HTTP (wymagane dla modułów ES):
   ```bash
   # Używając VS Code → zainstaluj rozszerzenie "Live Server" i kliknij "Go Live"
   # Lub używając Node.js:
   npx serve .
   # Lub używając Pythona:
   python -m http.server 8080
   ```

3. Otwórz `http://localhost:8080` (lub port podany przez Twój serwer) w przeglądarce.

> ⚠️ Otwieranie `index.html` bezpośrednio przez `file://` nie zadziała z powodu ograniczeń modułów ES.

---

## 🗺️ Jak to działa

1. **Zaplanuj trasę** — Wybierz start, cel i wszystkie „must-see" po drodze. Szukaj po nazwie lub kliknij na mapę. Nadaj swojej wyprawie nazwę.
2. **Skonfiguruj pojazd** — Ustaw spalanie dla każdego typu pojazdu i aktualne ceny paliwa w każdym kraju.
3. **Analizuj** — Sprawdź całkowity dystans, odcinki promowe, zużycie paliwa i szacunkowe koszty.
4. **Przeżyj ponownie** — Uruchom animację i obserwuj jak Twoja trasa ożywa.
5. **Eksportuj** — Pobierz trasę jako GPX lub nagraj animowany film, by podzielić się nim w mediach społecznościowych.

---

## 🛠️ Stack technologiczny

- **Frontend:** Vanilla JavaScript (moduły ES6), HTML5, CSS3
- **Mapy i routing:** [Leaflet](https://leafletjs.com/) + [OSRM](http://project-osrm.org/)
- **Geokodowanie:** [Nominatim](https://nominatim.org/) + [BigDataCloud](https://www.bigdatacloud.com/) (geokodowanie odwrotne)
- **Eksport wideo:** `MediaRecorder` API + `canvas.captureStream` (Chrome/Edge)
- **Kafelki map:** [OpenStreetMap](https://www.openstreetmap.org/) + [CartoDB Dark](https://carto.com/basemaps/) (do eksportu wideo)

---

## 📁 Struktura projektu

```
Expedition/
├── index.html                 # Główny HTML — trzyekranowe SPA
├── style.css                  # Wszystkie style (setup, symulacja, panel eksportu, modale)
├── js/
│   ├── main.js                # Punkt wejścia, inicjalizacja mapy, kontrolki, obsługa eksportu
│   ├── state.js               # Jedno źródło prawdy — cały współdzielony stan aplikacji
│   ├── setup.js               # Ekran konfiguracji trasy (wyszukiwanie, kliknięcia na mapę, drag & drop)
│   ├── routing.js             # Pobieranie tras z OSRM, wykrywanie promów, budowanie segmentów
│   ├── animation.js           # Pętla requestAnimationFrame do animacji na mapie Leaflet
│   ├── translations.js        # Słownik EN/PL
│   ├── export.js              # Plik barrel — reeksport modułów eksportu
│   └── export/
│       ├── config.js          # Wymiary layoutów, dostawcy kafelków, ustawienia nagrywania
│       ├── gpx.js             # Generowanie i pobieranie pliku GPX
│       ├── video.js           # Pętla nagrywania wideo oparta o MediaRecorder
│       ├── video-renderer.js  # Rysowanie na canvas: kafelki, trasy, pojazd, HUD
│       └── utils.js           # Matematyka Mercatora, helpery geograficzne, narzędzia pobierania
├── assets/
│   └── demo.gif               # Animacja demo aplikacji
├── CLAUDE.md                  # Przewodnik dla programistów (AI-assisted coding)
├── LICENSE                    # Licencja MIT
├── README.md                  # Dokumentacja (English)
└── README-PL.md               # Dokumentacja (Polski)
```

---

## 🗺️ Plan rozwoju

Przyszłe aktualizacje będą obejmować migrację na silnik routingu [Valhalla](https://github.com/valhalla/valhalla), co odblokuje:

- [ ] **Trasy widokowe** — Tryb „motocyklowy" priorytetyzujący kręte drogi i omijający autostrady
- [ ] **Zaawansowane omijanie** — Pomiń promy, opłaty drogowe lub określone regiony jednym kliknięciem
- [x] **Eksport i udostępnianie** — ~~Pobierz trasę jako plik `.gpx` lub wyeksportuj animację jako film~~ ✅ Gotowe!
- [ ] **Opowiadanie podróży** — Dodawaj zdjęcia do konkretnych przystanków, które wyskoczą podczas animacji
- [ ] **Globalny zasięg** — Rozszerzone dane mapowe dla regionów na całym świecie

---

## 🤝 Współpraca

Ten projekt jest open source i rozwija się dzięki opinii społeczności.

- ⭐ **Daj gwiazdkę** — to pomaga projektowi rosnąć i docierać do większej liczby podróżników
- 🐛 **Zgłoś problem** — znalazłeś buga lub masz pomysł na funkcję? [Daj mi znać](https://github.com/filipok3101/Expedition/issues)
- ☕ **Postaw mi kawę** — jeśli Expedition pomogło Ci zaplanować następną przygodę, [rozważ wsparcie rozwoju](https://buymeacoffee.com/filipok3101)

---

## 📄 Licencja

Rozpowszechniane na licencji MIT. Zobacz [LICENSE](LICENSE) po więcej informacji.

---

*Stworzone z ❤️ przez [Filipok3101](https://github.com/filipok3101) dla globalnej społeczności podróżników.*

🇬🇧 [English documentation is also available (README.md)](README.md)
