/**
 * Downloads FIRMS hotspots for the study area through the FIRMS Area API in
 * 10-day chunks and saves them under pipeline/raw/. Re-running skips chunks
 * that already exist, so an interrupted download can resume.
 *
 *   FIRMS_MAP_KEY=xxxx npm run data:fetch -- 2001-01-01 2026-09-30
 *
 * Get a free MAP_KEY at https://firms.modaps.eosdis.nasa.gov/api/map_key/.
 * For the full 25-year archive the FIRMS Archive Download tool is faster;
 * this script is best for topping up recent months.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DOMAIN } from "../src/lib/regions";

const KEY = process.env.FIRMS_MAP_KEY;
if (!KEY) {
  console.error("Set FIRMS_MAP_KEY (free at https://firms.modaps.eosdis.nasa.gov/api/map_key/).");
  process.exit(1);
}
const [from = "2024-01-01", to = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
const CHUNK_DAYS = 10;
const area = DOMAIN.join(",");
mkdirSync("pipeline/raw", { recursive: true });

// Standard-processing archives (SP) lag a few months; NRT covers the rest.
const sources = (date: Date) => {
  const recent = Date.now() - date.getTime() < 1000 * 60 * 60 * 24 * 90;
  const list = [recent ? "MODIS_NRT" : "MODIS_SP"];
  if (date >= new Date("2012-01-20")) list.push(recent ? "VIIRS_SNPP_NRT" : "VIIRS_SNPP_SP");
  return list;
};

for (let d = new Date(from); d <= new Date(to); d.setUTCDate(d.getUTCDate() + CHUNK_DAYS)) {
  const day = d.toISOString().slice(0, 10);
  for (const src of sources(d)) {
    const file = `pipeline/raw/${src}_${day}.csv`;
    if (existsSync(file)) continue;
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/${src}/${area}/${CHUNK_DAYS}/${day}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        if (body.startsWith("Invalid") || body.includes("Exceeding")) throw new Error(body.slice(0, 120));
        writeFileSync(file, body);
        console.log(`${src} ${day}: ${body.split("\n").length - 2} rows`);
        break;
      } catch (err) {
        const wait = 2000 * 2 ** attempt;
        console.warn(`${src} ${day}: ${(err as Error).message}; retrying in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    await new Promise((r) => setTimeout(r, 250)); // stay well under the 5000 req / 10 min limit
  }
}
console.log("Done. Now run: npm run data:ingest");
