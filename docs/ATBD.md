# FireCal Harmonized Active Fire Record: Algorithm Theoretical Basis Document

Methods for dataset releases 1.x (record 2003 to the latest complete year).

Independent project for the NASA Space Apps Challenge 2026 ("Harmonization of MODIS and VIIRS Hot Spots"). Not affiliated with or endorsed by NASA. Every number in the dataset can be regenerated from public NASA FIRMS archives with the code in https://github.com/sagoresarkerbdcse/nasa (`.github/workflows/global-data.yml`).

## 1. Purpose

MODIS (Terra 2000→, Aqua 2002→, 1 km) and VIIRS (Suomi NPP 2012→, 375 m) both detect actively burning fires, but their counts cannot be compared directly:

* VIIRS pixels are about 7× smaller in area, so VIIRS detects small and cool fires that MODIS misses, and splits one fire into several detections.
* MODIS pixels grow about 10× in area from nadir to the swath edge, so its sensitivity changes across the swath.
* Terra and Aqua stopped orbit-maintenance manoeuvres late in their missions. Their overpass times drift, and fire activity has a strong daily cycle.

A naive record (MODIS until 2011, VIIRS afterwards) jumps by about 2.5–3× in 2012, and that jump comes from the sensors, not from the fires. MODIS is nearing the end of its mission, so continuing its 20+ year fire record with VIIRS requires a documented, validated transfer. This product provides one, with uncertainty.

## 2. Input data

| Input | Product | Use |
|---|---|---|
| MODIS active fires | NASA FIRMS MODIS Collection 6.1 standard archive (MCD14ML-based), Terra + Aqua, yearly all-countries files | MODIS fire-days; Aqua detections for matchups; Terra/Aqua day/night fire radiative power (FRP) for the diurnal cycle; overpass times |
| VIIRS active fires | NASA FIRMS VIIRS S-NPP 375 m standard archive (VNP14IMG-based) | Reference record from 2012; matchups; FRE |
| ENSO index (app only) | NOAA CPC Oceanic Niño Index | Climate-link analysis in the app, not in this dataset |

Filtering: detections of FIRMS `type` 2 (static land sources such as gas flares and kilns) and 3 (offshore) are removed. Fire-days use nominal and high confidence only (MODIS confidence ≥ 30; VIIRS "n"/"h").

## 3. Unit of measure: fire-days

A **fire-day** is a unique (0.01° cell, UTC date) pair with at least one qualifying detection by the given sensor. Counting cell-days instead of detections removes most of the effect of pixel size on the number of detections per fire (several 375 m pixels on one fire count once) and of repeated overpasses at high latitude. Values are aggregated per country (FIRMS country files) × month and per 1° cell × month.

## 4. Harmonization (v2)

For each spatial unit (country, 1° cell or a user-drawn area) and calendar month *m*:

  **VIIRS-equivalent fire-days = k[m] × MODIS fire-days + floor[m]**

* **Ratio k[m]** is the ratio of VIIRS to MODIS fire-days over the training years, in a season window (month *m* at weight 1 and the neighbouring months at weight ¼).
* **Floor[m]** is the median, over the training years, of what VIIRS records beyond k × MODIS. It never goes below zero. It represents fires too small for MODIS to see at all, which a pure ratio cannot represent in months when MODIS records nothing.
* **Fitting.** k and the floor are fitted alternately until they are consistent, always ending with k fitted to the final floor.
* **Shrinkage.** A unit with little evidence borrows from its parent with an empirical-Bayes style prior worth N0 = 300 MODIS fire-days:

  k_unit-month → unit annual ratio → parent

  The parent is the world for countries. For 1° cells it is the 10° block, whose parent is the world.
* **Training years.** The model is trained on 2013–2021:
  * 2012 is excluded because the VIIRS 375 m fire record begins on 20 January 2012.
  * 2022 onward is held back because Terra and Aqua orbit drift is largest then (section 6).
* **Use.** From 2012 the record is VIIRS S-NPP observed. Before 2012 it is MODIS harmonized.

### 4.1 Uncertainty

* **Parameter uncertainty.** A year-block bootstrap of the training years gives the spread of k (5th–95th percentiles).
* **Prediction uncertainty.** This is the main term. Each training year is predicted by a model fitted without it (leave-one-year-out, refitting both k and the floor). The scale of the log residuals is set from their empirical 90th percentile, because the errors are heavy-tailed, and is shrunk toward the parent.
* **Annual totals** have their own leave-one-year-out residual scale, pooled with the parent's (prior worth 4 years).
* **Counting noise** (1/(v+1) in log space) is added for small values.
* Reported intervals are 90%.

### 4.2 Blind validation

The overlap years allow an honest test. We train on some years, harmonize the MODIS data of other years as if VIIRS did not exist, and compare with what VIIRS actually recorded. The four methods are compared on country-month and country-year totals:
* one global ratio,
* one ratio per country (FireCal v1),
* a ratio per country × season,
* v2.

The scores are median and 90th-percentile absolute error, median bias, and interval coverage. Months with fewer than 100 VIIRS fire-days and country-years with fewer than 1000 are excluded from the scores.

Results for this release are in `model/validation.csv`. Typical values: the monthly median error falls from about 36–39% with one global ratio, and 22–24% with one ratio per country, to about 12–14% with v2. The annual median error is about 5–6%.

Interval coverage is close to nominal in the 2013–2021 folds (about 87–91% monthly, 89–91% annual). It drops to about 85% / 84% when testing on 2022–2024. That is consistent with the orbit drift described below, and it is why those years are not used for training.

## 4.3 Sensor outages

A satellite safe-mode or data gap removes detections everywhere at once. It therefore shows up in the world record as a VIIRS/MODIS fire-day ratio far from that calendar month's normal, the training-year median.

* **VIIRS gaps.** Months below 85% of normal are VIIRS gaps. Every unit's VIIRS value in such a month is divided by the world completeness, which keeps VIIRS's spatial pattern. The month is flagged `viirs_gap_adjusted` (source flag 2) and given a 90% interval that includes ±6% completeness uncertainty and counting noise.
* **MODIS gaps.** Months above 135% are MODIS gaps. They are reported; the record uses VIIRS in those years.
* **Check.** January 2012 comes out at about 35% complete. That matches the VIIRS 375 m fire record starting on 20 January (12 of 31 days, 39%).
* **This release.** The detected gaps are listed in `harmonization_model.json` → `sensorGaps`.

## 5. MODIS detection probability from same-overpass matchups

Aqua MODIS and Suomi NPP VIIRS both cross the equator at about 13:30 local time, so in many places they observe the same fires within minutes.

**Building the matchup set.** For 2012 onward:
1. **Fire objects.** Each VIIRS fire object (a 0.01° cell with nominal or high-confidence VIIRS detections in one pass) is tested.
2. **Co-observed.** The object counts as co-observed if Aqua detected fire in the surrounding 3×3 1° cells, in the same day/night pass, within ±25 minutes. That puts the location inside the Aqua swath at that time.
3. **Detected.** The object counts as detected if an Aqua fire pixel lies within 0.6 × the larger MODIS pixel dimension + 0.5 km. The extra 0.5 km allows for geolocation error and the VIIRS pixel size.

**Model.** A binomial model is fitted to the matchup table, which is binned by:
* VIIRS fire radiative power (13 log bins),
* MODIS pixel area at the location (5 bins, from the scan × track size of nearby Aqua pixels),
* day/night,
* latitude band (5 bands).

The model is:

  P = ceiling[day/night, pixel class] × sigmoid(η)
  η = b0 + b1·log2 FRP + b2·ln(pixel area) + b3·night + b4·log2 FRP × ln(pixel area) + b5·night × log2 FRP + band offsets

β is fitted by Fisher scoring. The ceilings are fitted by profile likelihood. They absorb matchup losses that do not depend on fire power: geolocation and timing offsets, and objects counted as co-observed that lay just outside the Aqua swath, which is most common for swath-edge pixels. The sigmoid then describes sensitivity to fire power alone.

**Outputs.** Coefficients with standard errors; observed and fitted curves (`model/modis_detection_probability.csv`); and FRP50, the fire power at which MODIS detects half of the fires VIIRS sees, at nadir and at the swath edge, by day and by night.

**Role.** This physical model explains why k varies by region and season: k is larger where fire-size distributions are dominated by small fires. It is published as a diagnostic and is not used directly in the transfer.

**Caveats.**
* The coverage test is a proxy based on detections, not on MODIS geolocation.
* Above ~200 MW the observed match rate falls slightly. Very large fires span several MODIS pixels, and the 1 km object matching is strict. The monotone model over-predicts there, but those bins are rare.
* Objects in regions with no Aqua fire at all within about 100 km are not tested.
* Rare fires that change rapidly within 25 minutes add noise.

## 6. Orbit drift

**Overpass times.** For each satellite, pass (day or night) and year, the overpass local solar time is the circular mean of the detection times, using UTC time plus longitude/15 and |lat| ≤ 40°.

**Sensitivity.** Each MODIS pass is compared with VIIRS through the ratio R = satellite fire-days ÷ VIIRS fire-days, for the same pass and year. ln R is regressed on the overpass-time shift from the 2013–2017 reference over 2013 onward, which gives the sensitivity in % per hour of drift.

**Effect on MODIS counts.** The drift bias of MODIS fire-days in each year is the detection-weighted combination of the four passes. The effect on a MODIS-only world trend is reported as the Sen's slope with and without the drift effect. The files are `model/orbit_drift.csv` and `harmonization_model.json` → `drift`.

**Effect on this product:** none. VIIRS (maintained orbit) is used directly from 2012, and the transfer is trained on 2013–2021.

## 7. Fire radiative energy and emissions

1. **Diurnal cycle.** For each unit and calendar month, the fire radiative power at the four MODIS samples is used: Terra about 10:30 and 22:30, Aqua about 13:30 and 01:30, with the actual overpass times per year from section 6. These are fitted with g(t) = b + a·exp(−(t−h)²/2s²), where a, b ≥ 0 and h ∈ [12, 17] h, s ∈ [1.5, 5] h, by grid search with non-negative least squares.
2. **FRE.** For each month, FRE = Σ FRP at the ~13:30 pass × ∫g / g(13:30) × 3600 s. VIIRS anchors 2012 onward. Aqua MODIS anchors every year and is harmonized to VIIRS units with the same v2 transfer as fire-days.
3. **Dry matter.** Dry matter = FRE × 0.368 ± 0.015 kg MJ⁻¹ (Wooster et al., 2005).
4. **Emissions.** Emissions = dry matter × an emission factor. Biome-generic central values are used, with the range across savanna, agricultural and forest biomes (after Andreae, 2019):
   * CO₂ 1.60 (1.43–1.66) kg/kg,
   * CO 0.090 (0.069–0.121) kg/kg,
   * PM2.5 0.009 (0.006–0.018) kg/kg.

   Ranges also include ±15% for the diurnal integral and the harmonization interval for MODIS years.

**Known biases (low).**
* Fires obscured by cloud, canopy or smoke are not counted.
* Fires below the VIIRS detection limit are not counted.
* Peat is not separated.
* At high latitude several passes per day can double-count fire power.
* FRP-based inventories such as GFAS rescale by land cover to match burned-area inventories; this product does not.

Treat these values as conservative, internally consistent estimates for comparing years and countries, not as a replacement for GFED or GFAS.

## 8. Products

| Path | Content |
|---|---|
| `netcdf/firecal_fire_days_1deg_monthly_*.nc` | CF-1.8, time × lat × lon: harmonized fire-days, 90% interval (MODIS years), source flag |
| `netcdf/firecal_fire_days_1deg_annual_*.nc` | Annual totals |
| `cog/firecal_fire_days_1deg_YYYY.tif` | Annual Cloud-Optimized GeoTIFF, EPSG:4326, 1° |
| `tables/country_monthly.csv` | Country (and World) × month: MODIS/VIIRS fire-days, harmonized value and interval, detections, FRP, night counts |
| `tables/country_annual.csv` | Country × year: harmonized fire-days with interval, FRE, dry matter, CO₂, CO, PM2.5 with ranges |
| `tables/grid_1deg_annual.csv` | 1° cell × year harmonized fire-days with interval |
| `model/*` | Model parameters, blind validation, detection curves, orbit drift |
| `stac/`, `catalog.json` | STAC 1.0 catalog |
| `datapackage.json` | Frictionless Data package |

## 9. Key results (release 1.0, record 2003–2024)

**Harmonization accuracy.** Blind test, country-month median absolute error:

| Train → test | One global ratio | One ratio per country | v2 | v2 90% coverage (monthly / annual) |
|---|---|---|---|---|
| 2017–21 → 2013–16 | 36.6% | 22.0% | **12.3%** | 91% / 91% |
| 2013–17 → 2018–21 | 39.2% | 24.0% | **12.8%** | 87% / 89% |
| 2013–21 → 2022–24 | 39.4% | 24.5% | **14.4%** | 85% / 84% |

The annual median error with v2 is 5.4–6.4%.

**MODIS detection (55.9 million co-observed VIIRS fire objects, 2012–2024).**
* MODIS detects about 30% of them.
* FRP50 by day: 11.7 MW at nadir and 89 MW at the swath edge. By night: 8.0 MW and 31 MW. MODIS is more sensitive at night, against the cooler background.
* Matchup ceilings are 0.86–0.98, except 0.62 for daytime swath-edge pixels.

**Orbit drift (overpass local solar time vs 2013–2017).**

| Satellite | Shift by 2024 | Detection ratio vs VIIRS |
|---|---|---|
| Terra day | 44 min earlier | −22% |
| Terra night | 44 min earlier, toward evening fires | +44% |
| Aqua day | 37 min later, toward the afternoon peak | +16% |
| Aqua night | 36 min later | — |
| VIIRS S-NPP | stable within ±3 min | — |

* The drift alone raises MODIS fire-days by about **12% in 2024** (3.4% in 2023).
* A MODIS-only world trend reads −9.1%/decade; without the drift effect it is −10.2%/decade.

**Sensor outages detected.**
* VIIRS: 2012-01 (data start, 35%), 2012-03 (81%), 2022-07 (83%), 2022-08 (69%), 2024-07 (56%).
* MODIS: 2022-04.

**Emissions (world, conservative).**
* Active-fire CO₂ is about 3.4–3.9 Pg per year in 2003–2007 and 2.9–3.3 Pg per year in 2013–2024. Dry matter is 1.7–2.4 Pg per year.
* That is roughly 40–50% of burned-area inventories such as GFED. This is expected for an FRP method without cloud or small-fire correction.
* The decline matches the known decrease in global burned area.

## 10. Limitations

* Fire-days measure **active-fire occurrence**, not burned area or fire size.
* Country attribution follows the FIRMS country files.
* 1° cells near coasts and borders mix land types.
* The harmonized MODIS years carry the interval given. Single months with very few fires are dominated by counting noise.
* The transfer assumes that the relation between MODIS and VIIRS fire-days in a unit and season was the same in 2003–2011 as in 2013–2021. Strong land-use change (for example, the end of large-scale peat burning) can violate this. Check the interval width and the validation.
* NOAA-20 and NOAA-21 VIIRS are not mixed into the reference, to keep one consistent sensor.

## 11. References

* Andreae, M. O. (2019). Emission of trace gases and aerosols from biomass burning: an updated assessment. *Atmospheric Chemistry and Physics*, 19, 8523–8546.
* Giglio, L., Schroeder, W., Justice, C. O. (2016). The collection 6 MODIS active fire detection algorithm and fire products. *Remote Sensing of Environment*, 178, 31–41.
* Schroeder, W., Oliva, P., Giglio, L., Csiszar, I. A. (2014). The New VIIRS 375 m active fire detection data product: algorithm description and initial assessment. *Remote Sensing of Environment*, 143, 85–96.
* Wooster, M. J., Roberts, G., Perry, G. L. W., Kaufman, Y. J. (2005). Retrieval of biomass combustion rates and totals from fire radiative power observations. *Journal of Geophysical Research*, 110, D24311.
* NASA FIRMS: https://www.earthdata.nasa.gov/data/tools/firms

## Acknowledgement

We acknowledge the use of data and imagery from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).
