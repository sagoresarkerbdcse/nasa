/**
 * Turns individual MODIS / VIIRS detections into the compact grid + point
 * files the app reads. Shared by the sample generator and the FIRMS ingester,
 * so harmonization steps 1-2 (confidence filter + common-grid fire-days) are
 * identical for synthetic and real data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RECORD_WIDTH, type BBox, type GridFile, type PointsFile } from "../src/lib/types";

export interface Detection {
  lon: number;
  lat: number;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  sensor: 0 | 1; // 0 = MODIS, 1 = VIIRS
  conf: 0 | 1 | 2; // low / nominal / high
  frp: number;
}

export interface BuilderOptions {
  bounds: BBox;
  cellSize: number; // aggregation grid (degrees)
  fireDayGrid: number; // common fine grid for fire-day counting (degrees)
  firstYear: number;
  viirsStartYear: number;
  pointsPerYear: number;
  seed?: number;
}

export class GridBuilder {
  private acc = new Map<number, number[]>(); // key -> RECORD_WIDTH counts
  private fireDays: [Set<number>, Set<number>] = [new Set(), new Set()];
  private reservoirs = new Map<number, { seen: number; pts: PointsFile["byYear"][string] }>();
  private nx: number;
  private fx: number;
  private fy: number;
  private lastYM = 0;
  private rand: () => number;
  count = 0;

  constructor(private o: BuilderOptions) {
    this.nx = Math.ceil((o.bounds[2] - o.bounds[0]) / o.cellSize);
    this.fx = Math.ceil((o.bounds[2] - o.bounds[0]) / o.fireDayGrid) + 1;
    this.fy = Math.ceil((o.bounds[3] - o.bounds[1]) / o.fireDayGrid) + 1;
    this.rand = mulberry32(o.seed ?? 7);
  }

  add(d: Detection) {
    const { bounds, cellSize, fireDayGrid, firstYear } = this.o;
    if (d.lon < bounds[0] || d.lon >= bounds[2] || d.lat < bounds[1] || d.lat >= bounds[3]) return;
    if (d.year < firstYear) return;
    this.count++;
    const cx = Math.floor((d.lon - bounds[0]) / cellSize);
    const cy = Math.floor((d.lat - bounds[1]) / cellSize);
    const cell = cy * this.nx + cx;
    const ym = (d.year - firstYear) * 12 + (d.month - 1);
    const key = cell * 10000 + ym;
    let rec = this.acc.get(key);
    if (!rec) {
      rec = [cell, d.year, d.month, 0, 0, 0, 0, 0, 0];
      this.acc.set(key, rec);
    }
    rec[3 + d.sensor] += 1; // raw
    if (d.conf === 2) rec[7 + d.sensor] += 1; // high confidence
    if (d.conf >= 1) {
      // Fire-day: unique (fine cell, day) per sensor, nominal+high confidence only.
      const gx = Math.floor((d.lon - bounds[0]) / fireDayGrid);
      const gy = Math.floor((d.lat - bounds[1]) / fireDayGrid);
      const dayIdx = ym * 31 + (d.day - 1);
      const fdKey = (dayIdx * this.fy + gy) * this.fx + gx;
      const set = this.fireDays[d.sensor];
      if (!set.has(fdKey)) {
        set.add(fdKey);
        rec[5 + d.sensor] += 1;
      }
    }
    if (ym > this.lastYM) this.lastYM = ym;

    // Reservoir-sample points per year for the map layer.
    let r = this.reservoirs.get(d.year);
    if (!r) this.reservoirs.set(d.year, (r = { seen: 0, pts: [] }));
    r.seen++;
    const pt: [number, number, number, number, number, number] = [
      round(d.lon, 3), round(d.lat, 3), d.sensor, d.conf, d.month, round(d.frp, 1),
    ];
    if (r.pts.length < this.o.pointsPerYear) r.pts.push(pt);
    else {
      const j = Math.floor(this.rand() * r.seen);
      if (j < this.o.pointsPerYear) r.pts[j] = pt;
    }
  }

  write(gridPath: string, pointsPath: string, source: GridFile["meta"]["source"], notes: string) {
    const { bounds, cellSize, firstYear } = this.o;
    const cells: [number, number][] = [];
    const used = new Map<number, number>();
    const records: number[] = [];
    const keys = [...this.acc.keys()].sort((a, b) => a - b);
    for (const k of keys) {
      const rec = this.acc.get(k)!;
      let idx = used.get(rec[0]);
      if (idx === undefined) {
        const cx = rec[0] % this.nx;
        const cy = Math.floor(rec[0] / this.nx);
        idx = cells.length;
        cells.push([round(bounds[0] + (cx + 0.5) * cellSize, 3), round(bounds[1] + (cy + 0.5) * cellSize, 3)]);
        used.set(rec[0], idx);
      }
      records.push(idx, ...rec.slice(1));
    }
    if (records.length % RECORD_WIDTH !== 0) throw new Error("record width mismatch");
    const grid: GridFile = {
      meta: {
        source,
        generatedAt: new Date().toISOString(),
        cellSize,
        fireDayGrid: this.o.fireDayGrid,
        bounds,
        firstYear,
        lastYear: firstYear + Math.floor(this.lastYM / 12),
        lastMonth: (this.lastYM % 12) + 1,
        viirsStartYear: this.o.viirsStartYear,
        notes,
      },
      cells,
      records,
    };
    const points: PointsFile = { byYear: {} };
    for (const [y, r] of [...this.reservoirs.entries()].sort((a, b) => a[0] - b[0])) points.byYear[y] = r.pts;
    mkdirSync(dirname(gridPath), { recursive: true });
    writeFileSync(gridPath, JSON.stringify(grid));
    writeFileSync(pointsPath, JSON.stringify(points));
    return { cells: cells.length, records: records.length / RECORD_WIDTH, lastYear: grid.meta.lastYear, lastMonth: grid.meta.lastMonth };
  }
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
