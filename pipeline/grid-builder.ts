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
  /** VIIRS fire-days as [gx, gy, absoluteDay] triplets, for event and return-interval analysis. */
  private viirsFD: number[] = [];
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
        if (d.sensor === 1) this.viirsFD.push(gx, gy, Math.floor(Date.UTC(d.year, d.month - 1, d.day) / 86400000));
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

  /**
   * Fire regime from VIIRS fire-days (consistent 375 m sensor, complete years only):
   *  - events: fire-days linked when they touch in space (8-neighbour, 0.01°) and
   *    time (±1 day), following the Global Fire Atlas idea of tracking individual fires;
   *  - burn return interval: years between burns of the same ~1 km cell.
   */
  private fireRegime(used: Map<number, number>): FireRegimeExtras {
    const { bounds, cellSize, fireDayGrid, viirsStartYear } = this.o;
    const fd = this.viirsFD;
    const n = fd.length / 3;
    const lastFull = this.lastYM % 12 === 11 ? this.o.firstYear + Math.floor(this.lastYM / 12) : this.o.firstYear + Math.floor(this.lastYM / 12) - 1;
    const yearOf = (day: number) => new Date(day * 86400000).getUTCFullYear();
    const cellOf = (gx: number, gy: number) => {
      const raw = Math.floor((gy * fireDayGrid) / cellSize) * this.nx + Math.floor((gx * fireDayGrid) / cellSize);
      return used.get(raw);
    };

    // Union-find over fire-days.
    const parent = new Int32Array(n).map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const index = new Map<number, number>();
    const key = (gx: number, gy: number, day: number) => (day * this.fy + gy) * this.fx + gx;
    for (let i = 0; i < n; i++) index.set(key(fd[3 * i], fd[3 * i + 1], fd[3 * i + 2]), i);
    for (let i = 0; i < n; i++) {
      const gx = fd[3 * i];
      const gy = fd[3 * i + 1];
      const day = fd[3 * i + 2];
      for (const dd of [-1, 0])
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            if (dd === 0 && (dy < 0 || (dy === 0 && dx <= 0))) continue; // each same-day pair once
            const j = index.get(key(gx + dx, gy + dy, day + dd));
            if (j !== undefined) {
              const a = find(i);
              const b = find(j);
              if (a !== b) parent[a] = b;
            }
          }
    }
    const comp = new Map<number, { cells: Set<number>; d0: number; d1: number; sx: number; sy: number; m: number }>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let c = comp.get(r);
      if (!c) comp.set(r, (c = { cells: new Set(), d0: Infinity, d1: -Infinity, sx: 0, sy: 0, m: 0 }));
      c.cells.add(fd[3 * i + 1] * this.fx + fd[3 * i]);
      c.d0 = Math.min(c.d0, fd[3 * i + 2]);
      c.d1 = Math.max(c.d1, fd[3 * i + 2]);
      c.sx += fd[3 * i];
      c.sy += fd[3 * i + 1];
      c.m++;
    }
    const ev = new Map<string, number[]>();
    for (const c of comp.values()) {
      const y = yearOf(c.d0);
      if (y < viirsStartYear || y > lastFull) continue;
      const cell = cellOf(Math.round(c.sx / c.m), Math.round(c.sy / c.m));
      if (cell === undefined) continue;
      const k = `${cell}|${y}`;
      const area = c.cells.size;
      const e = ev.get(k) ?? [cell, y, 0, 0, 0, 0, 0];
      e[2] += 1;
      e[3] += area;
      e[4] = Math.max(e[4], area);
      e[5] += c.d1 - c.d0 + 1;
      e[6] += area >= 10 ? 1 : 0;
      ev.set(k, e);
    }

    // Return interval per ~1 km cell (years burned, complete VIIRS years).
    const yearsBurned = new Map<number, Set<number>>();
    for (let i = 0; i < n; i++) {
      const y = yearOf(fd[3 * i + 2]);
      if (y < viirsStartYear || y > lastFull) continue;
      const fine = fd[3 * i + 1] * this.fx + fd[3 * i];
      let set = yearsBurned.get(fine);
      if (!set) yearsBurned.set(fine, (set = new Set()));
      set.add(y);
    }
    const fineAgg = new Map<number, number[]>();
    for (const [fine, ys] of yearsBurned) {
      const cell = cellOf(fine % this.fx, Math.floor(fine / this.fx));
      if (cell === undefined) continue;
      const a = fineAgg.get(cell) ?? [cell, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      a[1] += 1;
      if (ys.size >= 2) {
        a[2] += 1;
        const sorted = [...ys].sort((x, y) => x - y);
        for (let t = 1; t < sorted.length; t++) {
          const gap = sorted[t] - sorted[t - 1];
          a[3 + INTERVAL_BINS.findIndex((b) => gap <= b)] += 1;
        }
      }
      fineAgg.set(cell, a);
    }
    void bounds;
    return { fine: [...fineAgg.values()].flat(), events: [...ev.values()].flat(), years: [viirsStartYear, lastFull] };
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
    grid.regime = this.fireRegime(used);
    const points: PointsFile = { byYear: {} };
    for (const [y, r] of [...this.reservoirs.entries()].sort((a, b) => a[0] - b[0])) points.byYear[y] = r.pts;
    mkdirSync(dirname(gridPath), { recursive: true });
    writeFileSync(gridPath, JSON.stringify(grid));
    writeFileSync(pointsPath, JSON.stringify(points));
    return { cells: cells.length, records: records.length / RECORD_WIDTH, lastYear: grid.meta.lastYear, lastMonth: grid.meta.lastMonth };
  }
}

export const INTERVAL_BINS = [1, 2, 3, 4, 5, 8, Infinity]; // years: 1,2,3,4,5,6-8,9+

export interface FireRegimeExtras {
  /** per 0.25° cell: [cell, burnedFineCells, reburnedFineCells, ...interval histogram (7 bins)] */
  fine: number[];
  /** per 0.25° cell × year (by event centroid): [cell, year, events, sumAreaCells, maxAreaCells, sumDurationDays, bigEvents(≥10 cells)] */
  events: number[];
  years: [number, number];
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
