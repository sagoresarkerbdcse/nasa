import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyzeAoi, mannKendall } from "../src/lib/harmonize";
import { DOMAIN, REGIONS } from "../src/lib/regions";
import { RECORD_WIDTH, type GridFile } from "../src/lib/types";

const grid: GridFile = JSON.parse(readFileSync("public/data/grid.json", "utf8"));

test("grid records are well-formed", () => {
  assert.equal(grid.records.length % RECORD_WIDTH, 0);
  for (let i = 0; i < grid.records.length; i += RECORD_WIDTH) {
    assert.ok(grid.records[i] < grid.cells.length);
    assert.ok(grid.records[i + 2] >= 1 && grid.records[i + 2] <= 12);
    // Fire-days can never exceed raw detections for the same sensor.
    assert.ok(grid.records[i + 5] <= grid.records[i + 3]);
    assert.ok(grid.records[i + 6] <= grid.records[i + 4]);
  }
});

test("harmonization removes the 2012 sensor jump", () => {
  const a = analyzeAoi(grid, DOMAIN);
  const mean = (ys: number[], key: "naive" | "harmonized") => ys.reduce((s, y) => s + a.annual.find((x) => x.year === y)![key], 0) / ys.length;
  const before = [2009, 2010, 2011];
  const after = [2012, 2013, 2014];
  const naiveJump = mean(after, "naive") / mean(before, "naive");
  const harmJump = mean(after, "harmonized") / mean(before, "harmonized");
  // Real fire activity varies year to year, so the bound is looser than the sensor jump itself.
  assert.ok(harmJump < naiveJump / 1.8, `harmonization should shrink the jump (naive ${naiveJump.toFixed(2)}, harmonized ${harmJump.toFixed(2)})`);
  assert.ok(naiveJump > 2.5, `naive series should jump at VIIRS start (got ${naiveJump.toFixed(2)})`);
  if (grid.meta.source === "sample") assert.ok(harmJump > 0.6 && harmJump < 1.4, `harmonized series should be continuous (got ${harmJump.toFixed(2)})`);
  assert.ok(a.k > 1, "VIIRS should see more fire-days than MODIS");
});

const sampleOnly = { skip: grid.meta.source !== "sample" && "checks planted events in the synthetic sample" };

test("Sundarbans flags the March 2023 event as its top anomaly", sampleOnly, () => {
  const a = analyzeAoi(grid, REGIONS.find((r) => r.id === "sundarbans")!.bbox);
  assert.equal(a.anomalies[0].year, 2023);
  assert.equal(a.anomalies[0].month, 3);
  assert.equal(a.anomalies[0].anomaly, "extreme");
});

test("jhum regions peak in March-April", sampleOnly, () => {
  const a = analyzeAoi(grid, REGIONS.find((r) => r.id === "cht")!.bbox);
  assert.deepEqual(a.peakMonths.slice(0, 2).sort(), [3, 4]);
});

test("Mann-Kendall detects a clear trend and ignores flat noise", () => {
  const up = mannKendall(Array.from({ length: 20 }, (_, i) => i * 3 + (i % 3)));
  assert.equal(up.direction, "increasing");
  assert.ok(up.pValue < 0.001);
  const flat = mannKendall([5, 7, 5, 6, 7, 5, 6, 5, 7, 6, 5, 6]);
  assert.equal(flat.significant, false);
});
