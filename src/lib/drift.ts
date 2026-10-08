/**
 * Orbit drift of Terra and Aqua and what it does to MODIS fire counts.
 *
 * Terra (10:30 / 22:30 local) and Aqua (13:30 / 01:30) stopped orbit-maintenance
 * manoeuvres in their extended missions, so their overpass times drift. Fire activity
 * has a strong daily cycle, so a drifting overpass sees systematically more or fewer
 * fires. VIIRS on Suomi NPP keeps a maintained orbit and serves as the reference.
 *
 * 1. Overpass local solar time per satellite and year, from the detections themselves
 *    (|lat| ≤ 40°, so each place is seen about once per pass).
 * 2. Detection ratio R = satellite fire-days / VIIRS fire-days (same day/night pass), per year.
 * 3. Sensitivity: ln R regressed on the overpass-time shift across the overlap years.
 * 4. Drift bias: how much a MODIS-only record changes each year because of the drift alone.
 */
import { mannKendall } from "./harmonize";

export type SatKey = "terra" | "aqua" | "snpp";
export interface DriftInputs {
  years: { year: number; lst: Record<SatKey, number[]> | null; sat: Record<string, number[]> | null }[];
}
// SAT_FIELDS layout (pipeline/global-year.ts)
const F = { tDayFD: 0, tNightFD: 1, aDayFD: 2, aNightFD: 3, tDayFRP: 4, tNightFRP: 5, aDayFRP: 6, aNightFRP: 7, vDayFD: 8, vNightFD: 9, vDayFRP: 10, vNightFRP: 11 };
export const NS = 12;

export interface PassSeries {
  sat: "terra" | "aqua";
  pass: "day" | "night";
  nominal: number; // hours, mean of the reference years
  points: { year: number; lst: number; shiftMin: number; ratio: number | null }[];
  /** d ln R / d hour, with standard error and p-value (overlap years) */
  slope: number;
  se: number;
  p: number;
}

export interface DriftResult {
  referenceYears: [number, number];
  snpp: { year: number; day: number; night: number }[];
  passes: PassSeries[];
  /** % change of MODIS (Terra + Aqua) fire-days caused by drift alone, per year */
  bias: { year: number; pct: number }[];
  /** world MODIS-only trend 2003→last year: raw vs drift-corrected (Sen's slope, % per decade) */
  modisTrend: { raw: number; corrected: number; rawP: number; correctedP: number };
}

/** Mean local solar time of a pass from a 96 × 15-min histogram (circular for night passes). */
export function passTime(hist: number[], pass: "day" | "night"): number | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  hist.forEach((c, i) => {
    const h = (i + 0.5) / 4;
    const inDay = h >= 7 && h < 18;
    if ((pass === "day") !== inDay || c <= 0) return;
    if (pass === "night" && h >= 6 && h < 19) return;
    const a = (h / 24) * 2 * Math.PI;
    sx += c * Math.cos(a);
    sy += c * Math.sin(a);
    n += c;
  });
  if (!n) return null;
  const a = Math.atan2(sy, sx);
  return Math.round(((((a / (2 * Math.PI)) * 24 + 24) % 24) * 1000)) / 1000;
}

function ols(x: number[], y: number[]) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  x.forEach((v, i) => {
    sxy += (v - mx) * (y[i] - my);
    sxx += (v - mx) ** 2;
  });
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  const rss = y.reduce((s, v, i) => s + (v - a - b * x[i]) ** 2, 0);
  const se = n > 2 && sxx ? Math.sqrt(rss / (n - 2) / sxx) : Infinity;
  // two-sided p from |t| with a normal approximation adjusted for small n (Student t via simple series)
  const t = se ? Math.abs(b / se) : 0;
  const p = studentP(t, Math.max(n - 2, 1));
  return { a, b, se, p };
}

/** Two-sided p-value for Student's t (regularized incomplete beta, continued fraction). */
function studentP(t: number, df: number) {
  const x = df / (df + t * t);
  return Math.min(1, incBeta(x, df / 2, 0.5));
}
function incBeta(x: number, a: number, b: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lbeta) / a;
  // Lentz continued fraction
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2);
    let num: number;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-10) break;
  }
  return front * (f - 1);
}
function lgamma(z: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** World totals of the satellite split per year. */
function worldSat(y: DriftInputs["years"][number]) {
  const tot = new Array(NS).fill(0);
  if (!y.sat) return tot;
  for (const arr of Object.values(y.sat)) for (let m = 0; m < 12; m++) for (let f = 0; f < NS; f++) tot[f] += arr[m * NS + f] ?? 0;
  return tot;
}

export function analyzeDrift(inp: DriftInputs, referenceYears: [number, number] = [2013, 2017]): DriftResult {
  const ys = inp.years.filter((y) => y.lst && y.sat).sort((a, b) => a.year - b.year);
  const inRef = (yr: number) => yr >= referenceYears[0] && yr <= referenceYears[1];
  const tot = new Map(ys.map((y) => [y.year, worldSat(y)]));

  const passes: PassSeries[] = [];
  for (const sat of ["terra", "aqua"] as const)
    for (const pass of ["day", "night"] as const) {
      const pts = ys.map((y) => {
        const lst = passTime(y.lst![sat], pass);
        const t = tot.get(y.year)!;
        const satFD = t[sat === "terra" ? (pass === "day" ? F.tDayFD : F.tNightFD) : pass === "day" ? F.aDayFD : F.aNightFD];
        const vFD = t[pass === "day" ? F.vDayFD : F.vNightFD];
        return { year: y.year, lst: lst ?? NaN, ratio: vFD > 0 ? satFD / vFD : null };
      });
      const ref = pts.filter((p) => inRef(p.year) && Number.isFinite(p.lst));
      const nominal = ref.length ? ref.reduce((s, p) => s + p.lst, 0) / ref.length : pts.find((p) => Number.isFinite(p.lst))?.lst ?? 0;
      const fitPts = pts.filter((p) => p.year >= 2013 && p.ratio && Number.isFinite(p.lst));
      const r = fitPts.length >= 4 ? ols(fitPts.map((p) => p.lst - nominal), fitPts.map((p) => Math.log(p.ratio!))) : { b: 0, se: Infinity, p: 1 };
      passes.push({
        sat,
        pass,
        nominal: Math.round(nominal * 1000) / 1000,
        points: pts.map((p) => ({ year: p.year, lst: Math.round(p.lst * 1000) / 1000, shiftMin: Math.round((p.lst - nominal) * 600) / 10, ratio: p.ratio === null ? null : Math.round(p.ratio * 10000) / 10000 })),
        slope: Math.round(r.b * 10000) / 10000,
        se: Math.round(r.se * 10000) / 10000,
        p: Math.round(r.p * 10000) / 10000,
      });
    }

  // Drift bias of MODIS fire-days: weight each pass by its share of MODIS detections.
  const bias = ys.map((y) => {
    const t = tot.get(y.year)!;
    const w = [t[F.tDayFD], t[F.tNightFD], t[F.aDayFD], t[F.aNightFD]];
    const W = w.reduce((a, b) => a + b, 0) || 1;
    let f = 0;
    passes.forEach((ps, i) => {
      const pt = ps.points.find((p) => p.year === y.year)!;
      const shift = Number.isFinite(pt.lst) ? pt.lst - ps.nominal : 0;
      f += (w[i] / W) * Math.exp(ps.slope * shift);
    });
    return { year: y.year, pct: Math.round((f - 1) * 1000) / 10 };
  });

  // Effect on a MODIS-only world trend.
  const modis = ys.map((y) => {
    const t = tot.get(y.year)!;
    return t[F.tDayFD] + t[F.tNightFD] + t[F.aDayFD] + t[F.aNightFD];
  });
  const corrected = modis.map((v, i) => v / (1 + bias[i].pct / 100));
  const raw = mannKendall(modis);
  const cor = mannKendall(corrected);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const snpp = ys.map((y) => ({ year: y.year, day: passTime(y.lst!.snpp, "day") ?? NaN, night: passTime(y.lst!.snpp, "night") ?? NaN })).filter((p) => Number.isFinite(p.day));

  return {
    referenceYears,
    snpp,
    passes,
    bias,
    modisTrend: {
      raw: Math.round((raw.senSlope / mean(modis)) * 1000 * 10) / 10,
      corrected: Math.round((cor.senSlope / mean(corrected)) * 1000 * 10) / 10,
      rawP: raw.pValue,
      correctedP: cor.pValue,
    },
  };
}
