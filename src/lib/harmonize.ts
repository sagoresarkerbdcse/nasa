/**
 * FireCal harmonization engine.
 *
 * MODIS (1 km, 2000→) and VIIRS (375 m, 2012→) hotspot counts cannot be compared
 * directly: VIIRS sees smaller fires and splits one fire into several pixels,
 * so a naive "MODIS before 2012, VIIRS after" series jumps 3-5× at the sensor
 * switch. We harmonize in three steps:
 *
 *   1. Confidence filter: drop low-confidence detections (MODIS < 30, VIIRS "l").
 *   2. Common-grid fire-days: snap every detection to the same fine grid and
 *      count unique (grid cell, day) pairs. Multiple 375 m pixels inside one
 *      cell on one day collapse to one fire-day. This removes most of the
 *      resolution bias. (Steps 1-2 run in the pipeline.)
 *   3. Overlap calibration: in the years both sensors fly, compute
 *      k = ΣVIIRS fire-days / ΣMODIS fire-days for the area of interest, and
 *      express the MODIS-only era in VIIRS-equivalent units (MODIS × k).
 *
 * Anomalies compare each month with the same calendar month in the previous
 * 10 years (z-score + % change). Trend uses Mann-Kendall + Sen's slope on
 * annual totals.
 */
import { RECORD_WIDTH, type AoiAnalysis, type BBox, type GridFile, type MonthStat, type SensorView, type TrendResult } from "./types";

export interface Acc {
  modisRaw: number;
  viirsRaw: number;
  modisFD: number;
  viirsFD: number;
  modisHigh: number;
  viirsHigh: number;
}

export const emptyAcc = (): Acc => ({ modisRaw: 0, viirsRaw: 0, modisFD: 0, viirsFD: 0, modisHigh: 0, viirsHigh: 0 });

export function cellsInBBox(grid: GridFile, bbox: BBox): Set<number> {
  const out = new Set<number>();
  grid.cells.forEach(([lon, lat], i) => {
    if (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]) out.add(i);
  });
  return out;
}

/** Time axis of a monthly series. */
export interface SeriesMeta {
  firstYear: number;
  lastYear: number;
  lastMonth: number;
  viirsStartYear: number;
}

function monthIndex(grid: { meta: SeriesMeta }, year: number, month: number) {
  return (year - grid.meta.firstYear) * 12 + (month - 1);
}

function aggregate(grid: GridFile, cells: Set<number> | null): Acc[] {
  const n = (grid.meta.lastYear - grid.meta.firstYear + 1) * 12;
  const acc = Array.from({ length: n }, emptyAcc);
  const r = grid.records;
  for (let i = 0; i < r.length; i += RECORD_WIDTH) {
    if (cells && !cells.has(r[i])) continue;
    const a = acc[monthIndex(grid, r[i + 1], r[i + 2])];
    if (!a) continue;
    a.modisRaw += r[i + 3];
    a.viirsRaw += r[i + 4];
    a.modisFD += r[i + 5];
    a.viirsFD += r[i + 6];
    a.modisHigh += r[i + 7];
    a.viirsHigh += r[i + 8];
  }
  return acc;
}

/** Overlap-period calibration factor k = ΣVIIRS fire-days / ΣMODIS fire-days. */
function calibrate(grid: { meta: SeriesMeta }, acc: Acc[]): { k: number; fd: number } {
  let v = 0;
  let m = 0;
  for (let y = grid.meta.viirsStartYear; y <= grid.meta.lastYear; y++) {
    for (let mo = 1; mo <= 12; mo++) {
      const a = acc[monthIndex(grid, y, mo)];
      v += a.viirsFD;
      m += a.modisFD;
    }
  }
  return { k: m > 0 ? v / m : 1, fd: m };
}

const domainKCache = new WeakMap<GridFile, number>();
export function domainK(grid: GridFile): number {
  let k = domainKCache.get(grid);
  if (k === undefined) {
    k = calibrate(grid, aggregate(grid, null)).k;
    domainKCache.set(grid, k);
  }
  return k;
}

function isMissing(grid: { meta: SeriesMeta }, year: number, month: number) {
  return year === grid.meta.lastYear && month > grid.meta.lastMonth;
}

export function analyzeAoi(grid: GridFile, bbox: BBox): AoiAnalysis {
  const cells = cellsInBBox(grid, bbox);
  return analyzeSeries(aggregate(grid, cells), grid.meta, { bbox, cellCount: cells.size, fallbackK: () => domainK(grid) });
}

/**
 * Full analysis of any monthly MODIS/VIIRS series (an AOI in the gridded
 * record, a country, or the world): harmonization, anomalies, climatology,
 * peak months and trend.
 */
export function analyzeSeries(acc: Acc[], meta: SeriesMeta, opts: { bbox: BBox; cellCount: number; fallbackK: () => number }): AoiAnalysis {
  const grid = { meta };
  const bbox = opts.bbox;
  const { firstYear, lastYear, viirsStartYear } = meta;

  // Small areas have too few overlap fire-days for a stable ratio: fall back to the wider factor.
  const local = calibrate(grid, acc);
  const useLocal = local.fd >= 40;
  const k = useLocal ? local.k : opts.fallbackK();

  const months: MonthStat[] = [];
  for (let y = firstYear; y <= lastYear; y++) {
    for (let mo = 1; mo <= 12; mo++) {
      const a = acc[monthIndex(grid, y, mo)];
      const viirsEra = y >= viirsStartYear;
      const harmonized = viirsEra ? a.viirsFD : a.modisFD * k;
      const naive = viirsEra ? a.viirsRaw : a.modisRaw;
      const raw = a.modisRaw + a.viirsRaw;
      const highFrac = raw > 0 ? (a.modisHigh + a.viirsHigh) / raw : 0;
      let agreement = 0.6; // single-sensor era: no cross-check available
      if (viirsEra && (a.modisFD > 0 || a.viirsFD > 0)) {
        agreement = 1 - Math.min(1, Math.abs(Math.log((a.viirsFD + 1) / (a.modisFD * k + 1))) / Math.log(4));
      }
      const sample = Math.min(1, Math.log10(1 + harmonized) / 2);
      const hci = raw > 0 ? Math.round(100 * (0.4 * highFrac + 0.35 * agreement + 0.25 * sample)) : 0;
      months.push({
        year: y,
        month: mo,
        modisRaw: a.modisRaw,
        viirsRaw: a.viirsRaw,
        modisFD: a.modisFD,
        viirsFD: a.viirsFD,
        naive,
        harmonized: round1(harmonized),
        hci,
        ratio: a.modisRaw > 0 && viirsEra ? round2(a.viirsRaw / a.modisRaw) : null,
        baseline: null,
        pctVsBaseline: null,
        z: null,
        anomaly: null,
        missing: isMissing(grid, y, mo),
      });
    }
  }

  // Anomalies: same calendar month, previous 10 years (need at least 5).
  for (const m of months) {
    if (m.missing) continue;
    const prev = months.filter((p) => p.month === m.month && p.year < m.year && p.year >= m.year - 10).map((p) => p.harmonized);
    if (prev.length < 5) continue;
    const mean = prev.reduce((s, v) => s + v, 0) / prev.length;
    const sd = Math.sqrt(prev.reduce((s, v) => s + (v - mean) ** 2, 0) / (prev.length - 1));
    // Floor the spread at counting noise so a handful of off-season fires against a
    // near-zero baseline isn't called "extreme". Fires last several days, so
    // fire-days are over-dispersed (×3 Poisson variance); MODIS-era values are
    // also scaled by k.
    const scale = m.year >= viirsStartYear ? 1 : k;
    const z = (m.harmonized - mean) / Math.max(sd, Math.sqrt(3 * Math.max(mean, 1) * scale), 1);
    const pct = ((m.harmonized - mean) / Math.max(mean, 1)) * 100;
    m.baseline = round1(mean);
    m.z = round2(z);
    m.pctVsBaseline = Math.round(pct);
    const evidence = m.year >= viirsStartYear ? m.viirsFD : m.modisFD; // fire-days actually observed
    if (m.harmonized >= 15 && evidence >= 10) {
      if (z >= 3 && pct >= 100) m.anomaly = "extreme";
      else if (z >= 2 && pct >= 50) m.anomaly = "significant";
      else if (z >= 1.5 && pct >= 40) m.anomaly = "elevated";
    }
  }

  const annual = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const ym = months.filter((m) => m.year === y);
    annual.push({
      year: y,
      harmonized: round1(sum(ym.map((m) => m.harmonized))),
      naive: sum(ym.map((m) => m.naive)),
      modisRaw: sum(ym.map((m) => m.modisRaw)),
      viirsRaw: sum(ym.map((m) => m.viirsRaw)),
    });
  }

  const climatology = Array.from({ length: 12 }, (_, i) => {
    const vals = months.filter((m) => m.month === i + 1 && !m.missing).map((m) => m.harmonized);
    return { month: i + 1, mean: round1(sum(vals) / Math.max(vals.length, 1)), share: 0 };
  });
  const climTotal = sum(climatology.map((c) => c.mean)) || 1;
  climatology.forEach((c) => (c.share = round2(c.mean / climTotal)));
  const peakMonths = [...climatology].sort((a, b) => b.mean - a.mean).slice(0, 3).map((c) => c.month);

  // Trend on complete years only.
  const complete = annual.filter((a) => a.year < lastYear || grid.meta.lastMonth === 12);
  const trend = mannKendall(complete.map((a) => a.harmonized));

  // Rank by excess fire-days so operationally large events (peak-season surges)
  // lead, rather than small off-season blips with a high z-score.
  const excess = (m: MonthStat) => m.harmonized - (m.baseline ?? 0);
  const anomalies = months.filter((m) => m.anomaly && m.anomaly !== "elevated").sort((a, b) => excess(b) - excess(a));

  return {
    bbox,
    cellCount: opts.cellCount,
    k: round2(k),
    kSource: useLocal ? "aoi" : "domain",
    overlapYears: [viirsStartYear, lastYear],
    months,
    annual,
    climatology,
    peakMonths,
    trend,
    anomalies,
    totals: {
      naive: sum(annual.map((a) => a.naive)),
      harmonized: Math.round(sum(annual.map((a) => a.harmonized))),
      modisRaw: sum(annual.map((a) => a.modisRaw)),
      viirsRaw: sum(annual.map((a) => a.viirsRaw)),
    },
  };
}

/** Per-cell intensity for the map, for one year (and optionally one month). */
export function cellValues(grid: GridFile, year: number, view: SensorView, month?: number): Map<number, number> {
  const k = domainK(grid);
  const out = new Map<number, number>();
  const r = grid.records;
  const viirsEra = year >= grid.meta.viirsStartYear;
  for (let i = 0; i < r.length; i += RECORD_WIDTH) {
    if (r[i + 1] !== year) continue;
    if (month && r[i + 2] !== month) continue;
    let v: number;
    if (view === "modis") v = r[i + 3];
    else if (view === "viirs") v = r[i + 4];
    else v = viirsEra ? r[i + 6] : r[i + 5] * k;
    if (v > 0) out.set(r[i], (out.get(r[i]) ?? 0) + v);
  }
  return out;
}

/** Mann-Kendall trend test with Sen's slope. */
export function mannKendall(xs: number[]): TrendResult {
  const n = xs.length;
  if (n < 4) return { senSlope: 0, pValue: 1, tau: 0, direction: "no trend", significant: false };
  let s = 0;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(xs[j] - xs[i]);
      slopes.push((xs[j] - xs[i]) / (j - i));
    }
  }
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  slopes.sort((a, b) => a - b);
  const mid = Math.floor(slopes.length / 2);
  const senSlope = slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
  const significant = pValue < 0.05;
  return {
    senSlope: round2(senSlope),
    pValue: Math.round(pValue * 1000) / 1000,
    tau: round2(s / ((n * (n - 1)) / 2)),
    direction: !significant ? "no trend" : senSlope > 0 ? "increasing" : "decreasing",
    significant,
  };
}

function normalCdf(x: number) {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
