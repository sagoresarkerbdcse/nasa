/**
 * Merges per-year global outputs into the compact files the app loads:
 *   public/data/global/countries.json  monthly series for every country (+ world total)
 *   public/data/global/grid1.json      1° cells: yearly harmonized fire-days + monthly climatology
 *
 *   npx tsx pipeline/global-merge.ts <dirWithYearFiles>
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { YearOutput } from "./global-year";
import { buildEmissions, buildHarmonization, harmonizeCells } from "./harmonization-build";
import { writeDatasetTables } from "./dataset-tables";

const NF = 10;
const dir = process.argv[2] ?? "global-out";
const files = readdirSync(dir, { recursive: true } as never)
  .map(String)
  .filter((f) => /global-\d{4}\.json$/.test(f))
  .sort();
const years: YearOutput[] = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
years.sort((a, b) => a.year - b.year);
if (!years.length) throw new Error(`no global-YYYY.json files in ${dir}`);
const firstYear = years[0].year;
const lastYear = years[years.length - 1].year;
// Refuse to publish a record with holes: a missing year would read as "no fire".
const missing = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i).filter((y) => !years.some((x) => x.year === y));
if (missing.length && !process.env.ALLOW_GAPS) throw new Error(`missing years: ${missing.join(", ")} (re-run those jobs, or set ALLOW_GAPS=1)`);
const nY = lastYear - firstYear + 1;
console.log(`merging ${years.length} years ${firstYear}-${lastYear}`);

// --- countries -------------------------------------------------------------
const names = new Set<string>();
for (const y of years) Object.keys(y.countries).forEach((c) => names.add(c));
const countries: { name: string; bbox: [number, number, number, number] | null; data: number[] }[] = [];
const world = new Array(nY * 12 * NF).fill(0);
for (const name of [...names].sort()) {
  const data = new Array(nY * 12 * NF).fill(0);
  let bbox: [number, number, number, number] | null = null;
  for (const y of years) {
    const arr = y.countries[name];
    if (!arr) continue;
    const off = (y.year - firstYear) * 12 * NF;
    for (let i = 0; i < arr.length; i++) {
      data[off + i] = arr[i];
      world[off + i] += arr[i];
    }
    const b = y.bboxes[name];
    if (b) bbox = bbox ? [Math.min(bbox[0], b[0]), Math.min(bbox[1], b[1]), Math.max(bbox[2], b[2]), Math.max(bbox[3], b[3])] : b;
  }
  countries.push({ name, bbox, data });
}
// Overlap calibration factor for the world (used for 1° cells).
let v = 0;
let m = 0;
for (let i = 0; i < world.length; i += NF) {
  const yi = Math.floor(i / (12 * NF));
  if (firstYear + yi >= 2012) {
    m += world[i + 2];
    v += world[i + 3];
  }
}
const kWorld = m ? v / m : 1;

// --- 1° grid: v2 harmonization per cell (parents: 10° blocks → world) ----------
const cellIds = new Set<number>();
for (const y of years) Object.keys(y.cells).forEach((c) => cellIds.add(Number(c)));
const ids = [...cellIds].sort((a, b) => a - b);
const harmonization = buildHarmonization(years, countries, world, firstYear, lastYear);
const t0 = Date.now();
const cellsV2 = harmonizeCells(years, ids, firstYear, lastYear, harmonization.world);
console.log(`cell models: ${ids.length} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const { yearly, clim } = cellsV2;
const emissions = buildEmissions(years, countries.map((c) => c.name), firstYear, lastYear);

const outDir = process.env.GLOBAL_OUT ?? "public/data/global";
mkdirSync(outDir, { recursive: true });
const meta = {
  source: "NASA FIRMS MODIS C6.1 + VIIRS S-NPP 375 m standard archive, all-countries yearly files",
  generatedAt: new Date().toISOString(),
  firstYear,
  lastYear,
  viirsStartYear: 2012,
  fields: ["modisRaw", "viirsRaw", "modisFD", "viirsFD", "modisHigh", "viirsHigh", "modisFRP", "viirsFRP", "modisNight", "viirsNight"],
  kWorld: Math.round(kWorld * 100) / 100,
  sources: Object.fromEntries(years.map((y) => [y.year, y.sources])),
};
writeFileSync(join(outDir, "countries.json"), JSON.stringify({ meta, world, countries }));
// Compact per-year inputs for the harmonization model (satellite split, overpass times, matchups).
writeFileSync(
  join(outDir, "harmonization-inputs.json"),
  JSON.stringify({
    firstYear,
    lastYear,
    years: years.map((y) => ({ year: y.year, sat: y.sat ?? null, lst: y.lst ?? null, match: y.match ?? null, matchCountry: y.matchCountry ?? null, matchDt: y.matchDt ?? null })),
  }),
);
writeFileSync(join(outDir, "grid1.json"), JSON.stringify({ meta: { firstYear, lastYear, cellSize: 1, kWorld: meta.kWorld, method: "v2" }, ids, yearly, clim }));
writeFileSync(join(outDir, "harmonization.json"), JSON.stringify(harmonization));
if (emissions) writeFileSync(join(outDir, "emissions.json"), JSON.stringify(emissions));
// Open-dataset tables (not committed; the workflow packages them).
writeDatasetTables(process.env.DATASET_DIR ?? "dataset-build", { firstYear, lastYear, countries, world, ids, cellsV2, harmonization, emissions });
console.log(`countries.json: ${countries.length} countries; grid1.json: ${ids.length} cells; k(world) = ${meta.kWorld}`);
