// Shared data contracts between the pipeline, the API server and the browser.

/** [minLon, minLat, maxLon, maxLat] in WGS84 degrees. */
export type BBox = [number, number, number, number];

export type SensorView = "harmonized" | "modis" | "viirs";

/**
 * Pre-aggregated hotspot grid written by the pipeline (public/data/grid.json).
 *
 * Each record is one grid cell × calendar month. Counts are stored as a flat
 * integer array to keep the file small; see RECORD_FIELDS for the layout.
 */
export interface GridFile {
  meta: {
    /** "sample" = synthetic demo data, "firms" = real NASA FIRMS archive. */
    source: "sample" | "firms";
    generatedAt: string;
    cellSize: number;
    /** Common fine grid (degrees) that detections are snapped to before counting fire-days. */
    fireDayGrid: number;
    bounds: BBox;
    firstYear: number;
    lastYear: number;
    /** Last month (1-12) with data in lastYear. */
    lastMonth: number;
    /** First year with VIIRS S-NPP 375 m data (2012). */
    viirsStartYear: number;
    notes: string;
  };
  /** Cell centres, [lon, lat]. Record cell indices point into this array. */
  cells: [number, number][];
  /** Flat array, RECORD_WIDTH ints per record. */
  records: number[];
  /** Fire regime from VIIRS: events (Global Fire Atlas style) and burn return intervals. Optional (older files lack it). */
  regime?: {
    fine: number[];
    events: number[];
    years: [number, number];
  };
}

export const RECORD_FIELDS = [
  "cell",
  "year",
  "month",
  "modisRaw", // all MODIS detections (any confidence)
  "viirsRaw", // all VIIRS detections (any confidence)
  "modisFD", // MODIS fire-days on the common grid, nominal+high confidence only
  "viirsFD", // VIIRS fire-days on the common grid, nominal+high confidence only
  "modisHigh", // MODIS high-confidence detections
  "viirsHigh", // VIIRS high-confidence detections
] as const;
export const RECORD_WIDTH = RECORD_FIELDS.length;

/** Sampled individual detections for map display (public/data/points.json). */
export interface PointsFile {
  /** year -> [lon, lat, sensor(0=MODIS,1=VIIRS), confidence(0=low,1=nominal,2=high), month, frpMW][] */
  byYear: Record<string, [number, number, number, number, number, number][]>;
}

export interface MonthStat {
  year: number;
  month: number; // 1-12
  modisRaw: number;
  viirsRaw: number;
  modisFD: number;
  viirsFD: number;
  /** Naive "before harmonization" series: MODIS raw until VIIRS starts, VIIRS raw after. */
  naive: number;
  /** Harmonized fire-days in VIIRS-equivalent units. */
  harmonized: number;
  /** 90% interval of the harmonized value (MODIS-only months; observed VIIRS months have none). */
  lo?: number;
  hi?: number;
  /** Harmonized Confidence Index, 0-100. */
  hci: number;
  /** VIIRS raw / MODIS raw detection ratio (null when MODIS saw nothing). */
  ratio: number | null;
  /** Baseline mean of the same calendar month over the previous 10 years. */
  baseline: number | null;
  pctVsBaseline: number | null;
  z: number | null;
  anomaly: null | "elevated" | "significant" | "extreme";
  /** True for months that have not happened yet / are outside the record. */
  missing: boolean;
}

export interface TrendResult {
  /** Sen's slope of annual harmonized totals, fire-days per year. */
  senSlope: number;
  /** Mann-Kendall two-sided p-value. */
  pValue: number;
  tau: number;
  direction: "increasing" | "decreasing" | "no trend";
  significant: boolean;
}

export interface AoiAnalysis {
  bbox: BBox;
  cellCount: number;
  /** VIIRS/MODIS fire-day calibration factor used to lift the MODIS-only era. */
  k: number;
  kSource: "aoi" | "domain";
  overlapYears: [number, number];
  months: MonthStat[]; // chronological, every month in the record
  annual: { year: number; harmonized: number; lo?: number; hi?: number; naive: number; modisRaw: number; viirsRaw: number }[];
  /** Harmonization v2 model fitted for this area (see src/lib/harmonize2.ts). */
  harmonization?: { method: "v2"; k: number[]; floor: number[]; kLo: number[]; kHi: number[]; sigma: number; trainYears: [number, number]; evidence: number };
  climatology: { month: number; mean: number; share: number }[];
  peakMonths: number[];
  trend: TrendResult;
  anomalies: MonthStat[]; // significant/extreme months, largest excess fire-days first
  totals: { naive: number; harmonized: number; modisRaw: number; viirsRaw: number };
}

export interface Region {
  id: string;
  name: string;
  short: string;
  bbox: BBox;
  blurb: string;
}

/** Last-7-days FIRMS active fires (public/data/live.json and /api/live). */
export interface LiveFile {
  generatedAt: string;
  window: "7d";
  sources: { key: string; label: string; ok: boolean; count: number; error?: string }[];
  /** [lon, lat, sensor(0 MODIS,1 SNPP,2 NOAA-20,3 NOAA-21), conf(0-2), frpMW, "YYYY-MM-DD", "HHMM" UTC, night(0/1)] */
  detections: [number, number, number, number, number, string, string, number][];
}

export type MapLayer = "activity" | "anomaly" | "hotspots" | "outlook" | "live";
export type InsightTab = "calendar" | "trends" | "hotspots" | "outlook" | "live" | "science";
