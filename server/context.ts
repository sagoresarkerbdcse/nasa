/**
 * Builds the grounding facts the analyst is allowed to use. Everything the
 * model says about the area should trace back to a number in this block.
 */
import { analyzeAoi, cellsInBBox } from "../src/lib/harmonize";
import { MONTHS, formatBBox } from "../src/lib/regions";
import { RECORD_WIDTH, type AoiAnalysis, type BBox, type GridFile } from "../src/lib/types";

export interface Focus {
  year: number;
  month: number;
}

export interface Grounding {
  analysis: AoiAnalysis;
  regionName: string;
  outlookMonths: { year: number; month: number }[];
  hotCells: { lat: number; lon: number; fireDays: number }[];
  text: string;
}

export function buildGrounding(grid: GridFile, bbox: BBox, regionName: string): Grounding {
  const analysis = analyzeAoi(grid, bbox);
  const { lastYear, lastMonth, source, firstYear, viirsStartYear } = grid.meta;

  const outlookMonths = [1, 2].map((i) => {
    const idx = lastYear * 12 + (lastMonth - 1) + i;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
  });

  // Recurring hot cells for the outlook months over the last 5 VIIRS years.
  const cells = cellsInBBox(grid, bbox);
  const outlookSet = new Set(outlookMonths.map((o) => o.month));
  const perCell = new Map<number, number>();
  const r = grid.records;
  for (let i = 0; i < r.length; i += RECORD_WIDTH) {
    if (!cells.has(r[i]) || r[i + 1] < lastYear - 5 || !outlookSet.has(r[i + 2])) continue;
    perCell.set(r[i], (perCell.get(r[i]) ?? 0) + r[i + 6]);
  }
  const hotCells = [...perCell.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c, v]) => ({ lon: grid.cells[c][0], lat: grid.cells[c][1], fireDays: Math.round(v / 5) }));

  const a = analysis;
  const monthly = a.months
    .filter((m) => !m.missing)
    .map((m) => `${m.year}-${String(m.month).padStart(2, "0")},${m.harmonized},${m.naive},${m.modisRaw},${m.viirsRaw},${m.hci},${m.z ?? ""},${m.pctVsBaseline ?? ""},${m.anomaly ?? ""}`)
    .join("\n");

  const text = `<fire_data>
DATA SOURCE: ${source === "sample" ? "SYNTHETIC DEMO DATA (simulated MODIS+VIIRS record; seasonal patterns realistic, yearly values and events invented). Say so if asked about real-world events." : "NASA FIRMS MODIS C6.1 + VIIRS S-NPP 375 m active fire archive."}
AREA OF INTEREST: ${regionName} — bbox ${formatBBox(bbox)} (${a.cellCount} grid cells of ${grid.meta.cellSize}°)
RECORD: ${firstYear}-01 to ${lastYear}-${String(lastMonth).padStart(2, "0")}. VIIRS available from ${viirsStartYear}.
UNITS: "harmonized" = fire-days in VIIRS-equivalent units (unique 0.01° cell × day with a nominal/high-confidence detection; MODIS era scaled by k).
HARMONIZATION: k = ${a.k} (${a.kSource === "aoi" ? "calibrated on this AOI" : "domain-wide factor; AOI too sparse"}) over overlap ${a.overlapYears[0]}-${a.overlapYears[1]}.
TOTALS: harmonized ${a.totals.harmonized} fire-days; naive (MODIS raw then VIIRS raw) ${a.totals.naive} detections; MODIS raw ${a.totals.modisRaw}; VIIRS raw ${a.totals.viirsRaw}.
TREND (Mann-Kendall on annual harmonized totals, complete years): ${a.trend.direction}; Sen's slope ${a.trend.senSlope} fire-days/yr; tau ${a.trend.tau}; p = ${a.trend.pValue}.
CLIMATOLOGY (mean harmonized fire-days per month, share of annual): ${a.climatology.map((c) => `${MONTHS[c.month - 1]} ${c.mean} (${Math.round(c.share * 100)}%)`).join("; ")}
PEAK MONTHS: ${a.peakMonths.map((m) => MONTHS[m - 1]).join(", ")}
ANNUAL HARMONIZED: ${a.annual.map((y) => `${y.year}:${Math.round(y.harmonized)}`).join(" ")}${lastMonth < 12 ? ` (${lastYear} partial)` : ""}
FLAGGED ANOMALIES (vs same month, previous 10 yrs): ${a.anomalies.slice(0, 15).map((m) => `${m.year}-${String(m.month).padStart(2, "0")} ${m.anomaly} (${m.harmonized} vs baseline ${m.baseline}, ${m.pctVsBaseline! >= 0 ? "+" : ""}${m.pctVsBaseline}%, z=${m.z}, HCI ${m.hci})`).join("; ") || "none"}
OUTLOOK MONTHS (next after record end): ${outlookMonths.map((o) => `${MONTHS[o.month - 1]} ${o.year} — climatology ${a.climatology[o.month - 1].mean} fire-days`).join("; ")}
RECURRING HOT CELLS FOR OUTLOOK MONTHS (avg VIIRS fire-days/yr, last 5 yrs): ${hotCells.map((h) => `${h.lat.toFixed(2)}N ${h.lon.toFixed(2)}E: ${h.fireDays}`).join("; ") || "none"}
MONTHLY TABLE (month,harmonized,naive,modis_raw,viirs_raw,hci,z,pct_vs_10yr,anomaly):
${monthly}
</fire_data>`;

  return { analysis, regionName, outlookMonths, hotCells, text };
}
