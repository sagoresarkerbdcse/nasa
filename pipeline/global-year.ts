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

/** Per country × month, split by satellite and day/night (fire-days use each satellite's own 0.01° cell-days). */
export const SAT_FIELDS = ["tDayFD", "tNightFD", "aDayFD", "aNightFD", "tDayFRP", "tNightFRP", "aDayFRP", "aNightFRP", "vDayFD", "vNightFD", "vDayFRP", "vNightFRP"] as const;
export const NS = SAT_FIELDS.length;

/**
 * Same-overpass matchups (VIIRS S-NPP vs Aqua MODIS, both crossing the equator at ~13:30).
 * A VIIRS "fire object" is a 0.01° cell with nominal/high-confidence VIIRS detections in one pass.
 * It counts as co-observed when Aqua detected fire within the 3×3 surrounding 1° cells, in the same
 * day/night pass, within ±MATCH_MIN minutes (so the area was inside the Aqua swath at that time);
 * it counts as detected when an Aqua fire pixel lies within its footprint (0.6 × the larger MODIS
 * pixel dimension + 0.5 km for geolocation and the VIIRS pixel).
 */
export const MATCH_MIN = 25;
export const LAT_BANDS = [-23.5, 0, 23.5, 50]; // → 5 bands: S extratropics, S tropics, N tropics, N temperate, boreal
export const FRP_EDGES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]; // MW → 13 bins
export const PIX_EDGES = [1.5, 2.5, 4, 7]; // MODIS pixel area km² (1 at nadir, ~10 at swath edge) → 5 bins
export const binOf = (v: number, edges: number[]) => {
  let i = 0;
  while (i < edges.length && v >= edges[i]) i++;
  return i;
};
export const matchIndex = (band: number, night: number, frpBin: number, pixBin: number) => ((band * 2 + night) * (FRP_EDGES.length + 1) + frpBin) * (PIX_EDGES.length + 1) + pixBin;
export const MATCH_CELLS = (LAT_BANDS.length + 1) * 2 * (FRP_EDGES.length + 1) * (PIX_EDGES.length + 1);

export interface YearOutput {
  year: number;
  /** country → flat 12 × NF month array */
  countries: Record<string, number[]>;
  /** country → [minLon, minLat, maxLon, maxLat] from its 1° cells holding 98% of fire-days */
  bboxes: Record<string, [number, number, number, number]>;
  /** 1° cell index → 12 × [modisFD, viirsFD] */
  cells: Record<string, number[]>;
  sources: Record<string, string>;
  /** country → flat 12 × NS (see SAT_FIELDS) */
  sat?: Record<string, number[]>;
  /** local solar time of detections (|lat| ≤ 40°), 96 × 15-min bins, per satellite */
  lst?: Record<"terra" | "aqua" | "snpp", number[]>;
  /** matchup table: MATCH_CELLS × [coObserved, detected] */
  match?: number[];
  /** country → [coObserved, detected, coObservedFRP, detectedFRP] */
  matchCountry?: Record<string, number[]>;
  /** minutes between matched VIIRS and Aqua detections, 0..MATCH_MIN */
  matchDt?: number[];
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

const result: YearOutput = {
  year,
  countries: {},
  bboxes: {},
  cells: {},
  sources: {},
  sat: {},
  lst: { terra: new Array(96).fill(0), aqua: new Array(96).fill(0), snpp: new Array(96).fill(0) },
  ...(year >= 2012 ? { match: new Array(MATCH_CELLS * 2).fill(0), matchCountry: {}, matchDt: new Array(MATCH_MIN + 1).fill(0) } : {}),
};

// Aqua fire pixels for matchups: fine index (0.1° cell × day × pass) → indices; coarse index (1° cell × day × pass) → pass summary.
const aq = { lat: [] as number[], lon: [] as number[], min: [] as number[], pix: [] as number[] };
const aqFine = new Map<number, number[]>();
const aqCoarse = new Map<number, { t0: number; t1: number; pixSum: number; n: number }>();
const fineKey = (doy: number, night: number, lat: number, lon: number) => ((doy * 2 + night) * 1800 + Math.floor((lat + 90) * 10)) * 3600 + Math.floor((lon + 180) * 10);
const coarseKey = (doy: number, night: number, iy: number, ix: number) => ((doy * 2 + night) * 180 + iy) * 360 + ix;
const minutesOf = (t: string) => {
  const s = t.trim().padStart(4, "0");
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(2, 4));
};
const KM_PER_DEG = 111.2;
const countryCells = new Map<string, Map<number, number>>(); // country → 1° cell → fire-days

async function download(url: string, dest: string) {
  // FIRMS refuses connections when many runners download at once: back off for up to ~8 minutes.
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return false;
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
      return true;
    } catch (e) {
      console.warn(`  retry ${attempt + 1}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, Math.min(120000, 4000 * 2 ** attempt) + Math.random() * 5000));
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
  const satSeen = new Set<number>();
  const sat = (result.sat![country] ??= new Array(12 * NS).fill(0));
  // VIIRS fire objects for matchups: (day, pass, 0.01° cell) → [frp, lat, lon, minute, night, month]
  const objects = new Map<number, number[]>();
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
    const night = (p[col.daynight] ?? "").trim() === "N" ? 1 : 0;
    if (night) acc[o + 8 + sensor] += 1;
    const satName = sensor === 1 ? "snpp" : (p[col.satellite] ?? "").trim().toUpperCase().startsWith("A") ? "aqua" : "terra";
    const minute = col.acq_time !== undefined ? minutesOf(p[col.acq_time] ?? "0") : 0;
    if (Math.abs(lat) <= 40) {
      const lst = (((minute / 60 + lon / 15) % 24) + 24) % 24;
      result.lst![satName][Math.min(95, Math.floor(lst * 4))] += 1;
    }
    if (conf >= 1) {
      const gx = Math.floor((lon + 180) * 100);
      const gy = Math.floor((lat + 90) * 100);
      const doy = (m - 1) * 31 + d;
      const frp = Number(p[col.frp]) || 0;
      // Satellite × day/night split (each satellite's own fire-days).
      const sIdx = satName === "terra" ? 0 : satName === "aqua" ? 1 : 2;
      const so = (m - 1) * NS;
      const sKey = ((doy * 36001 + gx) * 18001 + gy) * 6 + sIdx * 2 + night;
      if (!satSeen.has(sKey)) {
        satSeen.add(sKey);
        sat[so + (sIdx === 2 ? 8 : sIdx * 2) + night] += 1;
      }
      sat[so + (sIdx === 2 ? 10 : 4 + sIdx * 2) + night] += frp;
      if (result.match && satName === "aqua") {
        const scan = Number(p[col.scan]) || 1;
        const track = Number(p[col.track]) || 1;
        const i = aq.lat.length;
        aq.lat.push(lat);
        aq.lon.push(lon);
        aq.min.push(minute);
        aq.pix.push(Math.max(scan, track));
        const fk = fineKey(doy, night, lat, lon);
        const list = aqFine.get(fk);
        if (list) list.push(i);
        else aqFine.set(fk, [i]);
        const ck = coarseKey(doy, night, Math.min(179, Math.floor(lat + 90)), Math.min(359, Math.floor(lon + 180)));
        const c = aqCoarse.get(ck);
        if (c) {
          c.t0 = Math.min(c.t0, minute);
          c.t1 = Math.max(c.t1, minute);
          c.pixSum += scan * track;
          c.n++;
        } else aqCoarse.set(ck, { t0: minute, t1: minute, pixSum: scan * track, n: 1 });
      }
      if (result.match && sensor === 1) {
        const ok = ((doy * 2 + night) * 16 + Math.floor(minute / 90)) * 36001 * 18001 + gx * 18001 + gy;
        const obj = objects.get(ok);
        if (obj) obj[0] += frp;
        else objects.set(ok, [frp, lat, lon, minute, night, m]);
      }
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
  if (result.match && objects.size) matchObjects(country, objects);
  return rows;
}

/** Classify each VIIRS fire object as co-observed by Aqua (or not) and detected by Aqua (or not). */
function matchObjects(country: string, objects: Map<number, number[]>) {
  const mc = (result.matchCountry![country] ??= [0, 0, 0, 0]);
  for (const [key, [frp, lat, lon, minute, night, m]] of objects) {
    const doy = Math.floor(key / (16 * 36001 * 18001) / 2);
    void m;
    // Co-observation: an Aqua pass over the surrounding 1° cells at about the same time.
    const iy = Math.min(179, Math.floor(lat + 90));
    const ix = Math.min(359, Math.floor(lon + 180));
    let pixSum = 0;
    let pixN = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = aqCoarse.get(coarseKey(doy, night, iy + dy, (ix + dx + 360) % 360));
        if (c && minute >= c.t0 - MATCH_MIN && minute <= c.t1 + MATCH_MIN) {
          const w = dx === 0 && dy === 0 ? 4 : 1; // prefer the object's own cell for the pixel size
          pixSum += (c.pixSum / c.n) * w;
          pixN += w;
        }
      }
    if (!pixN) continue;
    // Detection: an Aqua fire pixel whose footprint covers the object.
    let detected = false;
    let bestDt = MATCH_MIN + 1;
    const coslat = Math.cos((lat * Math.PI) / 180);
    for (let dy = -1; dy <= 1 && !detected; dy++)
      for (let dx = -1; dx <= 1 && !detected; dx++) {
        const list = aqFine.get(fineKey(doy, night, lat + dy * 0.1, lon + dx * 0.1));
        if (!list) continue;
        for (const i of list) {
          const dt = Math.abs(aq.min[i] - minute);
          if (dt > MATCH_MIN) continue;
          const km = Math.hypot((aq.lat[i] - lat) * KM_PER_DEG, (aq.lon[i] - lon) * KM_PER_DEG * coslat);
          if (km <= 0.6 * aq.pix[i] + 0.5) {
            detected = true;
            bestDt = dt;
            break;
          }
        }
      }
    const band = binOf(lat, LAT_BANDS);
    const idx = matchIndex(band, night, binOf(frp, FRP_EDGES), binOf(pixSum / pixN, PIX_EDGES));
    result.match![idx * 2] += 1;
    mc[0] += 1;
    mc[2] += frp;
    if (detected) {
      result.match![idx * 2 + 1] += 1;
      mc[1] += 1;
      mc[3] += frp;
      result.matchDt![bestDt] += 1;
    }
  }
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
for (const arr of [...Object.values(result.countries), ...Object.values(result.sat!), ...Object.values(result.matchCountry ?? {})]) for (let i = 0; i < arr.length; i++) arr[i] = Math.round(arr[i]);
if (result.match) {
  const co = result.match.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
  const det = result.match.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
  console.log(`matchups: ${co.toLocaleString()} co-observed VIIRS fire objects, ${det.toLocaleString()} detected by Aqua MODIS (${((det / Math.max(co, 1)) * 100).toFixed(1)}%)`);
}

writeFileSync(join(out, `global-${year}.json`), JSON.stringify(result));
console.log(`wrote ${join(out, `global-${year}.json`)}: ${Object.keys(result.countries).length} countries, ${Object.keys(result.cells).length} cells`);
