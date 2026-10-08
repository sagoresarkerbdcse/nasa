import assert from "node:assert/strict";
import { test } from "node:test";
import { fitDetection, idx } from "../src/lib/detection";
import { passTime } from "../src/lib/drift";
import { dailyFactor, diurnalAt, fitDiurnal } from "../src/lib/emissions";
import { blindTest, detectSensorGaps, fitUnit, gapAdjust, predict, setSensorGaps, viirsCompleteness, type Series } from "../src/lib/harmonize2";

const FIRST = 2003;
const LAST = 2024;

/** Synthetic unit: VIIRS = k[m]·MODIS + floor with multiplicative noise, deterministic RNG. */
function synth(k: number[], floor: number, seed: number, noise = 0.1): Series {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const n = (LAST - FIRST + 1) * 12;
  const M = new Array(n);
  const V = new Array(n);
  for (let i = 0; i < n; i++) {
    const m = i % 12;
    const y = FIRST + Math.floor(i / 12);
    M[i] = Math.round(300 * (1 + 2 * Math.exp(-((m - 4) ** 2) / 3)) * (0.7 + 0.6 * rnd()));
    V[i] = y >= 2012 ? Math.round((k[m] * M[i] + floor) * (1 - noise + 2 * noise * rnd())) : 0;
  }
  return { M, V };
}

test("v2 predicts held-out years of a seasonal ratio with a small-fire floor", () => {
  // smooth seasonal ratio between ~2 and ~4 (real seasons change gradually)
  const k = Array.from({ length: 12 }, (_, m) => 3 + Math.sin(((m - 3) / 12) * 2 * Math.PI));
  const s = synth(k, 50, 11, 0.02);
  const u = fitUnit(s, { firstYear: FIRST, trainYears: [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021] }, { kAnnual: 2.8, sigma: 0.3 });
  // k and the floor trade off when MODIS varies little between years, so check what matters:
  // held-out years (not used in training) are predicted close to the truth.
  const errs: number[] = [];
  for (let y = 2022; y <= 2024; y++)
    for (let m = 0; m < 12; m++) {
      const M = s.M[(y - FIRST) * 12 + m];
      const truth = k[m] * M + 50;
      errs.push(Math.abs(predict(u, M, m).v - truth) / truth);
    }
  errs.sort((a, b) => a - b);
  assert.ok(errs[Math.floor(errs.length / 2)] < 0.05, `median error ${errs[Math.floor(errs.length / 2)]}`);
  assert.ok(errs[errs.length - 1] < 0.15, `max error ${errs[errs.length - 1]}`);
  assert.ok(u.floor.every((f) => f >= 0), `floor ${u.floor}`);
  assert.ok(u.kLo.every((lo, m) => lo <= u.k[m] + 0.002 && u.kHi[m] >= u.k[m] - 0.002));
});

test("v2 intervals cover held-out values about 90% of the time", () => {
  const units = Array.from({ length: 30 }, (_, i) => synth(Array.from({ length: 12 }, (_, m) => 2 + ((i + m) % 5) * 0.4), 20 + i, 100 + i, 0.25));
  const f = blindTest(units, FIRST, [2017, 2018, 2019, 2020, 2021], [2013, 2014, 2015, 2016], 50, 500);
  const v2 = f.scores.find((s) => s.method === "v2")!;
  const global = f.scores.find((s) => s.method === "v1-global")!;
  assert.ok(v2.monthlyMedianPct < global.monthlyMedianPct, "v2 beats a single global ratio");
  assert.ok(v2.coverage90! > 0.8 && v2.coverage90! <= 1, `coverage ${v2.coverage90}`);
});

test("predict returns ordered, non-negative intervals", () => {
  const u = fitUnit(synth(new Array(12).fill(2.5), 10, 5), { firstYear: FIRST, trainYears: [2013, 2014, 2015, 2016, 2017] }, { kAnnual: 2.5, sigma: 0.3 });
  for (const M of [0, 1, 10, 1000]) {
    const p = predict(u, M, 3);
    assert.ok(p.lo >= 0 && p.lo <= p.v && p.v <= p.hi, JSON.stringify(p));
  }
});

test("detection model recovers known logistic coefficients", () => {
  const frpMid = [0.7, 1.41, 2.83, 5.66, 11.3, 22.6, 45.3, 90.5, 181, 362, 724, 1448, 2896];
  const pixMid = [1.2, 1.95, 3.2, 5.3, 8.5];
  const t = new Array(5 * 2 * 13 * 5 * 2).fill(0);
  for (let b = 0; b < 5; b++)
    for (let n = 0; n < 2; n++)
      for (let f = 0; f < 13; f++)
        for (let p = 0; p < 5; p++) {
          const z = -4 + Math.log2(frpMid[f]) - 1.2 * Math.log(pixMid[p]) - 0.5 * n;
          t[idx(b, n, f, p) * 2] = 5000;
          t[idx(b, n, f, p) * 2 + 1] = Math.round(5000 / (1 + Math.exp(-z)));
        }
  const m = fitDetection(t);
  const c = Object.fromEntries(m.coef.map((x) => [x.name, x.value]));
  assert.ok(Math.abs(c["log2 FRP"] - 1) < 0.02);
  assert.ok(Math.abs(c["ln pixel area"] + 1.2) < 0.05);
  assert.ok(Math.abs(c.night + 0.5) < 0.02);
  // FRP50 at nadir by day: 2^(4 + 1.2·ln 1.2) ≈ 18.6 MW
  assert.ok(Math.abs(m.frp50[0].mw - 18.6) < 1);
});

test("overpass time from a histogram, including night passes across midnight", () => {
  const h = new Array(96).fill(0);
  h[54] = 10; // 13:30–13:45
  assert.ok(Math.abs(passTime(h, "day")! - 13.625) < 1e-6);
  const n = new Array(96).fill(0);
  n[95] = 5; // 23:45
  n[1] = 5; // 00:15
  const t = passTime(n, "night")!;
  assert.ok(Math.abs(t - 0.125) < 1e-6, `night ${t}`); // circular mean of 23:52 and 00:22
});

test("diurnal fit reproduces an afternoon peak and a sensible daily factor", () => {
  const truth = { b: 0.1, a: 1, h: 14.5, s: 2.5 };
  const samples = [10.5, 13.5, 22.5, 1.5].map((t) => ({ t, v: diurnalAt(truth, t) }));
  const g = fitDiurnal(samples);
  for (const s of samples) assert.ok(Math.abs(diurnalAt(g, s.t) - s.v) < 0.05);
  const f = dailyFactor(g, 13.5);
  assert.ok(f > 4 && f < 12, `daily factor ${f} h`);
});

test("sensor outages are found from the world VIIRS/MODIS ratio", () => {
  const s = synth(new Array(12).fill(2.5), 0, 21, 0.03);
  const V = Array.from(s.V as ArrayLike<number>);
  const M = Array.from(s.M as ArrayLike<number>);
  V[(2022 - FIRST) * 12 + 7] *= 0.6; // VIIRS outage, August 2022
  M[(2019 - FIRST) * 12 + 3] *= 0.5; // MODIS outage, April 2019
  const g = detectSensorGaps({ M, V }, FIRST, LAST);
  assert.deepEqual(g.viirs.map((x) => [x.year, x.month]), [[2022, 8]]);
  assert.ok(Math.abs(g.viirs[0].completeness - 0.6) < 0.06, `completeness ${g.viirs[0].completeness}`);
  assert.deepEqual(g.modis.map((x) => [x.year, x.month]), [[2019, 4]]);
  setSensorGaps(g);
  assert.ok(viirsCompleteness(2022, 7)! < 0.7 && viirsCompleteness(2022, 6) === undefined);
  const adj = gapAdjust(600, 0.6);
  assert.ok(Math.abs(adj.v - 1000) < 1e-9 && adj.lo >= 600 && adj.hi > 1000);
  setSensorGaps(null);
});
