// Thermal ramp: deep ember → red → orange → solar → pale yellow.
const STOPS: [number, [number, number, number]][] = [
  [0, [45, 20, 25]],
  [0.2, [127, 29, 29]],
  [0.45, [239, 68, 68]],
  [0.68, [249, 115, 22]],
  [0.86, [245, 158, 11]],
  [1, [254, 240, 138]],
];

export function heat(t: number, alpha = 1): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (x <= p1) {
      const f = (x - p0) / (p1 - p0);
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
      return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
    }
  }
  return `rgba(254,240,138,${alpha})`;
}

/** Power scale (γ 0.45): low months stay visible without washing out the peaks. */
export function powScale(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0;
  return Math.min(1, (v / max) ** 0.45);
}

export const fmt = (v: number) =>
  v >= 10000 ? `${(v / 1000).toFixed(1)}k` : v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "");
