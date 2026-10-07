# 🔥 FireCal AI

**NASA Space Apps Challenge 2026: Harmonization of MODIS and VIIRS Hot Spots**

> Independent hackathon project. Not affiliated with or endorsed by NASA.

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

- **Interactive map**: NASA GIBS imagery, Harmonized / MODIS / VIIRS switcher, preset areas or **draw your own AOI**, a time playbar across 2001–2026 with a month filter, and ember particles over the hottest areas.
- **Fire calendar matrix**: years × months heatmap, glowing anomaly cells, hover popovers (hotspots, fire-days, HCI, MODIS:VIIRS ratio, % vs 10-yr average), and an annual chart that shows the naive jump next to the harmonized series.
- **Before/After harmonization toggle** with an animated counter.
- **FireCal Analyst** (Claude): streaming chat, auto-insight cards when you click an anomalous month, and responder briefs. It is grounded only in the computed statistics. Without an API key, an offline rule-based analyst answers instead.
- **Early-warning PDF brief** export.

## Quick start

Requires Node.js 22+.

```bash
npm install
cp .env.example .env         # optional: add ANTHROPIC_API_KEY for the Claude analyst
npm run dev                  # web on http://localhost:5173, API on :8787
```

Production: `npm run build && npm start` (serves `dist/` and the API on port 8787).

## Data: real NASA FIRMS archive

`public/data/` holds the **real NASA FIRMS record, 2003–2024**: MODIS C6.1 + VIIRS S-NPP 375 m standard-quality archives for Bangladesh, India and Myanmar, clipped to the study area (88.0–92.75°E, 20.5–26.75°N). That is 710,000+ detections after removing static industrial sources such as gas flares and brick kilns, plus offshore detections.

- The record starts in **2003**, the first full Terra + Aqua year. The 2001–2002 archives are visibly incomplete for this area and would fake a trend.
- `.github/workflows/firms-data.yml` refreshes the data monthly (and on demand from the Actions tab). It downloads the public FIRMS country-yearly archives (no key needed), harmonizes them, runs the tests and commits the result.
- **Current-year data:** add a free [FIRMS MAP_KEY](https://firms.modaps.eosdis.nasa.gov/api/map_key/) as the repository secret `FIRMS_MAP_KEY`. The workflow then tops up the months after the last published archive year through the FIRMS Area API.

Locally:

```bash
npm run data:fetch-country           # public yearly archives → pipeline/raw/
FIRMS_MAP_KEY=... npm run data:fetch -- 2025-01-01   # optional NRT top-up
npm run data:ingest                  # → public/data/grid.json + points.json
npm run data:sample                  # (synthetic demo data instead)
```

### What the real record shows (full study area)

- Peak burning is **March–April** (hill-farming *jhum* burning across the Chittagong Hill Tracts, Tripura, Mizoram and Meghalaya).
- VIIRS records **k ≈ 2.2–2.8×** the MODIS fire-days. The naive record jumps ~3–4× in 2012. The harmonized record doesn't.
- Burning has **declined significantly** since 2003 (Sen's slope ≈ −580 fire-days/yr, Mann-Kendall p = 0.002). MODIS alone shows the same decline, so it is not a harmonization artifact.
- The largest recent anomaly is **April 2023** (+88% vs the 10-year average).

## Interface

NASA-inspired mission-control design: Inter + DM Mono, flat panels with HUD framing, a mission header with live UTC and satellite status, and count-up mission stats. The map has NASA GIBS basemaps (VIIRS Black Marble, Blue Marble, and true-color imagery for the selected date) with automatic fallback to a dark basemap. It also has a satellite swath sweep, fire cells that pop in on every year change, and ember particles. There is a boot sequence, staggered panel entrances, and cascading calendar reveals. Reduced-motion preferences are respected.

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
