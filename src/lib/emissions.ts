/**
 * Fire radiative energy (FRE) → biomass burned → CO₂, CO and PM2.5 emissions.
 *
 * 1. Diurnal cycle per unit × calendar month from the four MODIS samples of fire
 *    radiative power (Terra ~10:30/22:30, Aqua ~13:30/01:30 local; actual times per
 *    year from the drift analysis):  g(t) = b + a·exp(−(t−h)² / 2s²),  a, b ≥ 0,
 *    h ∈ [12, 17] h and s ∈ [1.5, 5] h by grid search with non-negative least squares.
 * 2. FRE per month = Σ FRP at the ~13:30 pass × ∫g / g(13:30) × 3600 s.
 *    VIIRS anchors 2012+; MODIS/Aqua anchors every year. The MODIS FRE record is then
 *    harmonized to VIIRS units with the same v2 transfer used for fire-days.
 * 3. Dry matter = FRE × 0.368 kg/MJ (Wooster et al., 2005).
 * 4. Emissions = dry matter × emission factor. Biome-generic central values with the
 *    range across biomes (savanna, agricultural, tropical/temperate/boreal forest),
 *    after Andreae (2019): CO₂ 1.60 (1.43–1.66), CO 0.090 (0.069–0.121),
 *    PM2.5 0.009 (0.006–0.018) kg per kg dry matter. Peat is not separated.
 *
 * Not corrected: fires hidden by cloud or smoke, and fires below VIIRS detection,
 * so these are conservative (low) estimates. FRP-based inventories such as GFAS
 * rescale by land cover to match burned-area inventories; we do not.
 */
import { fitUnit, predict, type UnitModel } from "./harmonize2";
import { NS } from "./drift";

export const COMBUSTION_KG_PER_MJ = 0.368;
export const EF = {
  co2: { mid: 1.6, lo: 1.43, hi: 1.66 },
  co: { mid: 0.09, lo: 0.069, hi: 0.121 },
  pm25: { mid: 0.009, lo: 0.006, hi: 0.018 },
} as const;

export interface PassTimes {
  terraDay: number;
  terraNight: number;
  aquaDay: number;
  aquaNight: number;
  snppDay: number;
}
export const NOMINAL_PASSES: PassTimes = { terraDay: 10.5, terraNight: 22.5, aquaDay: 13.5, aquaNight: 1.5, snppDay: 13.5 };

export interface Diurnal {
  b: number;
  a: number;
  h: number;
  s: number;
}

const gauss = (t: number, h: number, s: number) => {
  // circular distance on the 24-h clock
  const d = Math.min(Math.abs(t - h), 24 - Math.abs(t - h));
  return Math.exp(-(d * d) / (2 * s * s));
};
export const diurnalAt = (g: Diurnal, t: number) => g.b + g.a * gauss(t, g.h, g.s);
/** ∫ g over 24 h (hours) */
export const diurnalIntegral = (g: Diurnal) => 24 * g.b + g.a * g.s * Math.sqrt(2 * Math.PI);

/** Fit g(t) to (time, FRP) samples. Falls back to a typical shape when samples are empty. */
export function fitDiurnal(samples: { t: number; v: number }[]): Diurnal {
  const pts = samples.filter((p) => Number.isFinite(p.v) && p.v >= 0);
  if (pts.reduce((s, p) => s + p.v, 0) <= 0) return { b: 0.05, a: 1, h: 14.5, s: 2.5 };
  let best: Diurnal & { sse: number } = { b: 0, a: 0, h: 14.5, s: 2.5, sse: Infinity };
  for (let h = 12; h <= 17.001; h += 0.25)
    for (let s = 1.5; s <= 5.001; s += 0.25) {
      // NNLS for v = b + a·x with x = gauss(t)
      const xs = pts.map((p) => gauss(p.t, h, s));
      const n = pts.length;
      const mx = xs.reduce((q, v) => q + v, 0) / n;
      const my = pts.reduce((q, p) => q + p.v, 0) / n;
      let sxy = 0;
      let sxx = 0;
      xs.forEach((x, i) => {
        sxy += (x - mx) * (pts[i].v - my);
        sxx += (x - mx) ** 2;
      });
      let a = sxx ? sxy / sxx : 0;
      let b = my - a * mx;
      if (a < 0) {
        a = 0;
        b = my;
      }
      if (b < 0) {
        b = 0;
        a = xs.reduce((q, x, i) => q + x * pts[i].v, 0) / Math.max(xs.reduce((q, x) => q + x * x, 0), 1e-12);
      }
      const sse = pts.reduce((q, p, i) => q + (p.v - b - a * xs[i]) ** 2, 0);
      if (sse < best.sse - 1e-12) best = { b, a, h, s, sse };
    }
  return { b: best.b, a: best.a, h: best.h, s: best.s };
}

/** Hours of "peak-equivalent" burning per day, relative to the value at time t. */
export const dailyFactor = (g: Diurnal, t: number) => {
  const at = diurnalAt(g, t);
  return at > 0 ? diurnalIntegral(g) / at : 24;
};

export interface EmissionYear {
  year: number;
  /** PJ (10^15 J) */
  fre: number;
  freLo: number;
  freHi: number;
  /** Tg dry matter */
  dm: number;
  co2: number;
  co2Lo: number;
  co2Hi: number;
  co: number;
  coLo: number;
  coHi: number;
  pm25: number;
  pm25Lo: number;
  pm25Hi: number;
  /** "viirs" when VIIRS-anchored (2012+), "modis" when harmonized from MODIS */
  source: "viirs" | "modis";
}

export interface EmissionUnit {
  diurnal: Diurnal[]; // 12 calendar months
  years: EmissionYear[];
  model: UnitModel;
}

/**
 * Emissions for one unit (country or world) from its satellite-split series.
 * sat: flat (nYears × 12 × NS) array in SAT_FIELDS order; passes per year (index from firstYear).
 */
export function unitEmissions(sat: number[], firstYear: number, lastYear: number, passes: PassTimes[], trainYears: number[], parent: { kAnnual: number; sigma: number; sigmaAnnual?: number }): EmissionUnit {
  const nY = lastYear - firstYear + 1;
  const val = (y: number, m: number, f: number) => sat[((y - firstYear) * 12 + m) * NS + f] ?? 0;
  // Climatological diurnal shape per calendar month from MODIS (Terra/Aqua day/night FRP), all years.
  const diurnal = Array.from({ length: 12 }, (_, m) => {
    const acc = { td: 0, tn: 0, ad: 0, an: 0, ttd: 0, ttn: 0, tad: 0, tan: 0, w: 0 };
    for (let y = firstYear; y <= lastYear; y++) {
      const p = passes[y - firstYear] ?? NOMINAL_PASSES;
      const td = val(y, m, 4);
      const tn = val(y, m, 5);
      const ad = val(y, m, 6);
      const an = val(y, m, 7);
      acc.td += td;
      acc.tn += tn;
      acc.ad += ad;
      acc.an += an;
      acc.ttd += p.terraDay * td;
      acc.ttn += p.terraNight * tn;
      acc.tad += p.aquaDay * ad;
      acc.tan += p.aquaNight * an;
    }
    const t = (sum: number, w: number, def: number) => (w > 0 ? sum / w : def);
    return fitDiurnal([
      { t: t(acc.ttd, acc.td, 10.5), v: acc.td },
      { t: t(acc.ttn, acc.tn, 22.5), v: acc.tn },
      { t: t(acc.tad, acc.ad, 13.5), v: acc.ad },
      { t: t(acc.tan, acc.an, 1.5), v: acc.an },
    ]);
  });

  // Monthly FRE (GJ) anchored on MODIS/Aqua (all years) and VIIRS (2012+).
  const M = new Array(nY * 12).fill(0);
  const V = new Array(nY * 12).fill(0);
  for (let y = firstYear; y <= lastYear; y++)
    for (let m = 0; m < 12; m++) {
      const p = passes[y - firstYear] ?? NOMINAL_PASSES;
      const i = (y - firstYear) * 12 + m;
      // MW·(sum over days) × hours × 3600 s → MJ → GJ
      M[i] = (val(y, m, 6) * dailyFactor(diurnal[m], p.aquaDay) * 3600) / 1000;
      V[i] = (val(y, m, 10) * dailyFactor(diurnal[m], p.snppDay) * 3600) / 1000;
    }
  const model = fitUnit({ M, V }, { firstYear, trainYears }, parent);

  const years: EmissionYear[] = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const viirs = y >= 2012 && V.slice((y - firstYear) * 12, (y - firstYear) * 12 + 12).some((v) => v > 0);
    let gj = 0;
    let lo = 0;
    let hi = 0;
    for (let m = 0; m < 12; m++) {
      const i = (y - firstYear) * 12 + m;
      if (viirs) {
        gj += V[i];
        lo += V[i];
        hi += V[i];
      } else {
        const p = predict(model, M[i], m);
        gj += p.v;
        lo += p.lo;
        hi += p.hi;
      }
    }
    // Diurnal-shape uncertainty: ±15% on the daily integral (spread across plausible fits).
    const pj = gj / 1e6;
    const pjLo = (lo / 1e6) * 0.85;
    const pjHi = (hi / 1e6) * 1.15;
    const dm = (pj * 1e9 * COMBUSTION_KG_PER_MJ) / 1e9; // PJ → MJ (×1e9) → kg → Tg (÷1e9)
    const dmLo = (pjLo * 1e9 * (COMBUSTION_KG_PER_MJ - 0.015)) / 1e9;
    const dmHi = (pjHi * 1e9 * (COMBUSTION_KG_PER_MJ + 0.015)) / 1e9;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    years.push({
      year: y,
      fre: r(pj),
      freLo: r(pjLo),
      freHi: r(pjHi),
      dm: r(dm),
      co2: r(dm * EF.co2.mid),
      co2Lo: r(dmLo * EF.co2.lo),
      co2Hi: r(dmHi * EF.co2.hi),
      co: r(dm * EF.co.mid),
      coLo: r(dmLo * EF.co.lo),
      coHi: r(dmHi * EF.co.hi),
      pm25: r(dm * EF.pm25.mid),
      pm25Lo: r(dmLo * EF.pm25.lo),
      pm25Hi: r(dmHi * EF.pm25.hi),
      source: viirs ? "viirs" : "modis",
    });
  }
  return { diurnal, years, model };
}
