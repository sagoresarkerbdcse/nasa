/**
 * Near-real-time active fires (last 7 days) from the public NASA FIRMS feeds,
 * clipped to the study area. No API key needed. Used by the API server
 * (/api/live, cached) and by `npm run data:live` (writes public/data/live.json).
 */
import { DOMAIN } from "../src/lib/regions";
import type { LiveFile } from "../src/lib/types";

const BASE = process.env.FIRMS_ACTIVE_BASE ?? "https://firms.modaps.eosdis.nasa.gov/data/active_fire";

export const LIVE_SOURCES = [
  { id: 1, key: "snpp", label: "VIIRS · Suomi NPP", url: `${BASE}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_Asia_7d.csv` },
  { id: 2, key: "noaa20", label: "VIIRS · NOAA-20", url: `${BASE}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_7d.csv` },
  { id: 3, key: "noaa21", label: "VIIRS · NOAA-21", url: `${BASE}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_Asia_7d.csv` },
  { id: 0, key: "modis", label: "MODIS · Terra/Aqua", url: `${BASE}/modis-c6.1/csv/MODIS_C6_1_South_Asia_7d.csv` },
] as const;

function conf(raw: string, sensor: number): 0 | 1 | 2 {
  const v = raw.trim().toLowerCase();
  if (sensor === 0) {
    const n = Number(v);
    return n >= 80 ? 2 : n >= 30 ? 1 : 0;
  }
  return v.startsWith("h") ? 2 : v.startsWith("n") ? 1 : 0;
}

export async function fetchLive(timeoutMs = 20000): Promise<LiveFile> {
  const sources: LiveFile["sources"] = [];
  const detections: LiveFile["detections"] = [];
  await Promise.all(
    LIVE_SOURCES.map(async (src) => {
      try {
        const res = await fetch(src.url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const lines = text.split(/\r?\n/).filter(Boolean);
        const header = lines.shift()!.split(",").map((h) => h.trim().toLowerCase());
        const c = Object.fromEntries(header.map((h, i) => [h, i]));
        let count = 0;
        for (const line of lines) {
          const p = line.split(",");
          const lat = Number(p[c.latitude]);
          const lon = Number(p[c.longitude]);
          if (!(lon >= DOMAIN[0] && lon < DOMAIN[2] && lat >= DOMAIN[1] && lat < DOMAIN[3])) continue;
          detections.push([
            Math.round(lon * 1000) / 1000,
            Math.round(lat * 1000) / 1000,
            src.id,
            conf(p[c.confidence] ?? "", src.id),
            Math.round(Number(p[c.frp] ?? 0) * 10) / 10,
            p[c.acq_date],
            (p[c.acq_time] ?? "").padStart(4, "0"),
            (p[c.daynight] ?? "D").trim() === "N" ? 1 : 0,
          ]);
          count++;
        }
        sources.push({ key: src.key, label: src.label, ok: true, count });
      } catch (err) {
        sources.push({ key: src.key, label: src.label, ok: false, count: 0, error: (err as Error).message });
      }
    }),
  );
  detections.sort((a, b) => (a[5] + a[6]).localeCompare(b[5] + b[6]));
  return { generatedAt: new Date().toISOString(), window: "7d", sources, detections };
}
