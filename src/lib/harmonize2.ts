/**
 * Harmonization v2: season-stratified, hierarchically shrunk MODIS → VIIRS transfer
 * with a small-fire floor and uncertainty, plus the blind (held-out years) validation.
 *
 *   VIIRS-equivalent fire-days(month m) = k[m] × MODIS fire-days + floor[m]
 *
 * k[m]     ratio of VIIRS to MODIS fire-days in a season window (month ±1 at ¼ weight), from the
 *          overlap training years, shrunk toward the unit's annual ratio, which is
 *          shrunk toward its parent (region / world): empirical-Bayes style, with a
 *          prior worth N0 MODIS fire-days at each level.
 * floor[m] median over training years of what VIIRS sees beyond k × MODIS: fires too
 *          small for MODIS to detect at all (never negative).
 * Uncertainty: a year-block bootstrap of the training years gives the spread of k;
 * the residual scatter of held-in months gives the prediction spread. Intervals are 90%.
 *
 * Shared by the global pipeline (countries, 1° cells), the browser (any area) and tests.
 */

export interface Series {
  /** MODIS fire-days, flat monthly from firstYear (index (year - firstYear) * 12 + month0) */
  M: ArrayLike<number>;
  /** VIIRS S-NPP fire-days, same layout (0 before VIIRS) */
  V: ArrayLike<number>;
}

export interface UnitModel {
  k: number[]; // 12 calendar months
  floor: number[]; // 12
  kLo: number[]; // 5th percentile (bootstrap)
  kHi: number[]; // 95th percentile
  /** out-of-sample log-residual scale (90th percentile of |residual| / 1.645) */
  sigma: number;
  /** same, for annual totals */
  sigmaAnnual: number;
  /** MODIS fire-days in the training years (evidence weight) */
  n: number;
  /** annual (all-month) ratio, for display */
  kAnnual: number;
}

export interface FitOptions {
  firstYear: number;
  trainYears: number[];
  /** prior strength in MODIS fire-days */
  n0?: number;
  boot?: number;
  seed?: number;
}

/** Overlap years used to train the transfer. 2012 is excluded (VIIRS 375 m fire data begin 20 Jan 2012). */
export const DEFAULT_TRAIN_YEARS = [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021];
const N0 = 300;
const Z90 = 1.645;

const at = (s: ArrayLike<number>, i: number) => (i >= 0 && i < s.length ? s[i] || 0 : 0);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const p = (s.length - 1) * q;
  const lo = Math.floor(p);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo);
};
const median = (xs: number[]) => quantile(xs, 0.5);

/** Season-window sums for each calendar month over the given years. */
function seasonSums(s: Series, firstYear: number, years: number[]) {
  const M = new Array(12).fill(0);
  const V = new Array(12).fill(0);
  let mAll = 0;
  let vAll = 0;
  for (const y of years) {
    const b = (y - firstYear) * 12;
    for (let m = 0; m < 12; m++) {
      const mm = at(s.M, b + m);
      const vv = at(s.V, b + m);
      mAll += mm;
      vAll += vv;
      // Season window: neighbouring months at quarter weight (chosen by the blind test over ±1 equal, ½ and none).
      for (const [d, w] of [[-1, 0.25], [0, 1], [1, 0.25]]) {
        const t = (m + d + 12) % 12;
        M[t] += w * mm;
        V[t] += w * vv;
      }
    }
  }
  return { M, V, mAll, vAll };
}

/** k per calendar month given a prior annual ratio. */
function seasonalK(s: Series, firstYear: number, years: number[], prior: number, n0: number, floor?: number[]) {
  const sums = seasonSums(floor ? subtractFloor(s, firstYear, years, floor) : s, firstYear, years);
  const kAnn = (sums.vAll + n0 * prior) / (sums.mAll + n0);
  return { k: sums.M.map((m, i) => (sums.V[i] + n0 * kAnn) / (m + n0)), kAnn, n: sums.mAll };
}

/** VIIRS minus the floor (for re-estimating k on the part MODIS can see). */
function subtractFloor(s: Series, firstYear: number, years: number[], floor: number[]): Series {
  const V = Array.from(s.V as ArrayLike<number>);
  // A bootstrap sample repeats years: subtract the floor once per distinct year.
  for (const y of new Set(years)) {
    const b = (y - firstYear) * 12;
    for (let m = 0; m < 12; m++) if (b + m < V.length) V[b + m] = Math.max(0, V[b + m] - floor[m]);
  }
  return { M: s.M, V };
}

function floorOf(s: Series, firstYear: number, years: number[], k: number[]) {
  return Array.from({ length: 12 }, (_, m) =>
    Math.max(
      0,
      median(years.map((y) => at(s.V, (y - firstYear) * 12 + m) - k[m] * at(s.M, (y - firstYear) * 12 + m))),
    ),
  );
}

/** Fit one unit (country, cell, user area) given its parent's annual ratio and residual scatter. */
export function fitUnit(s: Series, opt: FitOptions, parent: { kAnnual: number; sigma: number; sigmaAnnual?: number }): UnitModel {
  const n0 = opt.n0 ?? N0;
  const years = opt.trainYears;
  // Alternate k (on what MODIS can see) and the floor (what it cannot) to a consistent pair,
  // always finishing with k fitted to the final floor.
  let { k, kAnn, n } = seasonalK(s, opt.firstYear, years, parent.kAnnual, n0);
  let floor = new Array(12).fill(0);
  for (let it = 0; it < 4; it++) {
    floor = floorOf(s, opt.firstYear, years, k);
    ({ k, kAnn, n } = seasonalK(s, opt.firstYear, years, parent.kAnnual, n0, floor));
  }

  // Year-block bootstrap for the spread of k.
  const B = opt.boot ?? 60;
  const rnd = mulberry32(opt.seed ?? 7);
  const ks: number[][] = Array.from({ length: 12 }, () => []);
  for (let b = 0; b < B; b++) {
    const ys = years.map(() => years[Math.floor(rnd() * years.length)]);
    const kb = seasonalK(s, opt.firstYear, ys, parent.kAnnual, n0, floor).k;
    for (let m = 0; m < 12; m++) ks[m].push(kb[m]);
  }

  // Prediction scatter, out of sample: each training year is predicted by a model fitted
  // without it (leave-one-year-out); robust sd of the log residuals, shrunk to the parent.
  const res: number[] = [];
  const resA: number[] = [];
  for (const y of years) {
    const rest = years.filter((x) => x !== y);
    if (!rest.length) break;
    // refit both k and the floor without year y
    const fy = floorOf(s, opt.firstYear, rest, seasonalK(s, opt.firstYear, rest, parent.kAnnual, n0, floor).k);
    const ky = seasonalK(s, opt.firstYear, rest, parent.kAnnual, n0, fy).k;
    let pa = 0;
    let va = 0;
    for (let m = 0; m < 12; m++) {
      const i = (y - opt.firstYear) * 12 + m;
      const pred = ky[m] * at(s.M, i) + fy[m];
      const v = at(s.V, i);
      pa += pred;
      va += v;
      if (pred + v >= 20) res.push(Math.log((v + 1) / (pred + 1)));
    }
    if (pa + va >= 50) resA.push(Math.log((va + 1) / (pa + 1)));
  }
  // Errors are heavy-tailed: size the interval from the empirical 90th percentile of |residual|.
  const mad = res.length >= 4 ? quantile(res.map((r) => Math.abs(r)), 0.9) / Z90 : parent.sigma;
  const w = res.length / (res.length + 12);
  const sigma = w * mad + (1 - w) * parent.sigma;
  // Few annual residuals per unit: pool their variance with the parent's (prior worth 4 years).
  const pA = parent.sigmaAnnual ?? parent.sigma / 2;
  const sigmaAnnual = Math.sqrt((resA.reduce((a, r) => a + r * r, 0) + 4 * pA * pA) / (resA.length + 4));

  return {
    k: k.map(r3),
    floor: floor.map(r1),
    kLo: ks.map((x) => r3(quantile(x, 0.05))),
    kHi: ks.map((x) => r3(quantile(x, 0.95))),
    sigma: r3(sigma),
    sigmaAnnual: r3(sigmaAnnual),
    n,
    kAnnual: r3(kAnn),
  };
}

/** World (or region) model: the root of the hierarchy, with no shrinkage target of its own. */
export function fitRoot(units: Series[], opt: FitOptions): UnitModel {
  const len = Math.max(...units.map((u) => u.M.length));
  const M = new Array(len).fill(0);
  const V = new Array(len).fill(0);
  for (const u of units)
    for (let i = 0; i < len; i++) {
      M[i] += at(u.M, i);
      V[i] += at(u.V, i);
    }
  const s = seasonSums({ M, V }, opt.firstYear, opt.trainYears);
  return fitUnit({ M, V }, { ...opt, n0: 0 }, { kAnnual: s.mAll ? s.vAll / s.mAll : 1, sigma: 0.35 });
}

/** VIIRS-equivalent value for one month with a 90% interval. */
export function predict(u: UnitModel, modisFD: number, month0: number) {
  const v = u.k[month0] * modisFD + u.floor[month0];
  const sdK = u.k[month0] > 0 ? Math.log(Math.max(u.kHi[month0], 1e-6) / Math.max(u.kLo[month0], 1e-6)) / (2 * Z90) : 0;
  // Counting noise dominates small values: add it in log space.
  const sd = Math.sqrt(u.sigma ** 2 + sdK ** 2 + 1 / (v + 1));
  return { v, lo: Math.max(0, (v + 1) * Math.exp(-Z90 * sd) - 1), hi: (v + 1) * Math.exp(Z90 * sd) - 1 };
}

/** Annual VIIRS-equivalent total from 12 monthly MODIS values, with a 90% interval. */
export function predictAnnual(u: UnitModel, modis12: number[]) {
  const v = modis12.reduce((s, M, m) => s + u.k[m] * M + u.floor[m], 0);
  const sd = Math.sqrt(u.sigmaAnnual ** 2 + 1 / (v + 1));
  return { v, lo: Math.max(0, (v + 1) * Math.exp(-Z90 * sd) - 1), hi: (v + 1) * Math.exp(Z90 * sd) - 1 };
}

// ---------------------------------------------------------------------------
// Blind validation: train on some overlap years, harmonize the MODIS of the
// others as if VIIRS did not exist, compare with what VIIRS actually saw.
// ---------------------------------------------------------------------------
export interface MethodScore {
  method: string;
  monthlyMedianPct: number;
  monthlyP90Pct: number;
  annualMedianPct: number;
  annualP90Pct: number;
  /** share of held-out monthly values inside the 90% interval (v2 only) */
  coverage90?: number;
  /** same for annual totals */
  coverage90Annual?: number;
  /** median bias of annual totals, % (positive = over-estimate) */
  annualBiasPct: number;
  nMonths: number;
  nYears: number;
}

export interface Fold {
  train: number[];
  test: number[];
  scores: MethodScore[];
}

const pct = (logErr: number) => Math.round((Math.exp(logErr) - 1) * 1000) / 10;

/**
 * Compare four transfers on held-out years:
 *  v1-global  one ratio for the whole world
 *  v1-unit    one ratio per unit (the old FireCal method)
 *  v2-season  per unit × season, shrunk (no floor)
 *  v2         per unit × season, shrunk, with small-fire floor and intervals
 */
export function blindTest(units: Series[], firstYear: number, train: number[], test: number[], minMonthly = 100, minAnnual = 1000): Fold {
  const opt: FitOptions = { firstYear, trainYears: train, boot: 30 };
  const root = fitRoot(units, opt);
  const models = units.map((u) => fitUnit(u, opt, root));
  const unitK = units.map((u) => {
    const s = seasonSums(u, firstYear, train);
    return (s.vAll + N0 * root.kAnnual) / (s.mAll + N0);
  });
  const seasonOnly = units.map((u) => seasonalK(u, firstYear, train, root.kAnnual, N0).k);

  const methods: Record<string, (ui: number, m: number, M: number) => number> = {
    "v1-global": (_ui, _m, M) => root.kAnnual * M,
    "v1-unit": (ui, _m, M) => unitK[ui] * M,
    "v2-season": (ui, m, M) => seasonOnly[ui][m] * M,
    v2: (ui, m, M) => models[ui].k[m] * M + models[ui].floor[m],
  };
  const scores: MethodScore[] = [];
  for (const [name, f] of Object.entries(methods)) {
    const mErr: number[] = [];
    const aErr: number[] = [];
    const aBias: number[] = [];
    let inside = 0;
    let total = 0;
    let insideA = 0;
    let totalA = 0;
    units.forEach((u, ui) => {
      for (const y of test) {
        let pa = 0;
        let va = 0;
        for (let m = 0; m < 12; m++) {
          const i = (y - firstYear) * 12 + m;
          const M = at(u.M, i);
          const V = at(u.V, i);
          const p = f(ui, m, M);
          pa += p;
          va += V;
          if (V >= minMonthly) {
            mErr.push(Math.abs(Math.log(p / V)));
            if (name === "v2") {
              const pr = predict(models[ui], M, m);
              total++;
              if (V >= pr.lo && V <= pr.hi) inside++;
            }
          }
        }
        if (va >= minAnnual) {
          aErr.push(Math.abs(Math.log(pa / va)));
          aBias.push(Math.log(pa / va));
          if (name === "v2") {
            const pr = predictAnnual(models[ui], Array.from({ length: 12 }, (_, m) => at(u.M, (y - firstYear) * 12 + m)));
            totalA++;
            if (va >= pr.lo && va <= pr.hi) insideA++;
          }
        }
      }
    });
    scores.push({
      method: name,
      monthlyMedianPct: pct(median(mErr)),
      monthlyP90Pct: pct(quantile(mErr, 0.9)),
      annualMedianPct: pct(median(aErr)),
      annualP90Pct: pct(quantile(aErr, 0.9)),
      annualBiasPct: Math.round((Math.exp(median(aBias)) - 1) * 1000) / 10,
      ...(name === "v2" ? { coverage90: Math.round((inside / Math.max(total, 1)) * 1000) / 1000, coverage90Annual: Math.round((insideA / Math.max(totalA, 1)) * 1000) / 1000 } : {}),
      nMonths: mErr.length,
      nYears: aErr.length,
    });
  }
  return { train, test, scores };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;
