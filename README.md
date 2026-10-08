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
| 3. Transfer (v2) | VIIRS-equivalent = k(month) × MODIS + small-fire floor(month), trained on the 2013–2021 overlap, shrunk toward the parent (area → domain/world, cell → 10° block → world), with bootstrap and leave-one-year-out 90% intervals | `src/lib/harmonize2.ts` |
| 4. Anomalies | Each month vs the same month in the previous 10 years (z-score + % change, with an over-dispersed counting-noise floor) | `src/lib/harmonize.ts` |
| 5. Trend | Mann-Kendall test + Sen's slope on annual totals | `src/lib/harmonize.ts` |
| 6. Confidence (HCI) | 0–100 index from detection confidence, MODIS/VIIRS agreement and sample size | `src/lib/harmonize.ts` |

The browser, the API server and the tests all use the same harmonization engine (`src/lib/harmonize.ts`).

## Harmonization v2 and the open dataset

Scores come from a **blind test**. The transfer is trained on some overlap years and used to harmonize the MODIS data of other years as if VIIRS did not exist; the result is compared with what VIIRS actually saw.

| Method | Monthly country error (median) | Annual |
|---|---|---|
| One global ratio | ~36–39% | ~23–25% |
| One ratio per country (v1) | ~22–24% | ~6–8% |
| **v2: season ratio + small-fire floor** | **~12–14%** | **~5–6%** |

The v2 90% intervals contain about 85–91% of held-out values.

The **Harmonization Lab** (`/lab`) shows the evidence:
- the blind-test table and each country's seasonal transfer,
- **MODIS detection probability** from same-overpass VIIRS/Aqua matchups: the fire power at which MODIS sees half of the fires, at nadir and at the swath edge,
- **Terra/Aqua orbit drift** and what it does to MODIS-only trends,
- **fire radiative energy → CO₂ / CO / PM2.5**.

Every run of the global workflow packages an **open dataset**:
- CF-1.8 NetCDF with 90% intervals,
- Cloud-Optimized GeoTIFFs,
- country and world CSVs with emissions,
- a STAC catalog and a Frictionless datapackage,
- a quickstart notebook,
- the methods document ([`docs/ATBD.md`](docs/ATBD.md)).

To publish it with a DOI (Zenodo) and on Kaggle, see [`docs/PUBLISHING.md`](docs/PUBLISHING.md).

## Features

- **Two scales.** The sidebar switches between the **whole world** (236 countries, harmonized per country and on a 1° grid), any **country**, and the **Bangladesh high-detail** record (0.25° map, 0.01° fire-days, preset regions or **draw your own area**).
- **Interactive maps, all NASA imagery**: NASA GIBS Black Marble (default on both maps), Blue Marble, date-matched true color, and GIBS place labels and borders. No map key and no commercial tiles. Includes a 3D globe and layers for activity, anomaly, emerging hot spots, outlook and live fires. A time playbar runs across the full record with a month filter.
- **Insights panel**
  - *Calendar*: years × months heatmap with glowing anomaly cells and hover popovers.
  - *Trends*: naive vs harmonized annual series; season onset, peak and length with trend tests.
  - *Hot spots*: emerging hot-spot analysis (Getis-Ord Gi* + Mann-Kendall): new, intensifying, persistent, diminishing.
  - *Outlook*: next months' expected fire-days with likely range, validated by a 10-year hindcast against climatology.
  - *Live*: last 7 days of NASA FIRMS near-real-time detections vs normal (Bangladesh).
  - *Science*: see below.
- **Before/After harmonization toggle** with an animated counter.
- **AI analyst** with tools. It runs real statistics (area overview, ranking, period comparison, hot spots, season timing, outlook, live fires, country ranking, fire science) and drives the dashboard itself: it moves the map, switches layers and opens tabs. It is grounded only in computed numbers. Without an API key, a free offline analyst answers instead.
- **Guided tour** on first visit (reopen with the compass button) and a **Data sources** panel listing every dataset, its provider, resolution, period, where it is used and how to cite it.
- **Download** any area's monthly harmonized record (CSV with 90% intervals) from the Insights panel.
- **Early-warning PDF brief** export, **presentation mode** (guided tour), and shareable URLs (state lives in the URL hash).
- **Explain page** (`/explain`): narrated, animated stories for ages 3–5, ages 15–20 and seniors, plus "why this data matters", with a quiz.

## Science tab: what a fire scientist asks next

| Question | Method | Source |
|---|---|---|
| Does the climate drive it? | Pearson r between pre-season NOAA ONI (6 months before the peak season) and the detrended log fire-season anomaly; Fisher-z p-value. Ranks the countries whose fire seasons track El Niño / La Niña. | `src/lib/science.ts`, `pipeline/fetch-oni.ts` |
| How intense are the fires? | VIIRS fire radiative power (FRP) per fire-day and night-time share per year, with Mann-Kendall trends | `src/lib/science.ts` |
| How does the land burn? | Individual fires rebuilt by linking VIIRS fire-days that touch in space (8-neighbour, ~1 km) and time (±1 day), in the style of the Global Fire Atlas; burned footprint, re-burn share and burn return interval per ~1 km cell | `pipeline/grid-builder.ts`, `src/lib/science.ts` |

Examples from the real record:
- The Philippines, Venezuela, Colombia and Thailand burn significantly more after El Niño. Botswana and South Africa burn more after La Niña, when wet years grow more grass fuel.
- Bangladesh shows **no** significant ENSO link (p > 0.4), so local land use dominates there.
- In the Chittagong Hill Tracts, **83%** of the land that burned (2012–2024) burned again. The typical return time is **1 year**, the signature of very short *jhum* fallow cycles.

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

### Global record

`.github/workflows/global-data.yml` downloads the FIRMS **all-countries** yearly archives (MODIS + VIIRS S-NPP, 2003–2024, hundreds of millions of detections). It processes one year per parallel job (`npm run data:global-year`). The merge step (`npm run data:global-merge`) writes:
- `public/data/global/countries.json`: per country × month, with fire-days, detections, FRP and night counts for each sensor.
- `public/data/global/grid1.json`: 1° cells × year, plus a monthly climatology.

The merge refuses to write a record with missing years.

`.github/workflows/live-fires.yml` refreshes the 7-day live feed and the NOAA ONI index twice a day.

### What the real record shows (full study area)

- Peak burning is **March–April** (hill-farming *jhum* burning across the Chittagong Hill Tracts, Tripura, Mizoram and Meghalaya).
- VIIRS records **k ≈ 2.2–2.8×** the MODIS fire-days. The naive record jumps ~3–4× in 2012. The harmonized record doesn't.
- Burning has **declined significantly** since 2003 (Sen's slope ≈ −580 fire-days/yr, Mann-Kendall p = 0.002). MODIS alone shows the same decline, so it is not a harmonization artifact.
- The largest recent anomaly is **April 2023** (+88% vs the 10-year average).

## Interface

NASA-inspired mission-control design: Inter + DM Mono, flat panels with HUD framing, a mission header with live UTC and satellite status, and count-up mission stats. The map has NASA GIBS basemaps (VIIRS Black Marble, Blue Marble, and true-color imagery for the selected date) with automatic fallback to plain bundled outlines if GIBS can't be reached. It also has a satellite swath sweep, fire cells that pop in on every year change, and ember particles. There is a boot sequence, staggered panel entrances, and cascading calendar reveals. Reduced-motion preferences are respected.

## Project layout

```
src/
  lib/harmonize.ts     harmonization, anomalies, Mann-Kendall (shared)
  lib/analytics.ts     emerging hot spots, season timing, outlook + hindcast
  lib/global.ts        country analyses and the 1° world grid
  lib/science.ts       ENSO link, fire intensity, fire regime
  lib/harmonize2.ts    v2 transfer, uncertainty, blind validation
  lib/detection.ts     MODIS detection probability from matchups
  lib/drift.ts         Terra/Aqua orbit drift
  lib/emissions.ts     diurnal cycle, FRE, dry matter, emissions
  lab/                 Harmonization Lab page
  components/          maps, sidebar, insight tabs, analyst, tour
  explain/             animated stories page
server/
  index.ts             Express API: /api/analyst (SSE), /api/live, /api/health
  tools.ts             analyst tools (statistics + dashboard control)
  openrouter.ts        OpenRouter client with budget ledger
  context.ts           grounding facts for the model
  offline.ts           free offline analyst
pipeline/              FIRMS fetch + ingest, global per-year (+ matchups) and merge, science products,
                       dataset export (Python), Zenodo/Kaggle publishing, live feed, ONI
docs/                  ATBD, dataset card, publishing guide, quickstart notebook
tests/                 node:test checks on the harmonization
```

## Tech

React 19 + Vite, Tailwind CSS v4, Framer Motion, Leaflet + d3-geo, Recharts, jsPDF, Express, OpenRouter / Anthropic SDK.

## Known limitations

- The record starts in 2003: 2001 to mid-2002 had only Terra (no Aqua) and is left out.
- The ENSO test uses about 20 seasons, so only strong links reach significance.
- The v2 transfer assumes the MODIS/VIIRS relation per area and season in 2003–2011 matches 2013–2021; the intervals and blind test quantify how well that holds. A per-season or per-land-cover calibration would be more accurate.
- The AI analyst can still make mistakes. Briefs carry an "AI-generated, verify before operational use" note.
