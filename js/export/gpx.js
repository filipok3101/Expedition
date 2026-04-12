import * as S from '../state.js';
import { escXml, slugify, downloadBlob } from './utils.js';

export function exportGPX() {
    if (!S.STOPS.length || !S.routeSegments.length) {
        alert('No route loaded. Please run the simulation first.');
        return;
    }
    const routeName = S.tourName || S.STOPS.map(s => s.name).join(' → ');
    const totalKm   = Math.round(S.totalMotoKm + S.totalFerryKm);
    const now       = new Date().toISOString();
    const wpts = S.STOPS.map(s => `
  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}">
    <name>${escXml(s.name)}</name>
    <desc>${escXml(s.country)} · ${S.transportNames[s.type] ?? s.type}</desc>
  </wpt>`).join('');
    
    const trkpts = S.routeSegments.flatMap(seg =>
        seg.coords.map(([lat, lon]) => `\n      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>`)
    ).join('');
    
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Expedition Travel Simulator"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escXml(routeName)}</name>
    <desc>Total distance: ${totalKm} km · Road: ${Math.round(S.totalMotoKm)} km · Ferry: ${Math.round(S.totalFerryKm)} km</desc>
    <time>${now}</time>
  </metadata>
${wpts}
  <trk>
    <name>${escXml(routeName)}</name>
    <trkseg>${trkpts}
    </trkseg>
  </trk>
</gpx>`;
    
    downloadBlob(gpx, `expedition-route-${slugify(routeName)}.gpx`, 'application/gpx+xml');
}