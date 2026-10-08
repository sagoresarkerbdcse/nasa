/**
 * Writes the tabular part of the open FireCal Harmonized Active Fire dataset
 * (CSV + JSON). pipeline/export_dataset.py turns the gridded part into NetCDF and
 * Cloud-Optimized GeoTIFFs and writes the STAC catalog and metadata.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fitUnit, predict, predictAnnual, type Series, type UnitModel } from "../src/lib/harmonize2";
import type { EmissionsFile, HarmonizationFile } from "./harmonization-build";
import { trainYears } from "./harmonization-build";

const NF = 10;

interface Input {
  firstYear: number;
  lastYear: number;
  countries: { name: string; data: number[] }[];
  world: number[];
  ids: number[];
  cellsV2: { yearly: number[]; yearlyLo: number[]; yearlyHi: number[]; models: Map<number, UnitModel>; series: Map<number, Series> };
  harmonization: HarmonizationFile;
  emissions: EmissionsFile | null;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: unknown[][]) => [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
const r1 = (v: number) => Math.round(v * 10) / 10;

export function writeDatasetTables(dir: string, inp: Input) {
  mkdirSync(dir, { recursive: true });
  const { firstYear, lastYear } = inp;
  const train = trainYears(firstYear, lastYear);
  const root = inp.harmonization.world;

  // --- countries (and world) monthly + annual --------------------------------------
  const monthly: unknown[][] = [];
  const annual: unknown[][] = [];
  const em = new Map((inp.emissions?.countries ?? []).map((c) => [c.name, c.years]));
  const units = [{ name: "World", data: inp.world }, ...inp.countries];
  for (const u of units) {
    const n = u.data.length / NF;
    const s: Series = { M: Array.from({ length: n }, (_, i) => u.data[i * NF + 2]), V: Array.from({ length: n }, (_, i) => u.data[i * NF + 3]) };
    const model = u.name === "World" ? root : fitUnit(s, { firstYear, trainYears: train }, root);
    const emYears = u.name === "World" ? inp.emissions?.world.years : em.get(u.name);
    for (let y = firstYear; y <= lastYear; y++) {
      const viirs = y >= 2012;
      for (let m = 0; m < 12; m++) {
        const i = (y - firstYear) * 12 + m;
        const d = (f: number) => u.data[i * NF + f];
        const p = viirs ? null : predict(model, d(2), m);
        monthly.push([u.name, y, m + 1, d(2), d(3), p ? r1(p.v) : d(3), p ? r1(p.lo) : "", p ? r1(p.hi) : "", viirs ? "viirs_observed" : "modis_harmonized", d(0), d(1), d(6), d(7), d(8), d(9)]);
      }
      const b = (y - firstYear) * 12;
      const mods = Array.from({ length: 12 }, (_, m) => u.data[(b + m) * NF + 2]);
      const vSum = Array.from({ length: 12 }, (_, m) => u.data[(b + m) * NF + 3]).reduce((a, c) => a + c, 0);
      const pa = viirs ? null : predictAnnual(model, mods);
      const e = emYears?.[y - firstYear];
      annual.push([
        u.name,
        y,
        mods.reduce((a, c) => a + c, 0),
        vSum,
        pa ? r1(pa.v) : vSum,
        pa ? r1(pa.lo) : "",
        pa ? r1(pa.hi) : "",
        viirs ? "viirs_observed" : "modis_harmonized",
        ...(e ? e.slice(0, 13) : new Array(13).fill("")),
      ]);
    }
  }
  writeFileSync(
    join(dir, "country_monthly.csv"),
    csv(["country", "year", "month", "modis_fire_days", "viirs_fire_days", "harmonized_fire_days", "harmonized_lo90", "harmonized_hi90", "source", "modis_detections", "viirs_detections", "modis_frp_mw_sum", "viirs_frp_mw_sum", "modis_night_detections", "viirs_night_detections"], monthly),
  );
  writeFileSync(
    join(dir, "country_annual.csv"),
    csv(
      [
        "country",
        "year",
        "modis_fire_days",
        "viirs_fire_days",
        "harmonized_fire_days",
        "harmonized_lo90",
        "harmonized_hi90",
        "source",
        "fre_pj",
        "fre_pj_lo",
        "fre_pj_hi",
        "dry_matter_tg",
        "co2_tg",
        "co2_tg_lo",
        "co2_tg_hi",
        "co_tg",
        "co_tg_lo",
        "co_tg_hi",
        "pm25_tg",
        "pm25_tg_lo",
        "pm25_tg_hi",
      ],
      annual,
    ),
  );

  // --- 1° grid, annual (CSV) and monthly (compact JSON for the NetCDF step) ----------
  const nY = lastYear - firstYear + 1;
  const gridRows: unknown[][] = [];
  inp.ids.forEach((id, ci) => {
    const lat = Math.floor(id / 360) - 90 + 0.5;
    const lon = (id % 360) - 180 + 0.5;
    for (let k = 0; k < nY; k++) {
      const v = inp.cellsV2.yearly[ci * nY + k];
      if (!v) continue;
      const y = firstYear + k;
      gridRows.push([id, lat, lon, y, v, y < 2012 ? inp.cellsV2.yearlyLo[ci * nY + k] : "", y < 2012 ? inp.cellsV2.yearlyHi[ci * nY + k] : ""]);
    }
  });
  writeFileSync(join(dir, "grid_1deg_annual.csv"), csv(["cell_id", "lat_center", "lon_center", "year", "harmonized_fire_days", "harmonized_lo90", "harmonized_hi90"], gridRows));

  const monthlyGrid: number[] = [];
  const monthlyLo: number[] = [];
  const monthlyHi: number[] = [];
  for (const id of inp.ids) {
    const s = inp.cellsV2.series.get(id)!;
    const u = inp.cellsV2.models.get(id)!;
    for (let i = 0; i < nY * 12; i++) {
      const y = firstYear + Math.floor(i / 12);
      if (y >= 2012) {
        monthlyGrid.push(s.V[i]);
        monthlyLo.push(-1);
        monthlyHi.push(-1);
      } else {
        const p = predict(u, s.M[i], i % 12);
        monthlyGrid.push(r1(p.v));
        monthlyLo.push(r1(p.lo));
        monthlyHi.push(r1(p.hi));
      }
    }
  }
  writeFileSync(join(dir, "grid_1deg_monthly.json"), JSON.stringify({ firstYear, lastYear, ids: inp.ids, values: monthlyGrid, lo: monthlyLo, hi: monthlyHi }));

  // --- model, validation, detection, drift ------------------------------------------
  writeFileSync(join(dir, "harmonization_model.json"), JSON.stringify(inp.harmonization, null, 1));
  writeFileSync(
    join(dir, "validation.csv"),
    csv(
      ["train_years", "test_years", "method", "monthly_median_abs_error_pct", "monthly_p90_abs_error_pct", "annual_median_abs_error_pct", "annual_p90_abs_error_pct", "annual_median_bias_pct", "coverage90_monthly", "coverage90_annual", "n_months", "n_country_years"],
      inp.harmonization.validation.flatMap((f) =>
        f.scores.map((s) => [`${f.train[0]}-${f.train[f.train.length - 1]}`, `${f.test[0]}-${f.test[f.test.length - 1]}`, s.method, s.monthlyMedianPct, s.monthlyP90Pct, s.annualMedianPct, s.annualP90Pct, s.annualBiasPct, s.coverage90 ?? "", s.coverage90Annual ?? "", s.nMonths, s.nYears]),
      ),
    ),
  );
  const det = inp.harmonization.detection;
  if (det)
    writeFileSync(
      join(dir, "modis_detection_probability.csv"),
      csv(
        ["curve", "viirs_frp_mw", "observed_probability", "fitted_probability", "n_objects"],
        det.curves.flatMap((c) => c.points.map((p) => [c.label, p.frp, p.p, p.fit, p.n])),
      ),
    );
  const drift = inp.harmonization.drift;
  if (drift)
    writeFileSync(
      join(dir, "orbit_drift.csv"),
      csv(
        ["satellite", "pass", "year", "overpass_local_solar_time_h", "shift_min", "detection_ratio_vs_viirs", "drift_bias_modis_pct"],
        drift.passes.flatMap((ps) => ps.points.map((p) => [ps.sat, ps.pass, p.year, p.lst, p.shiftMin, p.ratio ?? "", drift.bias.find((b) => b.year === p.year)?.pct ?? ""])),
      ),
    );
}
