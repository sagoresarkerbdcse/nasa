# 🔥 FireCal AI

**NASA Space Apps Challenge 2026: Harmonization of MODIS and VIIRS Hot Spots**

FireCal AI turns 25 years of satellite fire detections into one **consistent burning-activity calendar** for any area of interest. It also includes an **AI analyst** that explains peak seasons and anomalies and writes early-warning briefs for responders.

Focus area: Bangladesh and its border fire belts (Sylhet, the Sundarbans, the Chittagong Hill Tracts, Tripura, Mizoram, Meghalaya, West Bengal and Rakhine).

## The problem

MODIS (1 km, 2000→) and VIIRS (375 m, 2012→) both detect active fires, but you cannot compare their counts directly. VIIRS sees smaller fires and splits one fire into several pixels. A naive record (MODIS until 2011, VIIRS after) therefore jumps **3–5×** in 2012. That jump comes from the sensor, not from more fire.

## How we harmonize

| Step | What | Where |
|---|---|---|
| 1. Confidence filter | Drop low-confidence detections (MODIS < 30%, VIIRS "low") | `pipeline/grid-builder.ts` |
| 2. Common-grid fire-days | Snap every detection to a 0.01° (~1 km) grid and count unique *cell × day* pairs, so several 375 m pixels on one fire count once | `pipeline/grid-builder.ts` |
| 3. Overlap calibration | In 2012→, k = ΣVIIRS fire-days ÷ ΣMODIS fire-days for the selected area; MODIS-only years are scaled by k | `src/lib/harmonize.ts` |
| 4. Anomalies | Each month vs the same month in the previous 10 years (z-score + % change, with an over-dispersed counting-noise floor) | `src/lib/harmonize.ts` |
| 5. Trend | Mann-Kendall test + Sen's slope on annual totals | `src/lib/harmonize.ts` |
| 6. Confidence (HCI) | 0–100 index from detection confidence, MODIS/VIIRS agreement and sample size | `src/lib/harmonize.ts` |

The browser, the API server and the tests all use the same harmonization engine (`src/lib/harmonize.ts`).

## Features

- **Interactive map**: Harmonized / MODIS / VIIRS switcher, preset areas or **draw your own AOI**, a time playbar across 2001–2026 with a month filter, and ember particles over the hottest areas.
- **Fire calendar matrix**: years × months heatmap, glowing anomaly cells, hover popovers (hotspots, fire-days, HCI, MODIS:VIIRS ratio, % vs 10-yr average), and an annual chart that shows the naive jump next to the harmonized series.
- **Before/After harmonization toggle** with an animated counter.
- **FireCal Analyst** (Claude): streaming chat, auto-insight cards when you click an anomalous month, and responder briefs. It is grounded only in the computed statistics. Without an API key, an offline rule-based analyst answers instead.
- **Early-warning PDF brief** export.

## Quick start

Requires Node.js 22+.

```bash
npm install
npm run data:sample          # synthetic demo data (already committed in public/data)
cp .env.example .env         # optional: add ANTHROPIC_API_KEY for the Claude analyst
npm run dev                  # web on http://localhost:5173, API on :8787
```

Production: `npm run build && npm start` (serves `dist/` and the API on port 8787).

## Use real NASA FIRMS data

The committed data is **synthetic**, and the UI shows a "SAMPLE DATA" badge. Its seasonal patterns follow real regional burning practices, but the yearly values and anomalies are invented. To use the real record:

1. Get a free FIRMS MAP_KEY: https://firms.modaps.eosdis.nasa.gov/api/map_key/
2. Get the CSVs for the bounding box `88.0,20.5,92.75,26.75`:
   - the full archive is fastest via the [FIRMS Archive Download](https://firms.modaps.eosdis.nasa.gov/download/) (MODIS C6.1 + VIIRS S-NPP 375 m), saved into `pipeline/raw/`, or
   - `FIRMS_MAP_KEY=... npm run data:fetch -- 2024-01-01 2026-09-30` (Area API, 10-day chunks, resumable)
3. `npm run data:ingest` rebuilds `public/data/grid.json` and `points.json`. The badge switches to "NASA FIRMS".

## Project layout

```
src/
  lib/harmonize.ts     harmonization, anomalies, Mann-Kendall (shared)
  lib/types.ts         data contracts
  components/          MapPanel, CalendarPanel, AnalystPanel, Header, EmberCanvas
server/
  index.ts             Express API: /api/analyst (SSE), /api/health
  context.ts           grounding facts sent to Claude
  offline.ts           no-key fallback analyst
pipeline/              sample generator, FIRMS fetch + ingest
tests/                 node:test checks on the harmonization
```

## Tech

React 19 + Vite, Tailwind CSS v4, Framer Motion, Leaflet (CARTO dark tiles), Recharts, jsPDF, Express, Anthropic SDK (`claude-opus-5-5`, streaming, prompt caching, server-side refusal fallback).

## Known limitations

- 2001 to mid-2002 has only Terra (no Aqua), so that period is under-detected even after harmonization.
- k is one factor per area. A per-season or per-land-cover calibration would be more accurate.
- The AI analyst can still make mistakes. Briefs carry an "AI-generated, verify before operational use" note.
