/** Real numbers for the Explain stories, computed from the harmonized record. */
import { hindcast, hotspotsInBBox, seasonTiming } from "../lib/analytics";
import { analyzeAoi } from "../lib/harmonize";
import { DOMAIN, REGIONS } from "../lib/regions";
import type { GridFile } from "../lib/types";

export interface Facts {
  source: "sample" | "firms";
  firstYear: number;
  lastYear: number;
  years: number;
  detections: number;
  modis: number;
  viirs: number;
  k: number;
  naiveJump: number;
  fireDays: number;
  peakMonths: [string, string];
  peakShare: number;
  declinePct: number;
  onsetDaysPerDecade: number | null;
  lengthDaysPerDecade: number | null;
  meanOnset: string;
  persistentCells: number;
  coolingCells: number;
  chtShare: number;
  outlookSkill: number;
  annual: number[];
  naiveAnnual: number[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function computeFacts(grid: GridFile): Facts {
  const a = analyzeAoi(grid, DOMAIN);
  const s = seasonTiming(a);
  const h = hotspotsInBBox(grid, DOMAIN);
  const cht = analyzeAoi(grid, REGIONS.find((r) => r.id === "cht")!.bbox);
  const full = a.annual.filter((y) => y.year < grid.meta.lastYear || grid.meta.lastMonth === 12);
  const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / Math.max(xs.length, 1);
  const first = mean(full.slice(0, 6).map((y) => y.harmonized));
  const last = mean(full.slice(-6).map((y) => y.harmonized));
  const pre = a.annual.filter((y) => y.year < grid.meta.viirsStartYear).slice(-3);
  const post = a.annual.filter((y) => y.year >= grid.meta.viirsStartYear).slice(0, 3);
  const [p1, p2] = a.peakMonths;
  return {
    source: grid.meta.source,
    firstYear: grid.meta.firstYear,
    lastYear: grid.meta.lastYear,
    years: grid.meta.lastYear - grid.meta.firstYear + 1,
    detections: a.totals.modisRaw + a.totals.viirsRaw,
    modis: a.totals.modisRaw,
    viirs: a.totals.viirsRaw,
    k: a.k,
    naiveJump: Math.round((mean(post.map((y) => y.naive)) / Math.max(1, mean(pre.map((y) => y.naive)))) * 10) / 10,
    fireDays: a.totals.harmonized,
    peakMonths: [MONTHS[p1 - 1], MONTHS[p2 - 1]],
    peakShare: Math.round((a.climatology[p1 - 1].share + a.climatology[p2 - 1].share) * 100),
    declinePct: Math.round(((last - first) / Math.max(first, 1)) * 100),
    onsetDaysPerDecade: s.trends.onset.significant ? Math.round(s.trends.onset.senSlope * 10) : null,
    lengthDaysPerDecade: s.trends.length.significant ? Math.round(s.trends.length.senSlope * 10) : null,
    meanOnset: s.years.length ? s.label(s.mean.onset) : "",
    persistentCells: h.counts.persistent + h.counts.intensifying,
    coolingCells: h.counts.diminishing + h.counts.historical,
    chtShare: Math.round((cht.totals.harmonized / Math.max(a.totals.harmonized, 1)) * 100),
    outlookSkill: Math.round(hindcast(a).skill * 100),
    annual: full.map((y) => y.harmonized),
    naiveAnnual: full.map((y) => y.naive),
  };
}
