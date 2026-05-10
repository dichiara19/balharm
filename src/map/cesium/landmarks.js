/* Bal'harm — landmark catalogue + OSM footprint resolution.
   The "real-colour reveal" of each spotlit monument is no longer done with a
   second clipped tileset (too heavy on the GPU and produced visible double-
   silhouettes). Instead, the duotone custom shader takes a list of reveal
   centres + radii and computes the boundary in the fragment with a smooth
   falloff — see scene.js. This module just supplies those centres + radii. */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};
window.Bh.map.cesium = window.Bh.map.cesium || {};

(function () {
  const LANDMARKS = [
    { key: "cattedrale",   name: "Cattedrale di Palermo",       lng: 13.3563, lat: 38.1142, radius: 95 },
    { key: "massimo",      name: "Teatro Massimo",              lng: 13.3578, lat: 38.1207, radius: 90 },
    { key: "normanni",     name: "Palazzo dei Normanni",        lng: 13.3530, lat: 38.1115, radius: 120 },
    { key: "politeama",    name: "Teatro Politeama Garibaldi",  lng: 13.3568, lat: 38.1252, radius: 75 },
    { key: "quattroCanti", name: "Quattro Canti",               lng: 13.3615, lat: 38.1157, radius: 85 },
    { key: "portaNuova",   name: "Porta Nuova",                 lng: 13.3527, lat: 38.1121, radius: 45 },
    { key: "portaFelice",  name: "Porta Felice",                lng: 13.3713, lat: 38.1196, radius: 45 },
    { key: "villaGiulia",  name: "Villa Giulia",                lng: 13.3756, lat: 38.1135, radius: 90 },
    { key: "villinoFlorio",name: "Villino Florio all'Olivuzza", lng: 13.3447, lat: 38.1378, radius: 60 },
    { key: "utveggio",     name: "Castello Utveggio",           lng: 13.3557, lat: 38.1521, radius: 55 },
    { key: "laCala",       name: "La Cala",                     lng: 13.3698, lat: 38.1212, radius: 110 },
    { key: "cappuccini",   name: "Catacombe dei Cappuccini",    lng: 13.3392, lat: 38.1118, radius: 80 },
    { key: "fontanaPretoria", name: "Fontana Pretoria",         lng: 13.3621, lat: 38.1155, radius: 18 },
    { key: "martorana",    name: "Santa Maria dell'Ammiraglio", lng: 13.3624, lat: 38.1149, radius: 28 },
    { key: "cataldo",      name: "San Cataldo",                 lng: 13.3622, lat: 38.1148, radius: 22 },
    { key: "eremiti",      name: "San Giovanni degli Eremiti",  lng: 13.3517, lat: 38.1133, radius: 40 },
    { key: "palatina",     name: "Cappella Palatina",           lng: 13.3530, lat: 38.1117, radius: 35 },
    { key: "ziso",         name: "Castello della Zisa",         lng: 13.3416, lat: 38.1255, radius: 55 },
    { key: "cinese",       name: "Palazzina Cinese",            lng: 13.3555, lat: 38.1235, radius: 50 },
  ];

  // ── OSM footprint fetch (cached) ──────────────────────────────────────
  const CACHE_VERSION = 2;
  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const OVERPASS_TIMEOUT_MS = 8000;

  function polygonCentroid(coords) {
    let area = 0, cx = 0, cy = 0;
    for (let i = 0, n = coords.length; i < n; i++) {
      const [x0, y0] = coords[i];
      const [x1, y1] = coords[(i + 1) % n];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    area *= 0.5;
    if (Math.abs(area) < 1e-12) {
      let mx = 0, my = 0;
      coords.forEach(([x, y]) => { mx += x; my += y; });
      return [mx / coords.length, my / coords.length];
    }
    return [cx / (6 * area), cy / (6 * area)];
  }

  async function fetchOsmFootprint(L) {
    const cacheKey = `bh.osm.v${CACHE_VERSION}.${L.key}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {}

    const safeName = L.name.replace(/"/g, "");
    const radiusSearch = Math.max(L.radius * 3, 200);
    const query = `[out:json][timeout:20];
      (
        way["name"~"${safeName}",i](around:${radiusSearch},${L.lat},${L.lng});
        relation["name"~"${safeName}",i](around:${radiusSearch},${L.lat},${L.lng});
      );
      out geom;`;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const r = await fetch(OVERPASS_URL, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      const j = await r.json();
      let ring = null;
      const way = j.elements?.find((e) => e.type === "way" && e.geometry?.length >= 3);
      if (way) {
        ring = way.geometry.map((p) => [p.lon, p.lat]);
      } else {
        const rel = j.elements?.find((e) => e.type === "relation" && e.members);
        if (rel) {
          const outer = rel.members.find((m) => m.role === "outer" && m.geometry?.length >= 3);
          if (outer) ring = outer.geometry.map((p) => [p.lon, p.lat]);
        }
      }
      if (!ring) return null;
      const result = { polygon: ring, centroid: polygonCentroid(ring) };
      try { localStorage.setItem(cacheKey, JSON.stringify(result)); } catch (e) {}
      return result;
    } catch (e) {
      console.warn(`[Bh] Overpass failed for "${L.key}":`, e.message || e);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchFootprints(subset) {
    const list = subset || LANDMARKS;
    const out = {};
    await Promise.all(list.map(async (L) => {
      const fp = await fetchOsmFootprint(L);
      if (fp) {
        out[L.key] = fp;
        console.log(`[Bh] OSM footprint for "${L.key}": ${fp.polygon.length} vertices, centroid ${fp.centroid[1].toFixed(5)},${fp.centroid[0].toFixed(5)}`);
      }
    }));
    return out;
  }

  // Build reveal configs (centre ECEF + radius metres) for the shader.
  // `roofH` defaults to 30m above sea level; later sampling can update it
  // — the centre Z drift only matters when very close to the roof.
  function makeRevealConfigs(landmarks, footprintsByKey, defaultRoofH = 35) {
    return landmarks.map((L) => {
      const fp = footprintsByKey?.[L.key];
      const lng = fp ? fp.centroid[0] : L.lng;
      const lat = fp ? fp.centroid[1] : L.lat;
      // Generously oversize the reveal radius so the no-duotone zone
      // visibly covers the whole building and not just its centre.
      const radius = L.radius * 1.3;
      return {
        key: L.key,
        centre: Cesium.Cartesian3.fromDegrees(lng, lat, defaultRoofH),
        radius,
      };
    });
  }

  window.Bh.map.cesium.landmarks = {
    LANDMARKS,
    polygonCentroid, fetchOsmFootprint, fetchFootprints,
    makeRevealConfigs,
  };
})();
