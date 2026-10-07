/**
 * Downloads NOAA CPC's Oceanic Niño Index (ONI, 3-month running mean SST
 * anomaly in Niño 3.4) and writes public/data/oni.json as { "YYYY-MM": value },
 * keyed by the centre month of each 3-month season (DJF → Jan, …, NDJ → Dec).
 *
 *   npm run data:oni
 */
import { writeFileSync } from "node:fs";

const URL = process.env.ONI_URL ?? "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt";
const SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"];

const res = await fetch(URL, { signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error(`ONI download failed: HTTP ${res.status}`);
const text = await res.text();
const values: Record<string, number> = {};
for (const line of text.split(/\r?\n/)) {
  const [seas, yr, , anom] = line.trim().split(/\s+/);
  const m = SEASONS.indexOf(seas);
  if (m < 0 || !Number(yr) || anom === undefined || !Number.isFinite(Number(anom))) continue;
  values[`${yr}-${String(m + 1).padStart(2, "0")}`] = Number(anom);
}
const keys = Object.keys(values).sort();
if (keys.length < 100) throw new Error(`ONI parse produced only ${keys.length} values`);
writeFileSync("public/data/oni.json", JSON.stringify({ source: "NOAA CPC Oceanic Niño Index (ERSSTv5), oni.ascii.txt", fetched: new Date().toISOString(), values }));
console.log(`oni.json: ${keys.length} months, ${keys[0]} → ${keys[keys.length - 1]}`);
