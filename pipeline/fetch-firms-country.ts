/**
 * Downloads the public NASA FIRMS "country yearly" archives (standard-quality
 * MODIS C6.1 and VIIRS S-NPP 375 m; no API key needed), clips them to the
 * study area, and saves small CSVs under pipeline/raw/.
 *
 *   npm run data:fetch-country                 # all years
 *   npm run data:fetch-country -- 2020 2025    # a year range
 *
 * Bangladesh's border fire belts lie in India and Myanmar, so those country
 * files are streamed too and clipped on the fly. Re-runs skip files that
 * already exist. Prints the last year that had data (for the NRT top-up).
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { DOMAIN } from "../src/lib/regions";

const BASE = process.env.FIRMS_COUNTRY_BASE ?? "https://firms.modaps.eosdis.nasa.gov/data/country";
const COUNTRIES = ["Bangladesh", "India", "Myanmar"];
const SENSORS = [
  { id: "modis", first: 2001 },
  { id: "viirs-snpp", first: 2012 },
];
const [fromArg, toArg] = process.argv.slice(2).map(Number);
const FROM = fromArg || 2001;
const TO = toArg || new Date().getUTCFullYear();
const CONCURRENCY = 4;
mkdirSync("pipeline/raw", { recursive: true });

interface Job {
  sensor: string;
  year: number;
  country: string;
}
const jobs: Job[] = [];
for (let year = FROM; year <= TO; year++)
  for (const s of SENSORS) if (year >= s.first) for (const country of COUNTRIES) jobs.push({ sensor: s.id, year, country });

let lastYearWithData = 0;
const stats = { files: 0, kept: 0, missing: 0 };

async function run(job: Job) {
  const out = `pipeline/raw/${job.sensor}_${job.year}_${job.country}.csv`;
  const marker = `${out}.missing`;
  if (existsSync(out)) {
    lastYearWithData = Math.max(lastYearWithData, job.year);
    return;
  }
  if (existsSync(marker)) return;
  const url = `${BASE}/${job.sensor}/${job.year}/${job.sensor}_${job.year}_${job.country}.csv`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) {
        stats.missing++;
        // Not published yet (current year) — remember for this run only.
        if (job.year < TO) writeFileSync(marker, "");
        console.log(`  - ${job.sensor} ${job.year} ${job.country}: not available`);
        return;
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const tmp = `${out}.part`;
      const ws = createWriteStream(tmp);
      const decoder = new TextDecoder();
      let buf = "";
      let header: string[] | null = null;
      let rows = 0;
      let kept = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (!line) continue;
          if (!header) {
            header = line.split(",");
            ws.write(line + "\n");
            continue;
          }
          rows++;
          // latitude,longitude are the first two columns in FIRMS CSVs.
          const c1 = line.indexOf(",");
          const c2 = line.indexOf(",", c1 + 1);
          const lat = Number(line.slice(0, c1));
          const lon = Number(line.slice(c1 + 1, c2));
          if (lon >= DOMAIN[0] && lon < DOMAIN[2] && lat >= DOMAIN[1] && lat < DOMAIN[3]) {
            ws.write(line + "\n");
            kept++;
          }
        }
      }
      await new Promise<void>((resolve, reject) => ws.end((err?: Error | null) => (err ? reject(err) : resolve())));
      renameSync(tmp, out);
      stats.files++;
      stats.kept += kept;
      lastYearWithData = Math.max(lastYearWithData, job.year);
      console.log(`  ✓ ${job.sensor} ${job.year} ${job.country}: ${kept.toLocaleString()} / ${rows.toLocaleString()} rows in study area`);
      return;
    } catch (err) {
      const wait = 3000 * 2 ** attempt;
      console.warn(`  ! ${job.sensor} ${job.year} ${job.country}: ${(err as Error).message}; retry in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`Failed to download ${url}`);
}

console.log(`FIRMS country archives ${FROM}-${TO} for ${COUNTRIES.join(", ")} → clipped to ${DOMAIN.join(",")}`);
const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await run(job);
  }),
);
console.log(`Done: ${stats.files} new files, ${stats.kept.toLocaleString()} detections kept, ${stats.missing} not yet published.`);
console.log(`LAST_ARCHIVE_YEAR=${lastYearWithData}`);
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `last_year=${lastYearWithData}\n`, { flag: "a" });
