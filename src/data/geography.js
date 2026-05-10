// Bal'harm — Palermo geography: bbox, centre, coastline, arteries, mounts
window.Bh = window.Bh || {};
window.Bh.data = window.Bh.data || {};

// Bbox tightened on Palermo metro so the coastline reads correctly
window.Bh.data.BBOX = { latMin: 38.05, latMax: 38.25, lngMin: 13.20, lngMax: 13.60 };
window.Bh.data.CENTER = { lat: 38.1156, lng: 13.3617 }; // Quattro Canti

// Real Palermo coastline samples (lat, lng) — east → west around the bay,
// tracing Capo Zafferano, Aspra, Bandita, Foro Italico, La Cala, Acquasanta,
// the Mt. Pellegrino peninsula (Capo Gallo), Mondello and Sferracavallo.
window.Bh.data.COAST = [
  [38.135, 13.560], // Santa Flavia (E end)
  [38.110, 13.545], // Capo Zafferano
  [38.090, 13.520], // Porticello
  [38.085, 13.495], // Aspra
  [38.090, 13.460], // Ficarazzi shore
  [38.095, 13.430], // Bandita
  [38.105, 13.405], // Romagnolo
  [38.115, 13.385], // Sant'Erasmo
  [38.120, 13.372], // Foro Italico
  [38.130, 13.371], // La Cala (port mouth)
  [38.140, 13.371], // Arenella
  [38.155, 13.370], // Vergine Maria
  [38.170, 13.375], // Acquasanta
  [38.190, 13.380], // east flank of Pellegrino
  [38.210, 13.378], // NE Pellegrino
  [38.222, 13.365], // N tip of Mt. Pellegrino
  [38.220, 13.345], // Capo Gallo (NW Pellegrino)
  [38.215, 13.325], // S of Capo Gallo
  [38.205, 13.318], // Mondello bay E
  [38.200, 13.305], // Mondello shore
  [38.205, 13.290], // Capo Rama side
  [38.195, 13.260], // Sferracavallo
  [38.180, 13.225], // Carini W
  [38.170, 13.200], // far W coast
  // inland closure (south)
  [38.050, 13.200], // SW corner
  [38.050, 13.600], // SE corner
  [38.135, 13.600], // back up to E coast latitude
];

// Major Palermo arteries — polylines (lat,lng) drawn as stylized streets
window.Bh.data.STREETS = [
  // Cassaro / Corso Vittorio Emanuele (Porta Nuova → Porta Felice)
  { name: "Cassaro", w: 1.4, pts: [[38.1136,13.3528],[38.1141,13.3563],[38.1156,13.3617],[38.1162,13.3700]] },
  // Via Maqueda (Stazione Centrale → Politeama)
  { name: "Maqueda", w: 1.4, pts: [[38.1086,13.3656],[38.1115,13.3625],[38.1156,13.3617],[38.1196,13.3568],[38.1260,13.3540]] },
  // Via Roma (Stazione → Castello a Mare)
  { name: "Roma", w: 1.0, pts: [[38.1086,13.3666],[38.1130,13.3666],[38.1198,13.3651],[38.1220,13.3680]] },
  // Via della Libertà (Politeama → Stadio)
  { name: "Libertà", w: 1.2, pts: [[38.1260,13.3540],[38.1340,13.3490],[38.1430,13.3450],[38.1545,13.3415]] },
  // Foro Italico / lungomare sud
  { name: "Foro Italico", w: 1.0, pts: [[38.1210,13.3712],[38.1160,13.3760],[38.1100,13.3900],[38.1020,13.4150],[38.0950,13.4400]] },
  // Strada per Mondello / lungomare nord
  { name: "Mondello road", w: 1.0, pts: [[38.1583,13.3625],[38.1700,13.3550],[38.1850,13.3400],[38.2000,13.3100]] },
  // Circonvallazione (tangenziale)
  { name: "Circonvallazione", w: 1.1, pts: [[38.0900,13.3400],[38.1100,13.3300],[38.1300,13.3300],[38.1500,13.3380]] },
  // Via Lincoln / verso porto
  { name: "Lincoln", w: 0.8, pts: [[38.1086,13.3700],[38.1140,13.3720],[38.1200,13.3712]] },
];

window.Bh.data.MOUNTS = [
  { lat: 38.213, lng: 13.358, h: 1.6, r: 2.0, name: "Monte Pellegrino" },
  { lat: 38.115, lng: 13.555, h: 0.9, r: 1.0, name: "Capo Zafferano" },
  { lat: 38.080, lng: 13.310, h: 1.1, r: 1.4, name: "Monte Cuccio" },
  { lat: 38.100, lng: 13.260, h: 0.8, r: 1.0, name: "Monte Gradara" },
];
