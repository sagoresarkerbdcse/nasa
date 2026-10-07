/**
 * Snapshot the last 7 days of FIRMS active fires into public/data/live.json.
 *
 *   npm run data:live
 */
import { writeFileSync } from "node:fs";
import { fetchLive } from "./live";

const live = await fetchLive();
const ok = live.sources.filter((s) => s.ok);
for (const s of live.sources) console.log(`${s.ok ? "✓" : "✗"} ${s.label}: ${s.ok ? `${s.count} detections in study area` : s.error}`);
if (!ok.length) {
  console.error("No FIRMS live source reachable; keeping the previous live.json.");
  process.exit(1);
}
writeFileSync("public/data/live.json", JSON.stringify(live));
console.log(`live.json: ${live.detections.length} detections, ${live.detections[0]?.[5] ?? "-"} → ${live.detections.at(-1)?.[5] ?? "-"}`);
