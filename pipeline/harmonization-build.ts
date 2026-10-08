/**
 * Science products built from the merged per-year outputs (called by global-merge.ts):
 *   - harmonization.json: v2 model for the world, blind validation, MODIS detection
 *     model from same-overpass matchups, orbit-drift analysis, world k by year
 *   - per-cell v2 models for the 1° grid
 *   - emissions.json: FRE, dry matter and CO₂ / CO / PM2.5 per country and year
 *   - dataset tables (CSV/JSON) for the open dataset export
 */
import { fitDetection, type DetectionModel } from "../src/lib/detection";
import { analyzeDrift, NS, passTime, type DriftResult } from "../src/lib/drift";
import { NOMINAL_PASSES, unitEmissions, type EmissionYear, type PassTimes } from "../src/lib/emissions";
import { DEFAULT_TRAIN_YEARS, blindTest, fitUnit, predict, predictAnnual, type Fold, type Series, type UnitModel } from "../src/lib/harmonize2";
import type { YearOutput } from "./global-year";

const NF = 10;

export interface CountryRow {
  name: string;
  data: number[];
}

export function trainYears(firstYear: number, lastYear: number) {
  return DEFAULT_TRAIN_YEARS.filter((y) => y >= firstYear && y <= lastYear);
}

const seriesFromCountry = (data: number[]): Series => {
  const n = data.length / NF;
  const M = new Array(n);
  const V = new Array(n);
  for (let i = 0; i < n; i++) {
    M[i] = data[i * NF + 2];
    V[i] = data[i * NF + 3];
  }
  return { M, V };
};

export function rootOf(s: Series, firstYear: number, train: number[]): UnitModel {
  let m = 0;
  let v = 0;
  for (const y of train)
    for (let k = 0; k < 12; k++) {
      m += s.M[(y - firstYear) * 12 + k] || 0;
      v += s.V[(y - firstYear) * 12 + k] || 0;
    }
  return fitUnit(s, { firstYear, trainYears: train, n0: 0 }, { kAnnual: m ? v / m : 1, sigma: 0.35 });
}

export interface HarmonizationFile {
  generatedAt: string;
  method: string;
  trainYears: number[];
  world: UnitModel;
  validation: Fold[];
  kByYear: { year: number; k: number }[];
  detection: (DetectionModel & { byYear: { year: number; p: number; objects: number }[] }) | null;
  drift: DriftResult | null;
  /** countries with the most overlap evidence: their seasonal k and floor (for the lab view) */
  countries: { name: string; kAnnual: number; k: number[]; floor: number[]; sigma: number; evidence: number }[];
}

export function buildHarmonization(years: YearOutput[], countries: CountryRow[], world: number[], firstYear: number, lastYear: number): HarmonizationFile {
  const train = trainYears(firstYear, lastYear);
  const units = countries.map((c) => seriesFromCountry(c.data));
  const worldS = seriesFromCountry(world);
  const root = rootOf(worldS, firstYear, train);

  // Blind validation folds.
  const folds: [number[], number[]][] = [
    [
      [2017, 2018, 2019, 2020, 2021],
      [2013, 2014, 2015, 2016],
    ],
    [
      [2013, 2014, 2015, 2016, 2017],
      [2018, 2019, 2020, 2021],
    ],
    [train, [2022, 2023, 2024].filter((y) => y <= lastYear)],
  ];
  const validation = folds.filter(([tr, te]) => tr.every((y) => y <= lastYear) && te.length).map(([tr, te]) => blindTest(units, firstYear, tr, te));

  const kByYear = [];
  for (let y = 2012; y <= lastYear; y++) {
    let m = 0;
    let v = 0;
    for (let k = 0; k < 12; k++) {
      m += worldS.M[(y - firstYear) * 12 + k];
      v += worldS.V[(y - firstYear) * 12 + k];
    }
    kByYear.push({ year: y, k: m ? Math.round((v / m) * 1000) / 1000 : 0 });
  }

  // Detection model from all matchup years.
  const withMatch = years.filter((y) => y.match);
  let detection: HarmonizationFile["detection"] = null;
  if (withMatch.length) {
    const table = new Array(withMatch[0].match!.length).fill(0);
    const dt = new Array(withMatch[0].matchDt?.length ?? 0).fill(0);
    for (const y of withMatch) {
      y.match!.forEach((v, i) => (table[i] += v));
      y.matchDt?.forEach((v, i) => (dt[i] += v));
    }
    const model = fitDetection(table, dt);
    const byYear = withMatch.map((y) => {
      let n = 0;
      let d = 0;
      y.match!.forEach((v, i) => (i % 2 ? (d += v) : (n += v)));
      return { year: y.year, p: n ? Math.round((d / n) * 1000) / 1000 : 0, objects: n };
    });
    detection = { ...model, byYear };
  }

  const drift = years.some((y) => y.lst && y.sat) ? analyzeDrift({ years: years.map((y) => ({ year: y.year, lst: y.lst ?? null, sat: y.sat ?? null })) }) : null;

  const fitted = countries.map((c, i) => ({ name: c.name, m: fitUnit(units[i], { firstYear, trainYears: train }, root) }));
  const top = fitted.sort((a, b) => b.m.n - a.m.n).slice(0, 40);

  return {
    generatedAt: new Date().toISOString(),
    method: "v2: season-stratified VIIRS/MODIS fire-day ratio with small-fire floor, hierarchical shrinkage (cell → 10° block → world; country → world), out-of-sample 90% intervals",
    trainYears: train,
    world: root,
    validation,
    kByYear,
    detection,
    drift,
    countries: top.map(({ name, m }) => ({ name, kAnnual: m.kAnnual, k: m.k, floor: m.floor, sigma: m.sigma, evidence: m.n })),
  };
}

/** Per-cell v2 harmonization for the 1° grid; parents are 10° blocks, whose parent is the world. */
export function harmonizeCells(years: YearOutput[], ids: number[], firstYear: number, lastYear: number, root: UnitModel) {
  const nY = lastYear - firstYear + 1;
  const train = trainYears(firstYear, lastYear);
  const byYear = new Map(years.map((y) => [y.year, y]));
  const series = new Map<number, Series>();
  for (const id of ids) {
    const M = new Array(nY * 12).fill(0);
    const V = new Array(nY * 12).fill(0);
    for (let yr = firstYear; yr <= lastYear; yr++) {
      const arr = byYear.get(yr)?.cells[id];
      if (!arr) continue;
      for (let m = 0; m < 12; m++) {
        M[(yr - firstYear) * 12 + m] = arr[m * 2];
        V[(yr - firstYear) * 12 + m] = arr[m * 2 + 1];
      }
    }
    series.set(id, { M, V });
  }
  const blockOf = (id: number) => {
    const lat = Math.floor(id / 360);
    const lon = id % 360;
    return Math.floor(lat / 10) * 36 + Math.floor(lon / 10);
  };
  const blockSeries = new Map<number, Series>();
  for (const [id, s] of series) {
    const b = blockOf(id);
    const bs = blockSeries.get(b) ?? { M: new Array(nY * 12).fill(0), V: new Array(nY * 12).fill(0) };
    for (let i = 0; i < nY * 12; i++) {
      (bs.M as number[])[i] += s.M[i];
      (bs.V as number[])[i] += s.V[i];
    }
    blockSeries.set(b, bs);
  }
  const blocks = new Map<number, UnitModel>();
  for (const [b, s] of blockSeries) blocks.set(b, fitUnit(s, { firstYear, trainYears: train, boot: 30 }, root));

  const yearly: number[] = [];
  const yearlyLo: number[] = [];
  const yearlyHi: number[] = [];
  const clim: number[] = [];
  const models = new Map<number, UnitModel>();
  for (const id of ids) {
    const s = series.get(id)!;
    const u = fitUnit(s, { firstYear, trainYears: train, boot: 30 }, blocks.get(blockOf(id))!);
    models.set(id, u);
    for (let yr = firstYear; yr <= lastYear; yr++) {
      const b = (yr - firstYear) * 12;
      if (yr >= 2012) {
        let v = 0;
        for (let m = 0; m < 12; m++) v += s.V[b + m];
        yearly.push(Math.round(v));
        yearlyLo.push(Math.round(v));
        yearlyHi.push(Math.round(v));
      } else {
        const p = predictAnnual(u, Array.from({ length: 12 }, (_, m) => s.M[b + m]));
        yearly.push(Math.round(p.v));
        yearlyLo.push(Math.round(p.lo));
        yearlyHi.push(Math.round(p.hi));
      }
    }
    // Monthly climatology of the last 10 years (VIIRS era here, harmonized where MODIS-only).
    for (let m = 0; m < 12; m++) {
      let sum = 0;
      let n = 0;
      for (let yr = Math.max(firstYear, lastYear - 9); yr <= lastYear; yr++) {
        const i = (yr - firstYear) * 12 + m;
        sum += yr >= 2012 ? s.V[i] : predict(u, s.M[i], m).v;
        n++;
      }
      clim.push(Math.round((sum / Math.max(n, 1)) * 10) / 10);
    }
  }
  return { yearly, yearlyLo, yearlyHi, clim, models, series };
}

/** Pass times per year (from the drift analysis), falling back to nominal. */
export function passTimesByYear(years: YearOutput[], firstYear: number, lastYear: number): PassTimes[] {
  const out: PassTimes[] = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const lst = years.find((x) => x.year === y)?.lst;
    const pick = (h: number[] | undefined, pass: "day" | "night", def: number) => (h ? passTime(h, pass) ?? def : def);
    out.push({
      terraDay: pick(lst?.terra, "day", NOMINAL_PASSES.terraDay),
      terraNight: pick(lst?.terra, "night", NOMINAL_PASSES.terraNight),
      aquaDay: pick(lst?.aqua, "day", NOMINAL_PASSES.aquaDay),
      aquaNight: pick(lst?.aqua, "night", NOMINAL_PASSES.aquaNight),
      snppDay: pick(lst?.snpp, "day", NOMINAL_PASSES.snppDay),
    });
  }
  return out;
}

export interface EmissionsFile {
  generatedAt: string;
  units: { fre: "PJ"; dm: "Tg"; co2: "Tg"; co: "Tg"; pm25: "Tg" };
  fields: (keyof EmissionYear)[];
  firstYear: number;
  lastYear: number;
  world: { years: number[][]; diurnal: number[][] };
  countries: { name: string; years: number[][]; diurnal: number[][] }[];
  method: string;
}

const EM_FIELDS: (keyof EmissionYear)[] = ["fre", "freLo", "freHi", "dm", "co2", "co2Lo", "co2Hi", "co", "coLo", "coHi", "pm25", "pm25Lo", "pm25Hi"];

export function buildEmissions(years: YearOutput[], countryNames: string[], firstYear: number, lastYear: number): EmissionsFile | null {
  if (!years.some((y) => y.sat)) return null;
  const nY = lastYear - firstYear + 1;
  const passes = passTimesByYear(years, firstYear, lastYear);
  const train = trainYears(firstYear, lastYear);
  const satOf = (name: string | null) => {
    const arr = new Array(nY * 12 * NS).fill(0);
    for (const y of years) {
      if (!y.sat) continue;
      const off = (y.year - firstYear) * 12 * NS;
      if (name) {
        const s = y.sat[name];
        if (s) for (let i = 0; i < s.length; i++) arr[off + i] = s[i];
      } else for (const s of Object.values(y.sat)) for (let i = 0; i < s.length; i++) arr[off + i] += s[i];
    }
    return arr;
  };
  const pack = (u: ReturnType<typeof unitEmissions>) => ({
    years: u.years.map((y) => [...EM_FIELDS.map((f) => y[f] as number), y.source === "viirs" ? 1 : 0]),
    diurnal: u.diurnal.map((d) => [d.b, d.a, d.h, d.s].map((v) => Math.round(v * 1000) / 1000)),
  });
  const worldSat = satOf(null);
  // Root of the FRE hierarchy: the world fitted to itself.
  const w0 = unitEmissions(worldSat, firstYear, lastYear, passes, train, { kAnnual: 1, sigma: 0.35 });
  const worldU = unitEmissions(worldSat, firstYear, lastYear, passes, train, w0.model);
  const countries = countryNames.map((name) => ({ name, ...pack(unitEmissions(satOf(name), firstYear, lastYear, passes, train, worldU.model)) }));
  return {
    generatedAt: new Date().toISOString(),
    units: { fre: "PJ", dm: "Tg", co2: "Tg", co: "Tg", pm25: "Tg" },
    fields: [...EM_FIELDS, "source" as keyof EmissionYear],
    firstYear,
    lastYear,
    world: pack(worldU),
    countries,
    method:
      "FRE from VIIRS (2012+) or harmonized MODIS/Aqua FRP at ~13:30 × diurnal integral (Gaussian + baseline fitted to Terra/Aqua day/night FRP per calendar month, actual overpass times per year); dry matter = 0.368 kg/MJ (Wooster et al. 2005); biome-generic emission factors with cross-biome range after Andreae (2019). No cloud correction: conservative.",
  };
}
