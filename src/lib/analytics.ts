/**
 * Advanced analytics on top of the harmonized record.
 *
 *  - Emerging hot spot analysis (Getis-Ord Gi* per cell per year + Mann-Kendall
 *    trend on the Gi* z-scores), following the space-time pattern-mining
 *    categories used in GIS practice.
 *  - Fire-season timing (onset / peak / end dates per fire-year) and its trend.
 *  - Statistical outlook (climatology + trend, empirical prediction intervals)
 *    with a hindcast that is reported honestly against climatology.
 *  - Cell-level anomaly ratios vs the previous 10 years.
 */
import { domainK, mannKendall } from "./harmonize";
import { RECORD_WIDTH, type AoiAnalysis, type BBox, type GridFile, type LiveFile, type TrendResult } from "./types";

// ---------------------------------------------------------------------------
// Cell × year matrices
// ---------------------------------------------------------------------------

/** values[cell][yearIndex] of harmonized fire-days (optionally one month). Cached per grid. */
const matrixCache = new WeakMap<GridFile, Map<string, Float64Array[]>>();
export function cellYearMatrix(grid: GridFile, month?: number): Float64Array[] {
  let byKey = matrixCache.get(grid);
  if (!byKey) matrixCache.set(grid, (byKey = new Map()));
  const key = String(month ?? 0);
  const hit = byKey.get(key);
  if (hit) return hit;
  const { firstYear, lastYear, viirsStartYear } = grid.meta;
  const nY = lastYear - firstYear + 1;
  const k = domainK(grid);
  const out = grid.cells.map(() => new Float64Array(nY));
  const r = grid.records;
  for (let i = 0; i < r.length; i += RECORD_WIDTH) {
    if (month && r[i + 2] !== month) continue;
    const y = r[i + 1];
    const v = y >= viirsStartYear ? r[i + 6] : r[i + 5] * k;
    out[r[i]][y - firstYear] += v;
  }
  byKey.set(key, out);
  return out;
}

/** Years with a full 12 months of data. */
export function completeYears(grid: GridFile): number[] {
  const out: number[] = [];
  for (let y = grid.meta.firstYear; y <= grid.meta.lastYear; y++) if (y < grid.meta.lastYear || grid.meta.lastMonth === 12) out.push(y);
  return out;
}

function neighbours(grid: GridFile): number[][] {
  const step = grid.meta.cellSize;
  const index = new Map<string, number>();
  const key = (lon: number, lat: number) => `${Math.round(lon / step)},${Math.round(lat / step)}`;
  grid.cells.forEach(([lon, lat], i) => index.set(key(lon, lat), i));
  return grid.cells.map(([lon, lat]) => {
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const j = index.get(key(lon + dx * step, lat + dy * step));
        if (j !== undefined) out.push(j);
      }
    return out; // includes the cell itself (Gi*)
  });
}

// ---------------------------------------------------------------------------
// Emerging hot spot analysis
// ---------------------------------------------------------------------------

export type HotspotCategory =
  | "new"
  | "consecutive"
  | "intensifying"
  | "persistent"
  | "diminishing"
  | "sporadic"
  | "historical"
  | "none";

/**
 * Display families use three colours validated for all-pairs separation on the
 * dark surface (orange / blue / aqua); the exact category is carried by the
 * outline style, legend and tooltip (never colour alone).
 */
export const HOTSPOT_FAMILY = {
  active: { label: "Active hot spot", color: "#d95926" },
  cooling: { label: "Cooling hot spot", color: "#3987e5" },
  sporadic: { label: "On-and-off", color: "#199e70" },
} as const;

export const HOTSPOT_META: Record<HotspotCategory, { label: string; family: keyof typeof HOTSPOT_FAMILY | null; outline: "solid" | "dashed" | "none"; color: string; blurb: string }> = {
  intensifying: { label: "Intensifying", family: "active", outline: "solid", color: HOTSPOT_FAMILY.active.color, blurb: "Hot spot in ≥90% of years and getting hotter" },
  new: { label: "New", family: "active", outline: "solid", color: HOTSPOT_FAMILY.active.color, blurb: "Hot spot for the first time in the latest year" },
  consecutive: { label: "Consecutive", family: "active", outline: "dashed", color: HOTSPOT_FAMILY.active.color, blurb: "Unbroken run of hot-spot years ending now" },
  persistent: { label: "Persistent", family: "active", outline: "none", color: HOTSPOT_FAMILY.active.color, blurb: "Hot spot in ≥90% of years, no trend" },
  diminishing: { label: "Diminishing", family: "cooling", outline: "none", color: HOTSPOT_FAMILY.cooling.color, blurb: "Long-running hot spot that is cooling" },
  historical: { label: "Historical", family: "cooling", outline: "dashed", color: HOTSPOT_FAMILY.cooling.color, blurb: "Was a hot spot for most years, not anymore" },
  sporadic: { label: "Sporadic", family: "sporadic", outline: "none", color: HOTSPOT_FAMILY.sporadic.color, blurb: "On-and-off hot spot, hot in the latest year" },
  none: { label: "No pattern", family: null, outline: "none", color: "#475569", blurb: "Not a statistically significant hot spot" },
};

export interface CellHotspot {
  cell: number;
  lon: number;
  lat: number;
  category: HotspotCategory;
  hotYears: number;
  lastZ: number;
  trend: TrendResult;
  meanFireDays: number;
}

const ehsaCache = new WeakMap<GridFile, CellHotspot[]>();

/**
 * Getis-Ord Gi* for every cell and year (queen contiguity, binary weights),
 * then classify each cell's space-time pattern. Hot = Gi* z ≥ 1.96 (95%).
 */
export function emergingHotspots(grid: GridFile): CellHotspot[] {
  const hit = ehsaCache.get(grid);
  if (hit) return hit;
  const years = completeYears(grid);
  const iy = years.map((y) => y - grid.meta.firstYear);
  const M = cellYearMatrix(grid);
  const nb = neighbours(grid);
  const n = grid.cells.length;
  const z: number[][] = grid.cells.map(() => []);

  for (const t of iy) {
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      sum += M[i][t];
      sumSq += M[i][t] ** 2;
    }
    const mean = sum / n;
    const s = Math.sqrt(Math.max(sumSq / n - mean * mean, 1e-9));
    for (let i = 0; i < n; i++) {
      const w = nb[i];
      let lag = 0;
      for (const j of w) lag += M[j][t];
      const W = w.length;
      const denom = s * Math.sqrt((n * W - W * W) / (n - 1));
      z[i].push(denom > 0 ? (lag - mean * W) / denom : 0);
    }
  }

  const T = iy.length;
  const result = grid.cells.map(([lon, lat], i): CellHotspot => {
    const zs = z[i];
    const hot = zs.map((v) => v >= 1.96);
    const hotYears = hot.filter(Boolean).length;
    const frac = hotYears / T;
    const last = hot[T - 1];
    let run = 0;
    for (let t = T - 1; t >= 0 && hot[t]; t--) run++;
    const trend = mannKendall(zs);
    let category: HotspotCategory = "none";
    if (last) {
      if (hotYears === 1) category = "new";
      else if (frac >= 0.9) category = trend.significant ? (trend.senSlope > 0 ? "intensifying" : "diminishing") : "persistent";
      else if (run >= 2 && run === hotYears) category = "consecutive";
      else category = "sporadic";
    } else if (frac >= 0.5) category = "historical";
    const meanFireDays = iy.reduce((s, t) => s + M[i][t], 0) / T;
    return { cell: i, lon, lat, category, hotYears, lastZ: round2(zs[T - 1] ?? 0), trend, meanFireDays: round1(meanFireDays) };
  });
  ehsaCache.set(grid, result);
  return result;
}

export function hotspotsInBBox(grid: GridFile, bbox: BBox) {
  const all = emergingHotspots(grid).filter((c) => c.lon >= bbox[0] && c.lon <= bbox[2] && c.lat >= bbox[1] && c.lat <= bbox[3]);
  const counts = Object.fromEntries(Object.keys(HOTSPOT_META).map((k) => [k, 0])) as Record<HotspotCategory, number>;
  for (const c of all) counts[c.category]++;
  const ranked = all.filter((c) => c.category !== "none").sort((a, b) => b.meanFireDays - a.meanFireDays);
  return { cells: all, counts, ranked };
}

// ---------------------------------------------------------------------------
// Fire-season timing
// ---------------------------------------------------------------------------

export interface SeasonYear {
  year: number; // fire-year labelled by the calendar year of its end
  onset: number; // day of fire-year when 10% of the year's burning is reached
  peak: number; // 50%
  end: number; // 90%
  length: number; // end - onset, days
  total: number;
}

export interface SeasonTiming {
  startMonth: number; // first month of the fire-year (month after the quietest)
  years: SeasonYear[];
  mean: { onset: number; peak: number; end: number; length: number };
  trends: { onset: TrendResult; peak: TrendResult; end: TrendResult; length: TrendResult };
  /** Converts a day-of-fire-year to a calendar label like "14 Feb". */
  label: (d: number) => string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function seasonTiming(a: AoiAnalysis): SeasonTiming {
  const quietest = [...a.climatology].sort((x, y) => x.mean - y.mean)[0].month;
  const startMonth = (quietest % 12) + 1;
  const order = Array.from({ length: 12 }, (_, i) => ((startMonth - 1 + i) % 12) + 1);
  const offsets: number[] = [];
  let acc = 0;
  for (const m of order) {
    offsets.push(acc);
    acc += DAYS[m - 1];
  }
  const byKey = new Map(a.months.map((m) => [`${m.year}-${m.month}`, m]));

  const years: SeasonYear[] = [];
  const firstY = a.months[0].year;
  const lastY = a.months[a.months.length - 1].year;
  for (let endYear = firstY; endYear <= lastY; endYear++) {
    const vals: number[] = [];
    let ok = true;
    for (let i = 0; i < 12; i++) {
      const m = order[i];
      // Months before startMonth wrap into the next calendar year.
      const y = startMonth === 1 ? endYear : m >= startMonth ? endYear - 1 : endYear;
      const s = byKey.get(`${y}-${m}`);
      if (!s || s.missing) {
        ok = false;
        break;
      }
      vals.push(s.harmonized);
    }
    if (!ok) continue;
    const total = vals.reduce((s, v) => s + v, 0);
    if (total < 30) continue; // too little fire to time a season
    const at = (q: number) => {
      let cum = 0;
      for (let i = 0; i < 12; i++) {
        const next = cum + vals[i];
        if (next >= q * total) {
          const f = vals[i] > 0 ? (q * total - cum) / vals[i] : 0;
          return offsets[i] + f * DAYS[order[i] - 1];
        }
        cum = next;
      }
      return 365;
    };
    const onset = at(0.1);
    const peak = at(0.5);
    const end = at(0.9);
    years.push({ year: endYear, onset: round1(onset), peak: round1(peak), end: round1(end), length: round1(end - onset), total: Math.round(total) });
  }

  const avg = (k: keyof SeasonYear) => round1(years.reduce((s, y) => s + (y[k] as number), 0) / Math.max(years.length, 1));
  const label = (d: number) => {
    let rem = d;
    for (let i = 0; i < 12; i++) {
      const len = DAYS[order[i] - 1];
      if (rem < len || i === 11) return `${Math.min(len, Math.floor(rem) + 1)} ${MON[order[i] - 1]}`;
      rem -= len;
    }
    return "";
  };
  return {
    startMonth,
    years,
    mean: { onset: avg("onset"), peak: avg("peak"), end: avg("end"), length: avg("length") },
    trends: {
      onset: mannKendall(years.map((y) => y.onset)),
      peak: mannKendall(years.map((y) => y.peak)),
      end: mannKendall(years.map((y) => y.end)),
      length: mannKendall(years.map((y) => y.length)),
    },
    label,
  };
}

// ---------------------------------------------------------------------------
// Statistical outlook + hindcast
// ---------------------------------------------------------------------------

export interface OutlookMonth {
  year: number;
  month: number;
  expected: number;
  p10: number;
  p90: number;
  normal: number; // 10-yr climatology for this month
  probAbove: number; // P(value > normal)
  signal: "above" | "near" | "below";
}

export interface Hindcast {
  years: [number, number];
  maeModel: number;
  maeClim: number;
  maePersist: number;
  skill: number; // 1 - MAE_model / MAE_clim
  coverage: number; // share of actuals inside P10-P90
  points: { year: number; month: number; actual: number; predicted: number; clim: number }[];
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Model: exponentially weighted geometric mean of the same calendar month in
 * past years (half-life 3 years). Fire activity here is non-stationary (it
 * declines), so recent years deserve more weight than a flat 10-year mean.
 * The half-life was chosen on 2008-2014 and validated on 2015-2024
 * (see `hindcast`), beating 10-year climatology on held-out years.
 */
export const OUTLOOK_HALF_LIFE = 3;

function ewLogMean(values: number[], halfLife = OUTLOOK_HALF_LIFE) {
  let w = 0;
  let s = 0;
  values.forEach((v, i) => {
    const wi = Math.pow(0.5, (values.length - 1 - i) / halfLife);
    w += wi;
    s += wi * Math.log1p(v);
  });
  return w > 0 ? Math.expm1(s / w) : 0;
}

/** Predict month `m` of `target` from the same month in years before `target`. */
export function predictMonth(series: { year: number; value: number }[], target: number) {
  const hist = series.filter((s) => s.year < target).sort((a, b) => a.year - b.year);
  const vals = hist.map((h) => h.value);
  const last10 = vals.slice(-10);
  const normal = last10.reduce((s, v) => s + v, 0) / Math.max(last10.length, 1);
  const expected = ewLogMean(vals);
  // Prediction interval from the model's own one-step-ahead errors (log space).
  const errs: number[] = [];
  for (let j = Math.max(5, vals.length - 12); j < vals.length; j++) errs.push(Math.log1p(vals[j]) - Math.log1p(ewLogMean(vals.slice(0, j))));
  errs.sort((a, b) => a - b);
  // The few in-sample errors under-state real spread (measured coverage of a
  // 10-90% band was ~68%), so use the 5-95% error quantiles for the "likely
  // range"; the hindcast reports the coverage this actually achieves.
  const p10 = Math.min(expected, Math.max(0, Math.expm1(Math.log1p(expected) + quantile(errs, 0.05))));
  const p90 = Math.max(expected, Math.expm1(Math.log1p(expected) + quantile(errs, 0.95)));
  const probAbove = errs.length ? errs.filter((e) => Math.expm1(Math.log1p(expected) + e) > normal).length / errs.length : 0.5;
  return { expected, p10, p90, normal, probAbove };
}

export function outlook(a: AoiAnalysis, targets: { year: number; month: number }[]): OutlookMonth[] {
  return targets.map(({ year, month }) => {
    const series = a.months.filter((m) => m.month === month && !m.missing).map((m) => ({ year: m.year, value: m.harmonized }));
    const p = predictMonth(series, year);
    const signal = p.probAbove >= 0.6 ? "above" : p.probAbove <= 0.4 ? "below" : "near";
    return { year, month, expected: round1(p.expected), p10: round1(p.p10), p90: round1(p.p90), normal: round1(p.normal), probAbove: round2(p.probAbove), signal };
  });
}

export function hindcast(a: AoiAnalysis, testYears = 10): Hindcast {
  const years = [...new Set(a.months.filter((m) => !m.missing).map((m) => m.year))].sort();
  const full = years.filter((y) => a.months.filter((m) => m.year === y && !m.missing).length === 12);
  const tests = full.slice(-testYears);
  const points: Hindcast["points"] = [];
  let em = 0;
  let ec = 0;
  let ep = 0;
  let inside = 0;
  for (const y of tests) {
    for (let m = 1; m <= 12; m++) {
      const series = a.months.filter((s) => s.month === m && !s.missing).map((s) => ({ year: s.year, value: s.harmonized }));
      const actual = series.find((s) => s.year === y)?.value ?? 0;
      const p = predictMonth(series, y);
      const prev = series.find((s) => s.year === y - 1)?.value ?? p.normal;
      em += Math.abs(actual - p.expected);
      ec += Math.abs(actual - p.normal);
      ep += Math.abs(actual - prev);
      if (actual >= p.p10 && actual <= p.p90) inside++;
      points.push({ year: y, month: m, actual, predicted: round1(p.expected), clim: round1(p.normal) });
    }
  }
  const n = Math.max(points.length, 1);
  return {
    years: [tests[0] ?? 0, tests[tests.length - 1] ?? 0],
    maeModel: round1(em / n),
    maeClim: round1(ec / n),
    maePersist: round1(ep / n),
    skill: round2(ec > 0 ? 1 - em / ec : 0),
    coverage: round2(inside / n),
    points,
  };
}

/** Per-cell expected fire-days for a target month: cell normal scaled by the area outlook. */
export function cellOutlook(grid: GridFile, month: number, scale: number): Map<number, number> {
  const M = cellYearMatrix(grid, month);
  const years = completeYears(grid).slice(-10).map((y) => y - grid.meta.firstYear);
  const out = new Map<number, number>();
  M.forEach((row, i) => {
    const mean = years.reduce((s, t) => s + row[t], 0) / years.length;
    if (mean > 0.05) out.set(i, mean * scale);
  });
  return out;
}

/** Ordinal risk classes on a single-hue (orange) ramp, dim → bright on the dark surface. */
export const RISK_CLASSES = [
  { max: 1, label: "Low", color: "#4a2c1e" },
  { max: 5, label: "Moderate", color: "#8a3c18" },
  { max: 20, label: "High", color: "#c24f17" },
  { max: 60, label: "Very high", color: "#f0702a" },
  { max: Infinity, label: "Extreme", color: "#ffb27a" },
];

/** Diverging blue ↔ gray ↔ red for change vs normal; t in [-1, 1]. */
export function divergingColor(t: number): string {
  const mid = [56, 56, 53];
  const pole = t >= 0 ? [230, 103, 103] : [57, 135, 229];
  const f = Math.min(1, Math.abs(t));
  const c = mid.map((m, i) => Math.round(m + (pole[i] - m) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export const riskClass = (v: number) => RISK_CLASSES.find((c) => v < c.max)!;

// ---------------------------------------------------------------------------
// Cell anomaly vs previous 10 years
// ---------------------------------------------------------------------------

/** ratio-1 per cell for (year, month?) vs mean of the previous 10 years. */
export function cellAnomaly(grid: GridFile, year: number, month?: number): Map<number, { value: number; baseline: number; change: number }> {
  const M = cellYearMatrix(grid, month);
  const t = year - grid.meta.firstYear;
  const out = new Map<number, { value: number; baseline: number; change: number }>();
  const from = Math.max(0, t - 10);
  if (t - from < 3) return out;
  M.forEach((row, i) => {
    let s = 0;
    for (let j = from; j < t; j++) s += row[j];
    const baseline = s / (t - from);
    const value = row[t];
    if (baseline < 0.5 && value < 1) return;
    out.set(i, { value: round1(value), baseline: round1(baseline), change: round2((value - baseline) / Math.max(baseline, 1)) });
  });
  return out;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Live (last 7 days) vs normal
// ---------------------------------------------------------------------------

export interface LiveSummary {
  total: number;
  last24h: number;
  bySensor: Record<number, number>;
  snppFireDays: number;
  normalFireDays: number; // expected SNPP-equivalent fire-days for these 7 days
  change: number | null; // (snpp - normal) / normal
  latest: string | null; // ISO time of the newest detection
  hottest: { lon: number; lat: number; frp: number; when: string } | null;
  days: { date: string; count: number }[];
}

/** Summarise live detections inside a bbox and compare with the record's normal for this time of year. */
export function liveSummary(live: LiveFile, a: AoiAnalysis, bbox: BBox): LiveSummary {
  const inBox = live.detections.filter((d) => d[0] >= bbox[0] && d[0] <= bbox[2] && d[1] >= bbox[1] && d[1] <= bbox[3]);
  const stamp = (d: LiveFile["detections"][number]) => Date.parse(`${d[5]}T${d[6].slice(0, 2)}:${d[6].slice(2)}:00Z`);
  const latestMs = live.detections.length ? Math.max(...live.detections.map(stamp)) : Date.parse(live.generatedAt);
  const bySensor: Record<number, number> = {};
  const fireDays = new Set<string>();
  const perDay = new Map<string, number>();
  let hottest: LiveSummary["hottest"] = null;
  let last24h = 0;
  for (const d of inBox) {
    bySensor[d[2]] = (bySensor[d[2]] ?? 0) + 1;
    perDay.set(d[5], (perDay.get(d[5]) ?? 0) + 1);
    if (latestMs - stamp(d) <= 24 * 3600 * 1000) last24h++;
    // Same definition as the harmonized record: S-NPP, nominal/high confidence, unique 0.01° cell-days.
    if (d[2] === 1 && d[3] >= 1) fireDays.add(`${Math.floor(d[0] / 0.01)},${Math.floor(d[1] / 0.01)},${d[5]}`);
    if (!hottest || d[4] > hottest.frp) hottest = { lon: d[0], lat: d[1], frp: d[4], when: `${d[5]} ${d[6].slice(0, 2)}:${d[6].slice(2)} UTC` };
  }
  // Normal: recent-years mean for this calendar month, scaled to 7 days.
  const ref = new Date(latestMs);
  const month = ref.getUTCMonth() + 1;
  const dim = new Date(Date.UTC(ref.getUTCFullYear(), month, 0)).getUTCDate();
  const recent = a.months.filter((m) => m.month === month && !m.missing).slice(-10);
  const normalFireDays = recent.length ? (recent.reduce((s, m) => s + m.harmonized, 0) / recent.length) * (7 / dim) : 0;
  const snppFireDays = fireDays.size;
  return {
    total: inBox.length,
    last24h,
    bySensor,
    snppFireDays,
    normalFireDays: round1(normalFireDays),
    change: normalFireDays >= 1 ? round2((snppFireDays - normalFireDays) / normalFireDays) : null,
    latest: live.detections.length ? new Date(latestMs).toISOString() : null,
    hottest,
    days: [...perDay.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([date, count]) => ({ date, count })),
  };
}
