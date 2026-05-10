// One-shot script: re-anchor every curiosity to a meaningful real-world point.
// Queries OSM Nominatim for the named locations, then writes the new lat/lng
// straight into src/data/curiosities.js.
//
// Usage:  node scripts/fix-coords.mjs
//
// Nominatim policy: 1 request per second, identifiable User-Agent. We honour
// both. Conceptual entries (street food capital, sunshine hours, Liberty in
// general) are pinned to hard-coded points that fit the spirit of the entry.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, "../src/data/curiosities.js");

// Per-id resolution. Either:
//   - { query: "..." }          → look it up on Nominatim
//   - { query: "...", offset: { dlat, dlng } } → look up + small offset (to
//     spread two curiosities that share the exact same building)
//   - { lat, lng }              → fixed manual coords (for conceptual entries)
const PLAN = {
  1:  { query: "Quattro Canti, Palermo, Italy" },
  2:  { query: "Cattedrale di Palermo, Palermo" },
  3:  { lat: 38.1162, lng: 13.3608 },                       // generic historic centre
  4:  { query: "Archivio di Stato, Palermo" },
  5:  { query: "Museo Archeologico Salinas, Palermo" },
  6:  { query: "Museo Archeologico Salinas, Palermo", offset: { dlat: 0.00010, dlng: 0.00010 } },
  7:  { query: "Teatro Massimo, Palermo" },
  8:  { query: "Porta Nuova, Palermo" },
  9:  { query: "Palazzo dei Normanni, Palermo", offset: { dlat: 0.00006, dlng: -0.00010 } },
  10: { query: "Orto Botanico di Palermo" },
  11: { query: "Villa Bonanno, Palermo" },
  12: { query: "Orto Botanico di Palermo", offset: { dlat: 0.00010, dlng: 0.00010 } },
  13: { query: "Palazzo dei Normanni, Palermo", offset: { dlat: 0.00010, dlng: 0.00040 } },
  14: { query: "Teatro Politeama Garibaldi, Palermo" },
  15: { query: "Palazzina Cinese, Palermo" },
  16: { query: "Camera dello Scirocco, Palermo" },
  17: { query: "Cappella Palatina, Palermo" },
  18: { query: "Palazzo Chiaramonte Steri, Palermo" },
  19: { query: "Palazzo Valguarnera Gangi, Palermo" },
  20: { query: "Palazzo Pietratagliata, Palermo" },
  21: { query: "Villa Giulia, Palermo" },
  22: { query: "Castello di Maredolce, Palermo" },
  23: { lat: 38.1100, lng: 13.3505 },                        // Punic Necropolis (Caserma Tukory area)
  24: { query: "Fontana Pretoria, Palermo" },
  25: { query: "Grotte dell'Addaura, Palermo" },
  26: { query: "Palazzo Abatellis, Palermo" },
  27: { query: "Palazzo Abatellis, Palermo", offset: { dlat: 0.00012, dlng: 0.00018 } },
  28: { query: "Oratorio del Rosario di Santa Cita, Palermo" },
  29: { query: "Villa Igiea, Palermo" },
  30: { query: "Palazzo Chiaramonte Steri, Palermo", offset: { dlat: 0.00018, dlng: 0.00020 } },
  31: { query: "Palazzo Marchese, Palermo" },
  32: { query: "Palazzo dei Normanni, Palermo", offset: { dlat: 0.00018, dlng: 0.00010 } }, // Specola
  33: { query: "Mercato della Vucciria, Palermo" },
  34: { query: "La Cala, Palermo" },
  35: { query: "Catacombe dei Cappuccini, Palermo" },
  36: { query: "Castello della Zisa, Palermo" },
  37: { query: "Oratorio del Rosario di San Domenico, Palermo" },
  38: { query: "Santa Maria dell'Ammiraglio, Palermo" },     // Martorana
  39: { query: "Monte Pellegrino, Palermo" },
  40: { query: "Museo Geologico Gemmellaro, Palermo" },
  41: { query: "Mercato di Ballarò, Palermo" },
  42: { query: "Santuario di Santa Rosalia, Palermo" },
  43: { query: "La Cala, Palermo", offset: { dlat: -0.00050, dlng: -0.00150 } }, // ancient harbour mouth
  44: { query: "Chiesa del Gesù Casa Professa, Palermo" },
  45: { query: "Museo Internazionale delle Marionette Antonio Pasqualino, Palermo" },
  46: { lat: 38.1180, lng: 13.3500 },                        // generic — sunshine hours, west of centre
  47: { query: "Palazzo dei Normanni, Palermo" },
  48: { query: "Villino Florio, Palermo" },                  // Liberty exemplar
  49: { lat: 37.9180, lng: 13.7390 },                        // Targa Florio — Cerda area, kept
  50: { query: "Università degli Studi di Palermo" },
};

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "balharm-coord-fixer/1.0 (https://balharm.local; me@giuseppedichiara.com)";

async function lookup(query) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=it`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!j.length) return null;
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  console.log("→ Reading curiosities.js");
  let src = await fs.readFile(FILE, "utf8");

  // Cache: same query string → same coord. Avoids 50 round-trips when several
  // entries share a building (Salinas, Steri, Normanni, Abatellis, La Cala...).
  const cache = new Map();

  // Process ids in order, with delay between distinct queries.
  const ids = Object.keys(PLAN).map(Number).sort((a, b) => a - b);
  let queriesMade = 0;
  let idx = 0;
  for (const id of ids) {
    idx++;
    const plan = PLAN[id];
    let coords = null;

    if (plan.query) {
      if (cache.has(plan.query)) {
        coords = cache.get(plan.query);
        console.log(`  [${idx}/${ids.length}] id ${id}: cache hit "${plan.query}"`);
      } else {
        if (queriesMade > 0) await sleep(1100); // honour 1 req/s policy
        try {
          coords = await lookup(plan.query);
        } catch (e) {
          console.warn(`  [${idx}/${ids.length}] id ${id}: lookup failed (${e.message})`);
        }
        queriesMade++;
        if (coords) {
          cache.set(plan.query, coords);
          console.log(`  [${idx}/${ids.length}] id ${id}: "${plan.query}" → ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
        } else {
          console.warn(`  [${idx}/${ids.length}] id ${id}: no result for "${plan.query}", skipping`);
          continue;
        }
      }
      if (plan.offset) {
        coords = { lat: coords.lat + plan.offset.dlat, lng: coords.lng + plan.offset.dlng };
      }
    } else {
      coords = { lat: plan.lat, lng: plan.lng };
      console.log(`  [${idx}/${ids.length}] id ${id}: manual ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
    }

    // Patch the file. Curiosities are written as one entry per line with
    // `lat: NNN.NNNN, lng: NNN.NNNN`, on a line that starts with `{ id: N,`.
    const re = new RegExp(
      `(\\{\\s*id:\\s*${id},[^}]*?lat:\\s*)-?\\d+(?:\\.\\d+)?(\\s*,\\s*lng:\\s*)-?\\d+(?:\\.\\d+)?`,
      "m"
    );
    const before = src;
    src = src.replace(re, `$1${coords.lat.toFixed(4)}$2${coords.lng.toFixed(4)}`);
    if (src === before) {
      console.warn(`  ⚠️  could not patch id ${id} (regex miss)`);
    }
  }

  await fs.writeFile(FILE, src, "utf8");
  console.log(`✓ Patched ${ids.length} curiosities (${queriesMade} live queries, ${cache.size} unique locations).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
