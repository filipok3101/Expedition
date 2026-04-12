// Narzędzia ogólne
export function escXml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
}

export function downloadBlob(data, filename, type) {
    const blob = data instanceof Blob ? data : new Blob([data], {type});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

// Matematyka geograficzna
export function latToMercY(lat, scale) {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1/Math.cos(r)) / Math.PI) / 2 * scale * 256;
}

export function lonToMercX(lon, scale) {
    return (lon+180)/360 * scale * 256;
}

export function geoToPixel(lat, lon, cLat, cLon, zoom, W, H) {
    const sc = Math.pow(2, zoom);
    return {
        x: lonToMercX(lon, sc) - lonToMercX(cLon, sc) + W/2,
        y: latToMercY(lat, sc) - latToMercY(cLat, sc) + H/2,
    };
}

export function kmToZoom(radiusKm, canvasSizePx) {
    const z = Math.log2((canvasSizePx * 40075) / (2 * radiusKm * 256));
    return Math.max(4, Math.min(15, Math.floor(z)));
}

// Interpolacja
export function interpSegPos(seg, frac) {
    const { coords, cum, distKm } = seg;
    if (frac <= 0) return coords[0];
    if (frac >= 1) return coords[coords.length-1];
    const target = frac * distKm;
    let lo = 0, hi = cum.length-1;
    while (lo < hi-1) { const mid=(lo+hi)>>1; if (cum[mid]<=target) lo=mid; else hi=mid; }
    const t = (target-cum[lo])/(cum[hi]-cum[lo]+1e-12);
    return [coords[lo][0]+(coords[hi][0]-coords[lo][0])*t, coords[lo][1]+(coords[hi][1]-coords[lo][1])*t];
}

export function getPartialCoords(seg, frac) {
    const { coords, cum, distKm } = seg;
    const target = frac * distKm;
    let hi = 1;
    while (hi < cum.length-1 && cum[hi] < target) hi++;
    return [...coords.slice(0, hi), interpSegPos(seg, frac)];
}