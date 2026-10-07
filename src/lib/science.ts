/**
 * Science layer: questions a fire scientist would ask of the harmonized record.
 *
 *  - Climate link: does fire activity follow El Niño / La Niña (NOAA ONI)?
 *    Pearson r between pre-season ONI and the detrended fire-season anomaly,
 *    tested with the Fisher z transform.
 *  - Fire intensity: mean fire radiative power (FRP) per VIIRS fire-day and the
 *    share of night-time detections, with Mann-Kendall trends.
 *  - Fire regime (Bangladesh high-detail record): individual fire events
 *    reconstructed from space-time linked fire-days, and burn return intervals.
 */
import { mannKendall } from "./harmonize";
import { NF, type CountriesFile } from "./global";
import type { AoiAnalysis, BBox, GridFile, TrendResult } from "./types";

export interface OniFile {
  source: string;
  fetched: string;
  values: Record<string, number>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function normalCdf(x: number) {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function pearson(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  const z = Math.atanh(Math.max(-0.9999, Math.min(0.9999, r))) * Math.sqrt(Math.max(n - 3, 1));
  return { r: Math.round(r * 100) / 100, p: Math.round(2 * (1 - normalCdf(Math.abs(z))) * 1000) / 1000, n, slope: sxx ? sxy / sxx : 0 };
}

export interface EnsoTest {
  r: number;
  p: number;
  pctPerDegree: number; // % change in fire-season activity per +1 °C ONI
  window: string; // ONI months used, e.g. "Feb–Jul"
  points: { year: number; oni: number; anomalyPct: number }[];
}

export interface EnsoLink {
  n: number;
  season: string; // fire season, e.g. "Aug–Oct"
  /** ONI during the fire season itself: the physical link. */
  concurrent: EnsoTest;
  /** Mean ONI over the 6 months before the season: usable as an early warning. */
  lead: EnsoTest;
  /** The stronger of the two (used for ranking and the chart). */
  best: "concurrent" | "lead";
  r: number;
  p: number;
  pctPerDegree: number;
  verdict: "El Niño → more fire" | "La Niña → more fire" | "no clear link";
  predictable: boolean; // lead test significant
}

/**
 * Fire season = the 3 months centred on the climatological peak. Fire values
 * are log-transformed and detrended (least squares) so long-term change does
 * not masquerade as a climate signal, then correlated with NOAA ONI twice:
 * during the season (concurrent) and over the 6 months before it (lead).
 */
export function ensoLink(a: AoiAnalysis, oni: OniFile): EnsoLink | null {
  const peak = a.peakMonths[0];
  const byIdx = new Map(a.months.filter((m) => !m.missing).map((m) => [m.year * 12 + (m.month - 1), m.harmonized]));
  const label = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
  const mean = (idx: number[]) => {
    const v = idx.map((i) => oni.values[label(i)]);
    return v.every((x) => x !== undefined) ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };
  const years = [...new Set(a.months.map((m) => m.year))];
  const rows: { year: number; fire: number; conc: number; lead: number }[] = [];
  for (const y of years) {
    const peakIdx = y * 12 + (peak - 1);
    const season = [peakIdx - 1, peakIdx, peakIdx + 1];
    if (!season.every((i) => byIdx.has(i))) continue;
    const fire = season.reduce((s, i) => s + byIdx.get(i)!, 0);
    const conc = mean(season);
    const lead = mean([1, 2, 3, 4, 5, 6].map((k) => season[0] - k));
    if (fire > 0 && conc !== undefined && lead !== undefined) rows.push({ year: y, fire, conc, lead });
  }
  if (rows.length < 8) return null;
  const logs = rows.map((r) => Math.log1p(r.fire));
  const xs = rows.map((r) => r.year);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const ml = logs.reduce((s, v) => s + v, 0) / logs.length;
  let b = 0;
  let bxx = 0;
  xs.forEach((x, i) => {
    b += (x - mx) * (logs[i] - ml);
    bxx += (x - mx) ** 2;
  });
  const slope = bxx ? b / bxx : 0;
  const resid = logs.map((l, i) => l - (ml + slope * (xs[i] - mx)));

  const m = (k: number) => MONTHS[((k % 12) + 12) % 12];
  const s0 = peak - 2; // season start, 0-based month
  const test = (key: "conc" | "lead", window: string): EnsoTest => {
    const st = pearson(
      rows.map((r) => r[key]),
      resid,
    );
    return {
      r: st.r,
      p: st.p,
      pctPerDegree: Math.round((Math.exp(st.slope) - 1) * 100),
      window,
      points: rows.map((r, i) => ({ year: r.year, oni: Math.round(r[key] * 100) / 100, anomalyPct: Math.round((Math.exp(resid[i]) - 1) * 100) })),
    };
  };
  const concurrent = test("conc", `${m(s0)}–${m(s0 + 2)}`);
  const lead = test("lead", `${m(s0 - 6)}–${m(s0 - 1)}`);
  const best = lead.p < 0.05 && Math.abs(lead.r) >= Math.abs(concurrent.r) ? "lead" : concurrent.p <= lead.p ? "concurrent" : "lead";
  const t = best === "lead" ? lead : concurrent;
  return {
    n: rows.length,
    season: concurrent.window,
    concurrent,
    lead,
    best,
    r: t.r,
    p: t.p,
    pctPerDegree: t.pctPerDegree,
    verdict: t.p < 0.05 ? (t.r > 0 ? "El Niño → more fire" : "La Niña → more fire") : "no clear link",
    predictable: lead.p < 0.05,
  };
}

export interface Intensity {
  years: { year: number; frpPerFireDay: number; nightShare: number }[];
  frpTrend: TrendResult;
  nightTrend: TrendResult;
  meanFrp: number;
  meanNight: number;
}

/** VIIRS-era fire intensity (FRP per fire-day) and night share for a country (or the world). */
export function intensity(cf: CountriesFile, name: string | null): Intensity | null {
  const data = name ? cf.countries.find((c) => c.name === name)?.data : cf.world;
  if (!data) return null;
  const years: Intensity["years"] = [];
  for (let y = cf.meta.viirsStartYear; y <= cf.meta.lastYear; y++) {
    let frp = 0;
    let fd = 0;
    let night = 0;
    let raw = 0;
    for (let m = 0; m < 12; m++) {
      const b = ((y - cf.meta.firstYear) * 12 + m) * NF;
      frp += data[b + 7];
      fd += data[b + 3];
      night += data[b + 9];
      raw += data[b + 1];
    }
    if (fd > 0) years.push({ year: y, frpPerFireDay: Math.round((frp / fd) * 10) / 10, nightShare: Math.round((night / Math.max(raw, 1)) * 1000) / 1000 });
  }
  if (years.length < 5) return null;
  const avg = (k: "frpPerFireDay" | "nightShare") => years.reduce((s, y) => s + y[k], 0) / years.length;
  return {
    years,
    frpTrend: mannKendall(years.map((y) => y.frpPerFireDay)),
    nightTrend: mannKendall(years.map((y) => y.nightShare)),
    meanFrp: Math.round(avg("frpPerFireDay") * 10) / 10,
    meanNight: Math.round(avg("nightShare") * 1000) / 1000,
  };
}

export interface EnsoRankRow {
  name: string;
  r: number;
  p: number;
  pctPerDegree: number;
  window: string;
  predictable: boolean;
}

/** Countries whose fire seasons track ENSO most strongly (significant only). */
export function ensoRanking(cf: CountriesFile, analyses: { name: string; analysis: AoiAnalysis }[], oni: OniFile): EnsoRankRow[] {
  void cf;
  return analyses
    .map(({ name, analysis }) => {
      const l = ensoLink(analysis, oni);
      return l ? { name, r: l.r, p: l.p, pctPerDegree: l.pctPerDegree, window: l[l.best].window, predictable: l.predictable } : null;
    })
    .filter((x): x is EnsoRankRow => Boolean(x && x.p < 0.05))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

// ---------------------------------------------------------------------------
// Fire regime (Bangladesh high-detail record)
// ---------------------------------------------------------------------------
export const INTERVAL_LABELS = ["1", "2", "3", "4", "5", "6–8", "9+"];
const INTERVAL_MID = [1, 2, 3, 4, 5, 7, 10];

export interface FireRegime {
  years: [number, number];
  burnedKm2: number;
  reburnedShare: number;
  intervalHist: number[];
  medianInterval: number | null;
  events: { year: number; count: number; meanKm2: number; maxKm2: number; meanDays: number; bigShare: number }[];
  countTrend: TrendResult;
  sizeTrend: TrendResult;
}

export function fireRegime(grid: GridFile, bbox: BBox): FireRegime | null {
  const reg = grid.regime;
  if (!reg) return null;
  const inBox = new Set<number>();
  grid.cells.forEach(([lon, lat], i) => lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3] && inBox.add(i));
  const km2 = 1.2392 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180) * (grid.meta.fireDayGrid / 0.01) ** 2;

  let burned = 0;
  let reburned = 0;
  const hist = new Array(7).fill(0);
  for (let i = 0; i < reg.fine.length; i += 10) {
    if (!inBox.has(reg.fine[i])) continue;
    burned += reg.fine[i + 1];
    reburned += reg.fine[i + 2];
    for (let b = 0; b < 7; b++) hist[b] += reg.fine[i + 3 + b];
  }
  const total = hist.reduce((a, b) => a + b, 0);
  let median: number | null = null;
  if (total) {
    let acc = 0;
    for (let b = 0; b < 7; b++) {
      acc += hist[b];
      if (acc >= total / 2) {
        median = INTERVAL_MID[b];
        break;
      }
    }
  }
  const byYear = new Map<number, number[]>();
  for (let i = 0; i < reg.events.length; i += 7) {
    if (!inBox.has(reg.events[i])) continue;
    const y = reg.events[i + 1];
    const e = byYear.get(y) ?? [0, 0, 0, 0, 0];
    e[0] += reg.events[i + 2];
    e[1] += reg.events[i + 3];
    e[2] = Math.max(e[2], reg.events[i + 4]);
    e[3] += reg.events[i + 5];
    e[4] += reg.events[i + 6];
    byYear.set(y, e);
  }
  const events = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, e]) => ({
      year,
      count: e[0],
      meanKm2: Math.round(((e[1] / Math.max(e[0], 1)) * km2) * 10) / 10,
      maxKm2: Math.round(e[2] * km2),
      meanDays: Math.round((e[3] / Math.max(e[0], 1)) * 10) / 10,
      bigShare: Math.round((e[4] / Math.max(e[0], 1)) * 1000) / 1000,
    }));
  if (!events.length && !burned) return null;
  return {
    years: reg.years,
    burnedKm2: Math.round(burned * km2),
    reburnedShare: burned ? Math.round((reburned / burned) * 1000) / 1000 : 0,
    intervalHist: hist,
    medianInterval: median,
    events,
    countTrend: mannKendall(events.map((e) => e.count)),
    sizeTrend: mannKendall(events.map((e) => e.meanKm2)),
  };
}
