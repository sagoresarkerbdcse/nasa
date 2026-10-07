/**
 * Ingests real NASA FIRMS hotspot CSVs (MODIS C6.1 and/or VIIRS S-NPP 375 m)
 * and writes public/data/grid.json + points.json.
 *
 * Get the CSVs with `npm run data:fetch-country` (public yearly archives, no
 * key), `npm run data:fetch` (Area API, needs FIRMS_MAP_KEY) or the FIRMS
 * Archive Download tool (https://firms.modaps.eosdis.nasa.gov/download/)
 * for the bounding box 88.0,20.5,92.75,26.75. Then:
 *
 *   npm run data:ingest -- pipeline/raw            # every *.csv in the folder
 *   npm run data:ingest -- a.csv b.csv             # specific files
 */
import { createReadStream, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DOMAIN } from "../src/lib/regions";
import { GridBuilder } from "./grid-builder";

const args = process.argv.slice(2);
const inputs = (args.length ? args : ["pipeline/raw"]).flatMap((p) =>
  statSync(p).isDirectory()
    ? readdirSync(p).filter((f) => f.toLowerCase().endsWith(".csv")).map((f) => join(p, f))
    : [p],
);
if (!inputs.length) {
  console.error("No CSV files found. Download FIRMS archives into pipeline/raw/ first.");
  process.exit(1);
}

// 2003 is the first full year with both Terra and Aqua MODIS. The 2001-2002
// country archives are also visibly incomplete (March 2002 has <10% of a
// normal March), so starting there would fake a trend.
const FIRST_YEAR = Number(process.env.FIRECAL_FIRST_YEAR ?? 2003);

const builder = new GridBuilder({
  bounds: DOMAIN,
  cellSize: 0.25,
  fireDayGrid: 0.01,
  firstYear: FIRST_YEAR,
  viirsStartYear: 2012,
  pointsPerYear: 900,
});

function parseConfidence(raw: string, sensor: 0 | 1): 0 | 1 | 2 {
  const v = raw.trim().toLowerCase();
  if (sensor === 0) {
    const n = Number(v);
    return n >= 80 ? 2 : n >= 30 ? 1 : 0; // MODIS C6.1 thresholds
  }
  if (v.startsWith("h")) return 2;
  if (v.startsWith("n")) return 1;
  return 0;
}

for (const file of inputs) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header: string[] | null = null;
  let col: Record<string, number> = {};
  let rows = 0;
  let skipped = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (!header) {
      header = parts.map((h) => h.trim().toLowerCase());
      col = Object.fromEntries(header.map((h, i) => [h, i]));
      continue;
    }
    const instrument = (parts[col.instrument] ?? "").toUpperCase();
    const sensor: 0 | 1 = instrument.includes("VIIRS") || "bright_ti4" in col ? 1 : 0;
    const [y, m, d] = (parts[col.acq_date] ?? "").split("-").map(Number);
    if (!y) continue;
    // Archive "type": 0 vegetation fire, 1 volcano, 2 static land source (gas flares,
    // kilns, industry), 3 offshore. Keep only vegetation/landscape fires.
    if ("type" in col && (parts[col.type] === "2" || parts[col.type] === "3")) {
      skipped++;
      continue;
    }
    builder.add({
      lon: Number(parts[col.longitude]),
      lat: Number(parts[col.latitude]),
      year: y,
      month: m,
      day: d,
      sensor,
      conf: parseConfidence(parts[col.confidence] ?? "", sensor),
      frp: Number(parts[col.frp] ?? 0),
    });
    rows++;
  }
  console.log(`${file}: ${rows.toLocaleString()} rows${skipped ? `, ${skipped} static/offshore skipped` : ""}`);
}

const out = builder.write(
  "public/data/grid.json",
  "public/data/points.json",
  "firms",
  `NASA FIRMS MODIS C6.1 + VIIRS S-NPP 375 m standard archive (country yearly files for Bangladesh, India, Myanmar, clipped). Static land sources and offshore detections removed. Record starts ${FIRST_YEAR}, the first full Terra + Aqua year.`,
);
console.log(`firms: ${builder.count.toLocaleString()} detections → ${out.cells} cells, ${out.records} cell-months, through ${out.lastYear}-${out.lastMonth}`);
