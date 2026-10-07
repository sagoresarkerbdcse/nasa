/**
 * Generates a deterministic SYNTHETIC hotspot record so the app runs offline
 * without a FIRMS key. It simulates fire events (location, day, duration) and
 * then simulates how each sensor would observe them:
 *
 *   MODIS 1 km  — Terra only until mid-2002, then Terra+Aqua; lower detection
 *                 probability, ~1 pixel per fire.
 *   VIIRS 375 m — from 2012-01-20; higher detection probability and several
 *                 pixels per fire.
 *
 * Seasonality follows well-known regional burning patterns (jhum burning in
 * the hills in March-April, crop-residue burning in West Bengal in Oct-Nov
 * and Apr-May, dry-season mangrove fires in the eastern Sundarbans), but the
 * yearly numbers and anomaly events are invented for the demo. Replace with
 * real data via `npm run data:ingest` before drawing conclusions.
 *
 *   npm run data:sample
 */
import { DOMAIN } from "../src/lib/regions";
import { GridBuilder, mulberry32, type Detection } from "./grid-builder";

const SEED = 20261004;
const rand = mulberry32(SEED);
const FIRST_YEAR = 2001;
const LAST_YEAR = 2026;
const LAST_MONTH = 9; // data through September 2026

const JHUM = [0.05, 0.12, 0.38, 0.3, 0.08, 0.01, 0, 0, 0, 0.01, 0.02, 0.03];
const HILL_NE = [0.08, 0.2, 0.4, 0.2, 0.04, 0, 0, 0, 0, 0.01, 0.03, 0.04];
const HAOR = [0.2, 0.25, 0.25, 0.1, 0.02, 0, 0, 0, 0, 0.01, 0.02, 0.15];
const CROP = [0.02, 0.02, 0.05, 0.2, 0.15, 0.02, 0, 0, 0.02, 0.18, 0.3, 0.04];
const MANGROVE = [0.02, 0.1, 0.3, 0.33, 0.22, 0.02, 0, 0, 0, 0, 0, 0.01];
const DIFFUSE = [0.12, 0.15, 0.2, 0.17, 0.08, 0.03, 0.02, 0.02, 0.03, 0.06, 0.07, 0.05];

interface Cluster {
  id: string;
  lon: number;
  lat: number;
  sdLon: number;
  sdLat: number;
  eventsPerYear: number;
  season: number[];
  trend: number; // fractional change per year
  diffuse?: boolean;
}

const CLUSTERS: Cluster[] = [
  { id: "mizoram", lon: 92.55, lat: 23.3, sdLon: 0.18, sdLat: 0.5, eventsPerYear: 2400, season: JHUM, trend: -0.01 },
  { id: "cht", lon: 92.15, lat: 22.55, sdLon: 0.22, sdLat: 0.45, eventsPerYear: 1500, season: JHUM, trend: -0.015 },
  { id: "tripura", lon: 91.7, lat: 23.75, sdLon: 0.2, sdLat: 0.3, eventsPerYear: 650, season: JHUM, trend: 0 },
  { id: "meghalaya", lon: 91.4, lat: 25.45, sdLon: 0.55, sdLat: 0.14, eventsPerYear: 1100, season: HILL_NE, trend: 0.005 },
  { id: "sylhet", lon: 91.55, lat: 24.6, sdLon: 0.35, sdLat: 0.22, eventsPerYear: 170, season: HAOR, trend: 0.03 },
  { id: "wb-crop", lon: 88.5, lat: 23.4, sdLon: 0.3, sdLat: 0.6, eventsPerYear: 850, season: CROP, trend: 0.04 },
  { id: "bd-crop", lon: 89.2, lat: 24.2, sdLon: 0.4, sdLat: 0.4, eventsPerYear: 260, season: CROP, trend: 0.035 },
  { id: "rakhine", lon: 92.5, lat: 21.0, sdLon: 0.18, sdLat: 0.35, eventsPerYear: 900, season: JHUM, trend: 0 },
  { id: "sundarbans", lon: 89.78, lat: 22.12, sdLon: 0.08, sdLat: 0.1, eventsPerYear: 16, season: MANGROVE, trend: 0.01 },
  { id: "diffuse", lon: 0, lat: 0, sdLon: 0, sdLat: 0, eventsPerYear: 380, season: DIFFUSE, trend: 0.01, diffuse: true },
];

const HILLS = ["mizoram", "cht", "tripura", "meghalaya", "rakhine"];
/** Invented anomaly events: [cluster ids, year, month, multiplier]. */
const EVENTS: [string[], number, number, number][] = [
  [HILLS, 2010, 3, 1.8],
  [HILLS, 2016, 3, 2.2],
  [HILLS, 2016, 4, 1.9],
  [["meghalaya"], 2019, 4, 2.4],
  [["mizoram", "cht", "tripura"], 2021, 3, 2.4],
  [["sylhet"], 2014, 2, 3.2],
  [["sylhet"], 2023, 3, 2.6],
  [["sundarbans"], 2023, 3, 7],
  [["sundarbans"], 2023, 4, 3.5],
  [["sundarbans"], 2024, 5, 6],
  [["wb-crop", "bd-crop"], 2018, 11, 2.1],
  [["wb-crop", "bd-crop"], 2025, 4, 1.9],
];

// Rough Bay of Bengal outline so synthetic fires stay on land.
const SEA: [number, number][] = [
  [88.0, 20.5], [88.0, 21.55], [88.6, 21.58], [89.0, 21.62], [89.95, 21.75], [90.3, 21.95], [90.6, 22.15],
  [91.0, 22.35], [91.45, 22.45], [91.8, 22.2], [91.92, 21.7], [92.02, 21.2], [92.2, 20.7], [92.3, 20.5],
];

function inSea(lon: number, lat: number) {
  let inside = false;
  for (let i = 0, j = SEA.length - 1; i < SEA.length; j = i++) {
    const [xi, yi] = SEA[i];
    const [xj, yj] = SEA[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function gauss() {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function poisson(lambda: number) {
  if (lambda <= 0) return 0;
  if (lambda > 40) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const builder = new GridBuilder({
  bounds: DOMAIN,
  cellSize: 0.25,
  fireDayGrid: 0.01,
  firstYear: FIRST_YEAR,
  viirsStartYear: 2012,
  pointsPerYear: 900,
  seed: SEED,
});

// Shared climate factor per year (dry vs wet years) + per-cluster noise.
const climate = new Map<number, number>();
for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) climate.set(y, Math.exp(0.12 * gauss()));

for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
  for (const c of CLUSTERS) {
    const yearNoise = Math.exp(0.16 * gauss());
    const trend = Math.max(0.2, 1 + c.trend * (y - 2013));
    for (let m = 1; m <= 12; m++) {
      if (y === LAST_YEAR && m > LAST_MONTH) break;
      let mult = 1;
      for (const [ids, ey, em, f] of EVENTS) if (ids.includes(c.id) && ey === y && em === m) mult *= f;
      const lambda = c.eventsPerYear * c.season[m - 1] * climate.get(y)! * yearNoise * trend * mult * Math.exp(0.12 * gauss());
      const n = poisson(lambda);
      for (let e = 0; e < n; e++) simulateEvent(c, y, m);
    }
  }
}

function simulateEvent(c: Cluster, y: number, m: number) {
  let lon = 0;
  let lat = 0;
  for (let tries = 0; tries < 20; tries++) {
    if (c.diffuse) {
      lon = DOMAIN[0] + rand() * (DOMAIN[2] - DOMAIN[0]);
      lat = DOMAIN[1] + rand() * (DOMAIN[3] - DOMAIN[1]);
    } else {
      lon = c.lon + c.sdLon * gauss();
      lat = c.lat + c.sdLat * gauss();
    }
    if (!inSea(lon, lat)) break;
  }
  if (inSea(lon, lat)) return;
  const dim = daysIn(y, m);
  const start = 1 + Math.floor(rand() * dim);
  let duration = 1;
  while (rand() < 0.42 && duration < 6) duration++;
  const intensity = Math.exp(1.2 * gauss()); // relative fire size/brightness

  for (let d = 0; d < duration; d++) {
    const day = start + d;
    if (day > dim) break;
    // MODIS: Terra since 2000, Aqua from July 2002.
    const aqua = y > 2002 || (y === 2002 && m >= 7);
    const pModis = Math.min(0.95, (aqua ? 0.42 : 0.26) * (0.6 + 0.4 * Math.min(2, intensity)));
    if (rand() < pModis) {
      const px = 1 + (rand() < 0.22 ? 1 : 0);
      for (let p = 0; p < px; p++) emit(lon, lat, 0.004, y, m, day, 0, intensity);
    }
    const viirsOn = y > 2012 || (y === 2012 && (m > 1 || day >= 20));
    if (viirsOn) {
      const pViirs = Math.min(0.97, 0.72 * (0.75 + 0.25 * Math.min(2, intensity)));
      if (rand() < pViirs) {
        const px = 1 + poisson(1.6 + 0.8 * Math.min(3, intensity));
        for (let p = 0; p < px; p++) emit(lon, lat, 0.0018, y, m, day, 1, intensity);
      }
    }
  }
}

function emit(lon: number, lat: number, jitter: number, y: number, m: number, day: number, sensor: 0 | 1, intensity: number) {
  const r = rand();
  const high = sensor === 0 ? 0.18 + 0.15 * Math.min(1, intensity / 2) : 0.08 + 0.12 * Math.min(1, intensity / 2);
  const low = sensor === 0 ? 0.2 : 0.1;
  const conf: 0 | 1 | 2 = r < low ? 0 : r < 1 - high ? 1 : 2;
  const frp = (sensor === 0 ? 14 : 4.5) * intensity * Math.exp(0.4 * gauss());
  const det: Detection = {
    lon: lon + jitter * gauss(),
    lat: lat + jitter * gauss(),
    year: y,
    month: m,
    day,
    sensor,
    conf,
    frp,
  };
  builder.add(det);
}

const out = builder.write(
  "public/data/grid.json",
  "public/data/points.json",
  "sample",
  "SYNTHETIC demo data generated by pipeline/generate-sample.ts. Seasonal patterns are realistic; yearly values and anomalies are invented. Run the FIRMS pipeline for real data.",
);
console.log(`sample: ${builder.count.toLocaleString()} detections → ${out.cells} cells, ${out.records} cell-months, through ${out.lastYear}-${out.lastMonth}`);
