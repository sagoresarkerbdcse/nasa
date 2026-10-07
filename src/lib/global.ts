/**
 * Global / per-country layer of FireCal.
 *
 * countries.json holds a harmonization-ready monthly series for every country
 * (and the world): raw counts, 0.01° fire-days, high-confidence counts, FRP and
 * night detections for MODIS and VIIRS. grid1.json holds 1° cells with yearly
 * harmonized fire-days and a monthly climatology. Analyses reuse the same
 * engine as the high-resolution Bangladesh record.
 */
import { ehsa, summarizeHotspots, type CellHotspot } from "./analytics";
import { analyzeSeries, emptyAcc, mannKendall, type Acc, type SeriesMeta } from "./harmonize";
import type { AoiAnalysis, BBox, GridFile, TrendResult } from "./types";

export const NF = 10;
export const WORLD_BBOX: BBox = [-180, -58, 180, 78];

export interface CountriesFile {
  meta: { source: string; generatedAt: string; firstYear: number; lastYear: number; viirsStartYear: number; fields: string[]; kWorld: number; sources: Record<string, Record<string, string>> };
  world: number[];
  countries: { name: string; bbox: BBox | null; data: number[] }[];
}

export interface Grid1File {
  meta: { firstYear: number; lastYear: number; cellSize: number; kWorld: number };
  ids: number[];
  yearly: number[];
  clim: number[];
}

export const seriesMeta = (cf: CountriesFile): SeriesMeta => ({ firstYear: cf.meta.firstYear, lastYear: cf.meta.lastYear, lastMonth: 12, viirsStartYear: cf.meta.viirsStartYear });

/** A GridFile-shaped meta block so shared UI (KPI strip, calendar) can render country/world analyses. */
export function pseudoMeta(cf: CountriesFile, label: string): GridFile["meta"] {
  return {
    source: "firms",
    generatedAt: cf.meta.generatedAt,
    cellSize: 1,
    fireDayGrid: 0.01,
    bounds: WORLD_BBOX,
    firstYear: cf.meta.firstYear,
    lastYear: cf.meta.lastYear,
    lastMonth: 12,
    viirsStartYear: cf.meta.viirsStartYear,
    notes: `${label}: NASA FIRMS MODIS C6.1 + VIIRS S-NPP all-countries archive, harmonized per country (0.01° fire-days, overlap calibration).`,
  };
}

export function toAcc(data: number[]): Acc[] {
  const out: Acc[] = [];
  for (let b = 0; b < data.length; b += NF) {
    const a = emptyAcc();
    a.modisRaw = data[b];
    a.viirsRaw = data[b + 1];
    a.modisFD = data[b + 2];
    a.viirsFD = data[b + 3];
    a.modisHigh = data[b + 4];
    a.viirsHigh = data[b + 5];
    out.push(a);
  }
  return out;
}

const analysisCache = new Map<string, AoiAnalysis>();
/** Full harmonized analysis for a country (or the world when name is null). */
export function analyzeCountry(cf: CountriesFile, name: string | null): AoiAnalysis {
  const key = `${cf.meta.generatedAt}|${name ?? "__world"}`;
  const hit = analysisCache.get(key);
  if (hit) return hit;
  const c = name ? cf.countries.find((x) => x.name === name) : null;
  const data = c ? c.data : cf.world;
  const a = analyzeSeries(toAcc(data), seriesMeta(cf), { bbox: c?.bbox ?? WORLD_BBOX, cellCount: 0, fallbackK: () => cf.meta.kWorld });
  analysisCache.set(key, a);
  return a;
}

export interface CountrySummary {
  name: string;
  bbox: BBox | null;
  total: number; // harmonized fire-days, whole record
  annual: number[];
  trend: TrendResult;
  k: number;
  frpPerFireDay: number; // mean FRP (MW) per VIIRS fire-day, 2012+
  nightShare: number; // share of VIIRS detections at night
}

export function summarizeCountries(cf: CountriesFile): CountrySummary[] {
  const { firstYear, lastYear, viirsStartYear, kWorld } = cf.meta;
  const nY = lastYear - firstYear + 1;
  return cf.countries
    .map((c) => {
      let m = 0;
      let v = 0;
      let frp = 0;
      let night = 0;
      let vraw = 0;
      for (let y = viirsStartYear; y <= lastYear; y++)
        for (let mo = 0; mo < 12; mo++) {
          const b = ((y - firstYear) * 12 + mo) * NF;
          m += c.data[b + 2];
          v += c.data[b + 3];
          frp += c.data[b + 7];
          night += c.data[b + 9];
          vraw += c.data[b + 1];
        }
      const k = m >= 40 ? v / m : kWorld;
      const annual: number[] = [];
      for (let y = 0; y < nY; y++) {
        let s = 0;
        for (let mo = 0; mo < 12; mo++) {
          const b = (y * 12 + mo) * NF;
          s += firstYear + y >= viirsStartYear ? c.data[b + 3] : c.data[b + 2] * k;
        }
        annual.push(Math.round(s));
      }
      return {
        name: c.name,
        bbox: c.bbox,
        total: annual.reduce((a, b) => a + b, 0),
        annual,
        trend: mannKendall(annual),
        k: Math.round(k * 100) / 100,
        frpPerFireDay: v ? Math.round((frp / v) * 10) / 10 : 0,
        nightShare: vraw ? Math.round((night / vraw) * 1000) / 1000 : 0,
      };
    })
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// 1° grid
// ---------------------------------------------------------------------------
export const cellCenter = (id: number): [number, number] => [(id % 360) - 180 + 0.5, Math.floor(id / 360) - 90 + 0.5];

const matrixCache = new WeakMap<Grid1File, Float64Array[]>();
export function grid1Matrix(g: Grid1File): Float64Array[] {
  let m = matrixCache.get(g);
  if (!m) {
    const nY = g.meta.lastYear - g.meta.firstYear + 1;
    m = g.ids.map((_, i) => Float64Array.from(g.yearly.slice(i * nY, (i + 1) * nY)));
    matrixCache.set(g, m);
  }
  return m;
}

/** Cell values for a year, or the typical value for a calendar month (recent 10-year climatology). */
export function grid1Values(g: Grid1File, year: number, month: number | null): Map<number, number> {
  const out = new Map<number, number>();
  if (month) g.ids.forEach((_, i) => g.clim[i * 12 + month - 1] > 0 && out.set(i, g.clim[i * 12 + month - 1]));
  else {
    const t = year - g.meta.firstYear;
    grid1Matrix(g).forEach((row, i) => row[t] > 0 && out.set(i, row[t]));
  }
  return out;
}

export function grid1Anomaly(g: Grid1File, year: number) {
  const t = year - g.meta.firstYear;
  const out = new Map<number, { value: number; baseline: number; change: number }>();
  const from = Math.max(0, t - 10);
  if (t - from < 3) return out;
  grid1Matrix(g).forEach((row, i) => {
    let s = 0;
    for (let j = from; j < t; j++) s += row[j];
    const baseline = s / (t - from);
    if (baseline < 2 && row[t] < 4) return;
    out.set(i, { value: row[t], baseline: Math.round(baseline * 10) / 10, change: Math.round(((row[t] - baseline) / Math.max(baseline, 1)) * 100) / 100 });
  });
  return out;
}

const ehsaCache = new WeakMap<Grid1File, CellHotspot[]>();
export function grid1Hotspots(g: Grid1File): CellHotspot[] {
  let r = ehsaCache.get(g);
  if (!r) {
    const nY = g.meta.lastYear - g.meta.firstYear + 1;
    r = ehsa(
      g.ids.map((id) => cellCenter(id)),
      grid1Matrix(g),
      Array.from({ length: nY }, (_, i) => i),
      1,
    ).map((c, i) => ({ ...c, cell: i }));
    ehsaCache.set(g, r);
  }
  return r;
}

export function grid1HotspotsIn(g: Grid1File, bbox: BBox | null) {
  const all = grid1Hotspots(g);
  return summarizeHotspots(bbox ? all.filter((c) => c.lon >= bbox[0] && c.lon <= bbox[2] && c.lat >= bbox[1] && c.lat <= bbox[3]) : all);
}

export function grid1Outlook(g: Grid1File, month: number, scale: number): Map<number, number> {
  const out = new Map<number, number>();
  g.ids.forEach((_, i) => {
    const v = g.clim[i * 12 + month - 1];
    if (v > 0.2) out.set(i, v * scale);
  });
  return out;
}

// ---------------------------------------------------------------------------
// FIRMS country names → Natural Earth (world-atlas) names
// ---------------------------------------------------------------------------
const ALIASES: Record<string, string> = {
  "united states": "united states of america",
  "democratic republic of the congo": "dem rep congo",
  "democratic republic of congo": "dem rep congo",
  "republic of the congo": "congo",
  "republic of congo": "congo",
  "central african republic": "central african rep",
  "south sudan": "s sudan",
  "bosnia and herzegovina": "bosnia and herz",
  "dominican republic": "dominican rep",
  "equatorial guinea": "eq guinea",
  "ivory coast": "côte divoire",
  "cote divoire": "côte divoire",
  "solomon islands": "solomon is",
  "western sahara": "w sahara",
  "czech republic": "czechia",
  swaziland: "eswatini",
  "north macedonia": "macedonia",
  "falkland islands": "falkland is",
  "east timor": "timor-leste",
  burma: "myanmar",
  "french southern and antarctic lands": "fr s antarctic lands",
  "northern cyprus": "n cyprus",
  "south korea": "south korea",
  "north korea": "north korea",
  "the bahamas": "bahamas",
  "republic of serbia": "serbia",
  "united republic of tanzania": "tanzania",
};
export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.'’,()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
export function atlasName(firmsName: string): string {
  const n = normName(firmsName);
  return ALIASES[n] ?? n;
}
