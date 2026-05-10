// Bal'harm — formatting + geometry helpers (year scale, distances, locale strings)
window.Bh = window.Bh || {};
window.Bh.lib = window.Bh.lib || {};

(function () {
  const YEAR_MIN = -10000, YEAR_MAX = 2024;

  // Eras shown along the timeline. `label` indexes into i18n.COPY[lang].eras.
  const ERAS = [
    { y: -10000, label: 0 }, { y: -500, label: 1 }, { y: 100, label: 2 },
    { y: 1100, label: 3 }, { y: 1500, label: 4 }, { y: 1650, label: 5 },
    { y: 1850, label: 6 }, { y: 2024, label: 7 },
  ];

  // Piecewise-linear log-ish year-to-percent so prehistory doesn't dominate.
  const BREAKS = [-10000, -1000, 0, 1000, 1500, 1700, 1900, 2024];
  const PCTS   = [0,      0.10,  0.18, 0.30, 0.50, 0.66, 0.84, 1];

  function yearToPct(y) {
    for (let i = 1; i < BREAKS.length; i++) {
      if (y <= BREAKS[i]) {
        const t = (y - BREAKS[i-1]) / (BREAKS[i] - BREAKS[i-1]);
        return PCTS[i-1] + t * (PCTS[i] - PCTS[i-1]);
      }
    }
    return 1;
  }

  function pctToYear(p) {
    for (let i = 1; i < PCTS.length; i++) {
      if (p <= PCTS[i]) {
        const t = (p - PCTS[i-1]) / (PCTS[i] - PCTS[i-1]);
        return Math.round(BREAKS[i-1] + t * (BREAKS[i] - BREAKS[i-1]));
      }
    }
    return YEAR_MAX;
  }

  function fmtYear(y, lang) {
    if (y < 0) return Math.abs(y) + (lang === "it" ? " a.C." : " BC");
    return String(y);
  }

  function haversineKm(a, b) {
    const R = 6371, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const A = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(A));
  }

  function fmtDist(km) {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1)} km`;
  }

  window.Bh.lib.format = {
    YEAR_MIN, YEAR_MAX, ERAS,
    yearToPct, pctToYear, fmtYear, haversineKm, fmtDist,
  };
})();
