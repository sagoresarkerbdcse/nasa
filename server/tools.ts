/**
 * Tools the FireCal Analyst can call. Data tools compute answers from the
 * harmonized record; `update_dashboard` drives the user's screen (map region,
 * year, month, layer, panel tab). Shared by the Claude agent and the offline
 * analyst so both give the same numbers.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { HOTSPOT_META, hindcast, hotspotsInBBox, liveSummary, outlook, seasonTiming } from "../src/lib/analytics";
import { analyzeAoi } from "../src/lib/harmonize";
import { MONTHS, REGIONS, formatBBox } from "../src/lib/regions";
import type { BBox, GridFile, LiveFile } from "../src/lib/types";

export type Layer = "activity" | "anomaly" | "hotspots" | "outlook" | "live";
export type Tab = "calendar" | "trends" | "hotspots" | "outlook" | "live";

export interface DashboardAction {
  regionId?: string;
  bbox?: BBox;
  year?: number;
  month?: number | null;
  layer?: Layer;
  tab?: Tab;
  view3d?: boolean;
}

export interface ToolContext {
  grid: GridFile;
  getLive: () => Promise<LiveFile | null>;
  /** Area the user currently has selected, used when the model omits one. */
  current: { bbox: BBox; name: string };
  emit: (action: DashboardAction) => void;
}

const AREA_PROPS = {
  region: { type: "string", description: "Preset area: sylhet, sundarbans, cht (Chittagong Hill Tracts) or domain (whole study area). Omit to use the user's current area." },
  bbox: { type: "array", items: { type: "number" }, description: "Custom [minLon, minLat, maxLon, maxLat] within 88.0-92.75E, 20.5-26.75N. Overrides region." },
} as const;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_area_overview",
    description: "Headline statistics for an area: totals, peak months, calibration factor k, long-term trend, top anomalies, fire-season timing and hot-spot pattern counts. Call this first for any broad question.",
    input_schema: { type: "object", properties: { ...AREA_PROPS } },
  },
  {
    name: "get_monthly_series",
    description: "Monthly harmonized fire-days for an area. Give `year` for its 12 months, or `month` (1-12) for that month across all years, or both for one month.",
    input_schema: { type: "object", properties: { ...AREA_PROPS, year: { type: "integer" }, month: { type: "integer", minimum: 1, maximum: 12 } } },
  },
  {
    name: "rank_months",
    description: "Rank months in the record, by harmonized fire-days or by anomaly z-score, highest or lowest first.",
    input_schema: {
      type: "object",
      properties: { ...AREA_PROPS, by: { type: "string", enum: ["fire_days", "anomaly"] }, order: { type: "string", enum: ["highest", "lowest"] }, limit: { type: "integer", minimum: 1, maximum: 15 } },
      required: ["by"],
    },
  },
  {
    name: "compare_periods",
    description: "Compare mean annual (or one calendar month's) harmonized fire-days between two year ranges, e.g. 2003-2008 vs 2019-2024.",
    input_schema: {
      type: "object",
      properties: {
        ...AREA_PROPS,
        period_a: { type: "array", items: { type: "integer" }, description: "[firstYear, lastYear]" },
        period_b: { type: "array", items: { type: "integer" }, description: "[firstYear, lastYear]" },
        month: { type: "integer", minimum: 1, maximum: 12 },
      },
      required: ["period_a", "period_b"],
    },
  },
  {
    name: "get_hotspot_trends",
    description: "Emerging hot spot analysis (Getis-Ord Gi* + Mann-Kendall) for 0.25° cells in an area: how many cells are intensifying, persistent, diminishing, new, etc., and the most active hot-spot cells with coordinates.",
    input_schema: { type: "object", properties: { ...AREA_PROPS } },
  },
  {
    name: "get_season_timing",
    description: "Fire-season onset (10%), peak (50%) and end (90%) dates, season length, and whether they are shifting (Mann-Kendall), for an area.",
    input_schema: { type: "object", properties: { ...AREA_PROPS } },
  },
  {
    name: "get_outlook",
    description: "Statistical outlook for the next 1-6 calendar months (expected fire-days, likely range, chance of above-normal) plus hindcast skill vs climatology. Based on past years only, no weather input.",
    input_schema: { type: "object", properties: { ...AREA_PROPS, months: { type: "integer", minimum: 1, maximum: 6 } } },
  },
  {
    name: "get_live_fires",
    description: "Near-real-time NASA FIRMS detections from the last 7 days in an area (VIIRS S-NPP, NOAA-20, NOAA-21, MODIS), compared with normal activity for this time of year.",
    input_schema: { type: "object", properties: { ...AREA_PROPS } },
  },
  {
    name: "update_dashboard",
    description:
      "Change what the user sees: fly the map to an area, pick a year/month, switch the map layer (activity, anomaly, hotspots, outlook, live), open a panel tab (calendar, trends, hotspots, outlook, live) or toggle the 3D globe. Use it whenever your answer is about a place or time the user should look at.",
    input_schema: {
      type: "object",
      properties: {
        ...AREA_PROPS,
        year: { type: "integer" },
        month: { type: ["integer", "null"], minimum: 1, maximum: 12 },
        layer: { type: "string", enum: ["activity", "anomaly", "hotspots", "outlook", "live"] },
        tab: { type: "string", enum: ["calendar", "trends", "hotspots", "outlook", "live"] },
        view3d: { type: "boolean" },
      },
    },
  },
];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function resolveArea(input: Record<string, unknown>, ctx: ToolContext): { bbox: BBox; name: string; regionId?: string } {
  const b = input.bbox;
  if (Array.isArray(b) && b.length === 4 && b.every(isNum) && b[0] < b[2] && b[1] < b[3]) {
    const bb = b.map((v, i) => Math.min(Math.max(v, [88, 20.5, 88, 20.5][i]), [92.75, 26.75, 92.75, 26.75][i])) as BBox;
    return { bbox: bb, name: `Custom area (${formatBBox(bb)})` };
  }
  if (typeof input.region === "string") {
    const q = input.region.toLowerCase();
    const r = REGIONS.find((x) => x.id === q || x.name.toLowerCase().includes(q) || x.short.toLowerCase() === q || (q.includes("chittagong") && x.id === "cht") || (/(whole|all|bangladesh|domain)/.test(q) && x.id === "domain"));
    if (r) return { bbox: r.bbox, name: r.name, regionId: r.id };
  }
  return ctx.current;
}

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const { grid } = ctx;
  const area = resolveArea(input, ctx);
  const a = analyzeAoi(grid, area.bbox);
  const yearOk = (y: unknown) => isNum(y) && y >= grid.meta.firstYear && y <= grid.meta.lastYear;

  switch (name) {
    case "get_area_overview": {
      const s = seasonTiming(a);
      const h = hotspotsInBBox(grid, area.bbox);
      return {
        area: area.name,
        record: `${grid.meta.firstYear}-${grid.meta.lastYear}`,
        data_source: grid.meta.source === "sample" ? "SYNTHETIC demo data" : "NASA FIRMS MODIS C6.1 + VIIRS S-NPP archive",
        total_harmonized_fire_days: a.totals.harmonized,
        naive_mixed_sensor_detections: a.totals.naive,
        calibration_k: a.k,
        peak_months: a.peakMonths.map((m) => MONTHS[m - 1]),
        climatology_fire_days_by_month: Object.fromEntries(a.climatology.map((c) => [MONTHS[c.month - 1], c.mean])),
        trend: { direction: a.trend.direction, sen_slope_per_year: a.trend.senSlope, p_value: a.trend.pValue },
        top_anomalies: a.anomalies.slice(0, 5).map((m) => ({ month: ym(m.year, m.month), level: m.anomaly, fire_days: m.harmonized, baseline: m.baseline, pct: m.pctVsBaseline, z: m.z })),
        season: s.years.length ? { onset: s.label(s.mean.onset), peak: s.label(s.mean.peak), end: s.label(s.mean.end), onset_shift_days_per_year: s.trends.onset.senSlope, onset_p: s.trends.onset.pValue, length_change_days_per_year: s.trends.length.senSlope, length_p: s.trends.length.pValue } : "too little fire to time a season",
        hotspot_cells: h.counts,
      };
    }
    case "get_monthly_series": {
      const rows = a.months.filter((m) => !m.missing && (!yearOk(input.year) || m.year === input.year) && (!isNum(input.month) || m.month === input.month));
      return {
        area: area.name,
        rows: rows.slice(0, 40).map((m) => ({ month: ym(m.year, m.month), harmonized: m.harmonized, naive: m.naive, modis_raw: m.modisRaw, viirs_raw: m.viirsRaw, hci: m.hci, pct_vs_10yr: m.pctVsBaseline, anomaly: m.anomaly })),
      };
    }
    case "rank_months": {
      const limit = isNum(input.limit) ? Math.min(15, Math.max(1, input.limit)) : 5;
      const asc = input.order === "lowest";
      const key = (m: (typeof a.months)[number]) => (input.by === "anomaly" ? (m.z ?? -99) : m.harmonized);
      const rows = a.months.filter((m) => !m.missing && (input.by !== "anomaly" || m.z !== null)).sort((x, y) => (asc ? key(x) - key(y) : key(y) - key(x)));
      return { area: area.name, ranked_by: input.by, rows: rows.slice(0, limit).map((m) => ({ month: ym(m.year, m.month), harmonized: m.harmonized, z: m.z, pct_vs_10yr: m.pctVsBaseline, anomaly: m.anomaly })) };
    }
    case "compare_periods": {
      const pa = input.period_a as number[];
      const pb = input.period_b as number[];
      if (!Array.isArray(pa) || !Array.isArray(pb) || pa.length !== 2 || pb.length !== 2) return { error: "period_a and period_b must be [firstYear, lastYear]" };
      const mean = (p: number[], f: (m: (typeof a.months)[number]) => number) => {
        const ms = a.months.filter((m) => !m.missing && m.year >= p[0] && m.year <= p[1] && (!isNum(input.month) || m.month === input.month));
        const years = new Set(ms.map((m) => m.year)).size || 1;
        return ms.reduce((s, m) => s + f(m), 0) / years;
      };
      const A = mean(pa, (m) => m.harmonized);
      const B = mean(pb, (m) => m.harmonized);
      const mA = mean(pa, (m) => m.modisRaw);
      const mB = mean(pb, (m) => m.modisRaw);
      return {
        area: area.name,
        scope: isNum(input.month) ? `${MONTHS[input.month - 1]} only` : "annual",
        period_a: { years: pa, mean_harmonized_fire_days: Math.round(A), mean_modis_raw: Math.round(mA) },
        period_b: { years: pb, mean_harmonized_fire_days: Math.round(B), mean_modis_raw: Math.round(mB) },
        change_pct: A > 0 ? Math.round(((B - A) / A) * 100) : null,
        modis_only_change_pct: mA > 0 ? Math.round(((mB - mA) / mA) * 100) : null,
        note: "modis_only_change_pct uses one consistent sensor and is a check that the change is not a harmonization artifact.",
      };
    }
    case "get_hotspot_trends": {
      const h = hotspotsInBBox(grid, area.bbox);
      return {
        area: area.name,
        method: "Getis-Ord Gi* (queen contiguity, 0.25° cells, hot if z ≥ 1.96) per year + Mann-Kendall trend on Gi* z",
        counts: h.counts,
        category_meaning: Object.fromEntries(Object.entries(HOTSPOT_META).map(([k, v]) => [k, v.blurb])),
        top_cells: h.ranked.slice(0, 8).map((c) => ({ lat: c.lat, lon: c.lon, category: c.category, hot_years: c.hotYears, mean_fire_days_per_year: c.meanFireDays })),
      };
    }
    case "get_season_timing": {
      const s = seasonTiming(a);
      if (!s.years.length) return { area: area.name, note: "Too little fire to time a season here." };
      const t = (x: { senSlope: number; pValue: number; significant: boolean }) => ({ days_per_year: x.senSlope, p_value: x.pValue, significant: x.significant });
      return {
        area: area.name,
        mean: { onset: s.label(s.mean.onset), peak: s.label(s.mean.peak), end: s.label(s.mean.end), length_days: s.mean.length },
        trends: { onset: t(s.trends.onset), peak: t(s.trends.peak), end: t(s.trends.end), length: t(s.trends.length) },
        first_and_last: [s.years[0], s.years[s.years.length - 1]].map((y) => ({ fire_year: y.year, onset: s.label(y.onset), peak: s.label(y.peak), end: s.label(y.end), length_days: y.length })),
        definition: "Fire-year starts the month after the quietest month; onset/peak/end = dates when 10/50/90% of that year's fire-days are reached.",
      };
    }
    case "get_outlook": {
      const n = isNum(input.months) ? Math.min(6, Math.max(1, input.months)) : 3;
      const now = new Date();
      const targets = Array.from({ length: n }, (_, i) => {
        const idx = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1 + i;
        return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
      });
      const o = outlook(a, targets);
      const h = hindcast(a);
      return {
        area: area.name,
        method: "Exponentially weighted geometric mean of past years (half-life 3 yr); no weather input",
        months: o.map((x) => ({ month: ym(x.year, x.month), expected_fire_days: x.expected, likely_range: [x.p10, x.p90], normal_10yr: x.normal, chance_above_normal: x.probAbove, signal: x.signal })),
        hindcast: { test_years: h.years, skill_vs_climatology: h.skill, mae_model: h.maeModel, mae_climatology: h.maeClim, range_coverage: h.coverage },
      };
    }
    case "get_live_fires": {
      const live = await ctx.getLive();
      if (!live) return { error: "Live feed unavailable right now." };
      const s = liveSummary(live, a, area.bbox);
      return {
        area: area.name,
        window: "last 7 days",
        feed_generated: live.generatedAt,
        detections: s.total,
        last_24h: s.last24h,
        snpp_fire_days: s.snppFireDays,
        normal_fire_days_for_7_days: s.normalFireDays,
        change_vs_normal_pct: s.change === null ? null : Math.round(s.change * 100),
        hottest_fire: s.hottest,
        per_day: s.days,
        sources: live.sources.map((x) => `${x.label}: ${x.ok ? x.count : "unavailable"}`),
      };
    }
    case "update_dashboard": {
      const action: { -readonly [K in keyof DashboardAction]: DashboardAction[K] } = {};
      if (input.region !== undefined || input.bbox !== undefined) {
        const r = resolveArea(input, ctx);
        if (r.regionId) action.regionId = r.regionId;
        else action.bbox = r.bbox;
      }
      if (yearOk(input.year)) action.year = input.year as number;
      if (input.month === null || (isNum(input.month) && input.month >= 1 && input.month <= 12)) action.month = input.month as number | null;
      if (typeof input.layer === "string" && ["activity", "anomaly", "hotspots", "outlook", "live"].includes(input.layer)) action.layer = input.layer as Layer;
      if (typeof input.tab === "string" && ["calendar", "trends", "hotspots", "outlook", "live"].includes(input.tab)) action.tab = input.tab as Tab;
      if (typeof input.view3d === "boolean") action.view3d = input.view3d;
      ctx.emit(action);
      return { ok: true, applied: action };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
