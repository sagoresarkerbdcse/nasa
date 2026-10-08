/**
 * MODIS detection probability from same-overpass VIIRS/Aqua matchups.
 *
 * Input: the matchup table built by pipeline/global-year.ts — for every co-observed
 * VIIRS fire object, binned by latitude band, day/night, VIIRS fire radiative power
 * (FRP) and the size of the MODIS pixel at that spot, how many there were and how
 * many Aqua MODIS also detected.
 *
 * Model (binomial logistic regression, IRLS):
 *   logit P(MODIS detects) = b0 + b1·log2 FRP + b2·ln(pixel area) + b3·night
 *                            + b4·log2 FRP × ln(pixel area) + latitude-band offsets
 * Headline numbers: FRP50, the fire power at which MODIS detects half of the fires
 * VIIRS sees, at nadir and at the swath edge, by day and by night.
 */

export const LAT_BANDS = [-23.5, 0, 23.5, 50];
export const LAT_BAND_LABELS = ["S extratropics", "S tropics", "N tropics", "N mid-latitudes", "Boreal"];
export const FRP_EDGES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];
export const PIX_EDGES = [1.5, 2.5, 4, 7];
export const PIX_LABELS = ["<1.5 km² (nadir)", "1.5–2.5", "2.5–4", "4–7", ">7 km² (swath edge)"];
const NB = LAT_BANDS.length + 1;
const NFRP = FRP_EDGES.length + 1;
const NPIX = PIX_EDGES.length + 1;

const frpMid = (i: number) => (i === 0 ? 0.7 : i === NFRP - 1 ? FRP_EDGES[NFRP - 2] * 1.41 : Math.sqrt(FRP_EDGES[i - 1] * FRP_EDGES[i]));
const pixMid = [1.2, 1.95, 3.2, 5.3, 8.5];
export const idx = (band: number, night: number, f: number, p: number) => ((band * 2 + night) * NFRP + f) * NPIX + p;

export interface DetectionModel {
  coef: { name: string; value: number; se: number }[];
  nObjects: number;
  nDetected: number;
  /** empirical detection rate per FRP bin, for nadir / edge pixels, day / night */
  curves: { label: string; night: boolean; pix: number; points: { frp: number; p: number; n: number; fit: number }[] }[];
  frp50: { night: boolean; pix: string; mw: number }[];
  /** overall share of co-observed VIIRS fire objects that MODIS also detected */
  overall: number;
  /** by latitude band */
  byBand: { band: string; objects: number; detected: number; p: number }[];
  /** deviance-based pseudo R² (McFadden) */
  pseudoR2: number;
  dtHistogram: number[];
}

function features(band: number, night: number, f: number, p: number) {
  const x1 = Math.log2(frpMid(f));
  const x2 = Math.log(pixMid[p]);
  const row = [1, x1, x2, night, x1 * x2];
  for (let b = 1; b < NB; b++) row.push(band === b ? 1 : 0);
  return row;
}
export const COEF_NAMES = ["intercept", "log2 FRP", "ln pixel area", "night", "log2 FRP × ln pixel area", ...LAT_BAND_LABELS.slice(1).map((l) => `band: ${l}`)];

function solve(A: number[][], b: number[]) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let mx = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[mx][i])) mx = r;
    [M[i], M[mx]] = [M[mx], M[i]];
    const d = M[i][i] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / d;
      for (let k = i; k <= n; k++) M[r][k] -= f * M[i][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

function invert(A: number[][]) {
  const n = A.length;
  return Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (_, i) => (i === j ? 1 : 0))));
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Fit the detection model to a summed matchup table (MATCH_CELLS × [coObserved, detected]). */
export function fitDetection(table: number[], dtHistogram: number[] = []): DetectionModel {
  const rows: { x: number[]; n: number; d: number }[] = [];
  for (let band = 0; band < NB; band++)
    for (let night = 0; night < 2; night++)
      for (let f = 0; f < NFRP; f++)
        for (let p = 0; p < NPIX; p++) {
          const i = idx(band, night, f, p);
          const n = table[i * 2] ?? 0;
          if (n > 0) rows.push({ x: features(band, night, f, p), n, d: table[i * 2 + 1] ?? 0 });
        }
  const k = COEF_NAMES.length;
  let beta = new Array(k).fill(0);
  let info: number[][] = [];
  for (let it = 0; it < 30; it++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    const g = new Array(k).fill(0);
    for (const r of rows) {
      const mu = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(r.x.reduce((s, v, j) => s + v * beta[j], 0))));
      const w = r.n * mu * (1 - mu);
      for (let a = 0; a < k; a++) {
        g[a] += r.x[a] * (r.d - r.n * mu);
        for (let b = 0; b < k; b++) H[a][b] += w * r.x[a] * r.x[b];
      }
    }
    for (let a = 0; a < k; a++) H[a][a] += 1e-8;
    const step = solve(H, g);
    beta = beta.map((v, j) => v + step[j]);
    info = H;
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  const cov = invert(info);
  const predictP = (band: number, night: number, f: number, p: number) => sigmoid(features(band, night, f, p).reduce((s, v, j) => s + v * beta[j], 0));

  // Deviance vs the intercept-only model.
  let nObjects = 0;
  let nDetected = 0;
  for (const r of rows) {
    nObjects += r.n;
    nDetected += r.d;
  }
  const p0 = nDetected / Math.max(nObjects, 1);
  let ll = 0;
  let ll0 = 0;
  for (const r of rows) {
    const mu = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(r.x.reduce((s, v, j) => s + v * beta[j], 0))));
    ll += r.d * Math.log(mu) + (r.n - r.d) * Math.log(1 - mu);
    ll0 += r.d * Math.log(Math.max(p0, 1e-9)) + (r.n - r.d) * Math.log(Math.max(1 - p0, 1e-9));
  }

  // Empirical curves (all latitude bands pooled) with the fitted curve (N tropics offset).
  const curves: DetectionModel["curves"] = [];
  for (const night of [0, 1])
    for (const p of [0, NPIX - 1]) {
      const points = [];
      for (let f = 0; f < NFRP; f++) {
        let n = 0;
        let d = 0;
        let fitW = 0;
        for (let band = 0; band < NB; band++) {
          const i = idx(band, night, f, p);
          n += table[i * 2] ?? 0;
          d += table[i * 2 + 1] ?? 0;
          fitW += (table[i * 2] ?? 0) * predictP(band, night, f, p);
        }
        if (n >= 30) points.push({ frp: Math.round(frpMid(f) * 10) / 10, p: Math.round((d / n) * 1000) / 1000, n, fit: Math.round((fitW / n) * 1000) / 1000 });
      }
      curves.push({ label: `${night ? "Night" : "Day"} · ${p === 0 ? "nadir pixels" : "swath-edge pixels"}`, night: Boolean(night), pix: p, points });
    }

  // FRP50 for the most common band (N tropics = 2), nadir vs edge, day vs night.
  const frp50: DetectionModel["frp50"] = [];
  for (const night of [0, 1])
    for (const p of [0, NPIX - 1]) {
      const x2 = Math.log(pixMid[p]);
      // b0 + b1 x1 + b2 x2 + b3 night + b4 x1 x2 + band2 = 0  →  x1 = -(b0 + b2 x2 + b3 night + band) / (b1 + b4 x2)
      const bandOff = beta[5 + 1]; // band index 2 → dummy position 5 + (2 - 1)
      const x1 = -(beta[0] + beta[2] * x2 + beta[3] * night + bandOff) / (beta[1] + beta[4] * x2);
      frp50.push({ night: Boolean(night), pix: PIX_LABELS[p], mw: Math.round(2 ** x1 * 10) / 10 });
    }

  const byBand = LAT_BAND_LABELS.map((band, b) => {
    let n = 0;
    let d = 0;
    for (let night = 0; night < 2; night++)
      for (let f = 0; f < NFRP; f++)
        for (let p = 0; p < NPIX; p++) {
          const i = idx(b, night, f, p);
          n += table[i * 2] ?? 0;
          d += table[i * 2 + 1] ?? 0;
        }
    return { band, objects: n, detected: d, p: n ? Math.round((d / n) * 1000) / 1000 : 0 };
  });

  return {
    coef: COEF_NAMES.map((name, j) => ({ name, value: Math.round(beta[j] * 1000) / 1000, se: Math.round(Math.sqrt(Math.max(cov[j][j], 0)) * 1000) / 1000 })),
    nObjects,
    nDetected,
    curves,
    frp50,
    overall: Math.round(p0 * 1000) / 1000,
    byBand,
    pseudoR2: Math.round((1 - ll / ll0) * 1000) / 1000,
    dtHistogram,
  };
}
