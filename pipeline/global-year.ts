/**
 * Global FIRMS processing for ONE year (run as a GitHub Actions matrix job).
 *
 * Downloads NASA FIRMS "all countries" yearly archives (MODIS C6.1 and, from
 * 2012, VIIRS S-NPP), streams every country's CSV, and aggregates:
 *   - per country × month: raw counts, fire-days (0.01° cell-days, nominal+high
 *     confidence, same definition as the Bangladesh record), high-confidence
 *     counts, summed FRP (MW) and night detections;
 *   - per 1° cell × year (and × month): MODIS / VIIRS fire-days and FRP.
 * Static land sources (gas flares, kilns) and offshore detections are dropped.
 *
 *   npx tsx pipeline/global-year.ts 2023 [outDir]
 */
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const FIELDS = ["modisRaw", "viirsRaw", "modisFD", "viirsFD", "modisHigh", "viirsHigh", "modisFRP", "viirsFRP", "modisNight", "viirsNight"] as const;
export const NF = FIELDS.length;

export interface YearOutput {
  year: number;
  /** country → flat 12 × NF month array */
  countries: Record<string, number[]>;
  /** country → [minLon, minLat, maxLon, maxLat] from its 1° cells holding 98% of fire-days */
  bboxes: Record<string, [number, number, number, number]>;
  /** 1° cell index → 12 × [modisFD, viirsFD] */
  cells: Record<string, number[]>;
  sources: Record<string, string>;
}

const year = Number(process.argv[2]);
const out = process.argv[3] ?? "global-out";
if (!year) {
  console.error("usage: global-year.ts <year> [outDir]");
  process.exit(1);
}
const BASE = process.env.FIRMS_COUNTRY_BASE ?? "https://firms.modaps.eosdis.nasa.gov/data/country";
const WORK = process.env.FIRMS_WORK ?? `/tmp/firms-${year}`;
mkdirSync(WORK, { recursive: true });
mkdirSync(out, { recursive: true });

const result: YearOutput = { year, countries: {}, bboxes: {}, cells: {}, sources: {} };
const countryCells = new Map<string, Map<number, number>>(); // country → 1° cell → fire-days

async function download(url: string, dest: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return false;
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
      return true;
    } catch (e) {
      console.warn(`  retry ${attempt + 1}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 4000 * 2 ** attempt));
    }
  }
  throw new Error(`download failed: ${url}`);
}

function listCsv(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listCsv(p) : f.toLowerCase().endsWith(".csv") ? [p] : [];
  });
}

async function processFile(file: string, sensor: 0 | 1) {
  const prefix = sensor === 0 ? `modis_${year}_` : `viirs-snpp_${year}_`;
  const country = basename(file, ".csv").replace(prefix, "").replace(/_/g, " ");
  const acc = (result.countries[country] ??= new Array(12 * NF).fill(0));
  const cc = countryCells.get(country) ?? new Map<number, number>();
  countryCells.set(country, cc);
  const seen = new Set<number>();
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let col: Record<string, number> | null = null;
  let rows = 0;
  for await (const line of rl) {
    if (!line) continue;
    const p = line.split(",");
    if (!col) {
      col = Object.fromEntries(p.map((h, i) => [h.trim().toLowerCase(), i]));
      continue;
    }
    if ("type" in col && (p[col.type] === "2" || p[col.type] === "3")) continue;
    const lat = Number(p[col.latitude]);
    const lon = Number(p[col.longitude]);
    const date = p[col.acq_date];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !date) continue;
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    if (!(m >= 1 && m <= 12)) continue;
    rows++;
    const cf = (p[col.confidence] ?? "").trim().toLowerCase();
    const conf = sensor === 0 ? (Number(cf) >= 80 ? 2 : Number(cf) >= 30 ? 1 : 0) : cf.startsWith("h") ? 2 : cf.startsWith("n") ? 1 : 0;
    const o = (m - 1) * NF;
    acc[o + sensor] += 1;
    if (conf === 2) acc[o + 4 + sensor] += 1;
    acc[o + 6 + sensor] += Number(p[col.frp]) || 0;
    if ((p[col.daynight] ?? "").trim() === "N") acc[o + 8 + sensor] += 1;
    if (conf >= 1) {
      const gx = Math.floor((lon + 180) * 100);
      const gy = Math.floor((lat + 90) * 100);
      const doy = (m - 1) * 31 + d;
      const key = (doy * 36001 + gx) * 18001 + gy;
      if (!seen.has(key)) {
        seen.add(key);
        acc[o + 2 + sensor] += 1;
        const cell = Math.min(179, Math.floor(lat + 90)) * 360 + Math.min(359, Math.floor(lon + 180));
        const arr = (result.cells[cell] ??= new Array(24).fill(0));
        arr[(m - 1) * 2 + sensor] += 1;
        cc.set(cell, (cc.get(cell) ?? 0) + 1);
      }
    }
  }
  return rows;
}

for (const [sensor, name, first] of [
  [0, "modis", 2000],
  [1, "viirs-snpp", 2012],
] as const) {
  if (year < first) continue;
  const url = `${BASE}/zips/${name}_${year}_all_countries.zip`;
  const zip = join(WORK, `${name}_${year}.zip`);
  const dir = join(WORK, name);
  console.log(`↓ ${url}`);
  const t0 = Date.now();
  if (!existsSync(zip) && !(await download(url, zip))) {
    console.warn(`  not available: ${url}`);
    result.sources[name] = "missing";
    continue;
  }
  console.log(`  ${(statSync(zip).size / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s; unzipping`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
  rmSync(zip);
  const files = listCsv(dir);
  let total = 0;
  for (const f of files) total += await processFile(f, sensor);
  rmSync(dir, { recursive: true, force: true });
  result.sources[name] = `${files.length} countries, ${total.toLocaleString()} detections`;
  console.log(`  ${name}: ${result.sources[name]} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// Country bboxes from the 1° cells that hold 98% of fire-days (drops far-flung islands).
for (const [country, cells] of countryCells) {
  const sorted = [...cells.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  if (!total) continue;
  let acc = 0;
  let b: [number, number, number, number] | null = null;
  for (const [cell, v] of sorted) {
    const lat = Math.floor(cell / 360) - 90;
    const lon = (cell % 360) - 180;
    b = b ? [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon + 1), Math.max(b[3], lat + 1)] : [lon, lat, lon + 1, lat + 1];
    acc += v;
    if (acc >= total * 0.98) break;
  }
  if (b) result.bboxes[country] = b;
}
// Round FRP to whole MW to keep files small.
for (const arr of Object.values(result.countries)) for (let i = 0; i < arr.length; i++) arr[i] = Math.round(arr[i]);

writeFileSync(join(out, `global-${year}.json`), JSON.stringify(result));
console.log(`wrote ${join(out, `global-${year}.json`)}: ${Object.keys(result.countries).length} countries, ${Object.keys(result.cells).length} cells`);
