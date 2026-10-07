/**
 * Offline analyst (no Anthropic credentials). A small intent router that calls
 * the same tools as the Claude agent, moves the dashboard, and writes plain
 * answers from the tool results, so the demo works end to end without a key.
 */
import { analyzeAoi } from "../src/lib/harmonize";
import { MONTHS_LONG, REGIONS } from "../src/lib/regions";
import type { MonthStat } from "../src/lib/types";
import { buildGrounding, type Focus, type Grounding } from "./context";
import { runTool, type ToolContext } from "./tools";

const mName = (m: number) => MONTHS_LONG[m - 1];
const ym = (m: { year: number; month: number }) => `${mName(m.month)} ${m.year}`;
const pct = (share: number) => (share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
const signed = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${v >= 0 ? "+" : ""}${v}%`);
const ymLabel = (s: string) => {
  const [y, m] = s.split("-").map(Number);
  return `${mName(m)} ${y}`;
};

interface Args {
  grounding: Grounding;
  mode: "chat" | "insight" | "brief";
  question: string;
  focus?: Focus;
  ctx: ToolContext;
  send: (d: object) => void;
  isClosed: () => boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function offlineAgent({ grounding, mode, question, focus, ctx, send, isClosed }: Args) {
  const call = async (name: string, input: Record<string, unknown> = {}): Promise<any> => {
    send({ type: "tool", name, input });
    return runTool(name, input, ctx);
  };
  let text: string;

  if (mode === "insight" && focus) text = insight(grounding, focus);
  else if (mode === "brief" || /brief|warning|responder/i.test(question)) text = await brief(grounding, call);
  else {
    const q = question.toLowerCase();
    // Country mentioned? (longest name first so "South Sudan" beats "Sudan")
    const countryHit = ctx.global
      ? [...ctx.global.cf.countries.map((c) => c.name)].sort((x, y) => y.length - x.length).find((n) => n !== "Bangladesh" && q.includes(n.toLowerCase()))
      : undefined;
    const worldHit = /\b(world|global|planet|earth)\b/.test(q);
    if (ctx.global && /which countr|top countr|countries (burn|with|have)|most fires in the world|rank/.test(q)) {
      const by = /increas|rising|grow|worse/.test(q) ? "trend" : /decreas|declin|fall/.test(q) ? "trend" : /intens|frp|power/.test(q) ? "intensity" : /night/.test(q) ? "night_share" : "fire_days";
      const r = await call("rank_countries", { by, order: /decreas|declin|fall|lowest|least/.test(q) ? "lowest" : "highest", limit: 8 });
      if (r.rows?.[0]) await call("update_dashboard", { country: r.rows[0].country, layer: "activity", tab: "trends" });
      text = rankCountries(r);
    } else if ((countryHit || worldHit) && SCIENCE_RE.test(q)) {
      const area = { country: countryHit ?? "World" };
      const r = await call("get_fire_science", area);
      await call("update_dashboard", { ...area, tab: "science" });
      text = science(r);
    } else if (countryHit || worldHit) {
      const area = { country: countryHit ?? "World" };
      const ov = await call("get_area_overview", area);
      const hs = await call("get_hotspot_trends", area);
      await call("update_dashboard", { ...area, layer: /hot ?spot/.test(q) ? "hotspots" : "activity", tab: /trend|season|declin|increas/.test(q) ? "trends" : "calendar" });
      text = countryOverview(ov, hs);
    } else {
    const region = REGIONS.find((r) => q.includes(r.short.toLowerCase()) || q.includes(r.name.toLowerCase()) || (r.id === "cht" && /chittagong|hill tracts/.test(q)));
    const area: Record<string, unknown> = region ? { region: region.id } : {};
    const g = region ? buildGrounding(ctx.grid, region.bbox, region.name) : grounding;
    const year = Number(q.match(/\b(20\d\d)\b/)?.[1]) || undefined;
    const monthIdx = MONTHS_LONG.findIndex((m) => new RegExp(`\\b(${m.toLowerCase()}|${m.slice(0, 3).toLowerCase()})\\b`).test(q));
    const month = monthIdx >= 0 ? monthIdx + 1 : undefined;

    if (/\blive\b|right now|today|this week|last 7|currently|active now/.test(q)) {
      const r = await call("get_live_fires", area);
      await call("update_dashboard", { ...area, layer: "live", tab: "live" });
      text = live(r);
    } else if (SCIENCE_RE.test(q)) {
      const r = await call("get_fire_science", area);
      await call("update_dashboard", { ...area, tab: "science" });
      text = science(r);
    } else if (/forecast|outlook|next month|coming|predict|expect|upcoming/.test(q)) {
      const r = await call("get_outlook", { ...area, months: 3 });
      await call("update_dashboard", { ...area, layer: "outlook", tab: "outlook" });
      text = outlookText(r);
    } else if (/hot ?spot|where|location|persistent|intensif|cluster/.test(q)) {
      const r = await call("get_hotspot_trends", area);
      await call("update_dashboard", { ...area, layer: "hotspots", tab: "hotspots" });
      text = hotspots(r);
    } else if (/onset|earlier|later|season (start|length)|timing|shift|longer|shorter/.test(q)) {
      const r = await call("get_season_timing", area);
      await call("update_dashboard", { ...area, tab: "trends" });
      text = season(r);
    } else if (/worst|highest|biggest|most|record|lowest|least|quietest/.test(q)) {
      const r = await call("rank_months", { ...area, by: /anomal|unusual/.test(q) ? "anomaly" : "fire_days", order: /lowest|least|quietest/.test(q) ? "lowest" : "highest", limit: 5 });
      const top = r.rows[0];
      if (top) {
        const [y, m] = top.month.split("-").map(Number);
        await call("update_dashboard", { ...area, year: y, month: m, layer: "activity", tab: "calendar" });
      }
      text = rank(r);
    } else if (/compare|versus|\bvs\b|declin|increas|decreas|trend|changed|over time/.test(q)) {
      const a = analyzeAoi(ctx.grid, g.analysis.bbox);
      const years = a.annual.filter((x) => x.year < ctx.grid.meta.lastYear || ctx.grid.meta.lastMonth === 12).map((x) => x.year);
      const r = await call("compare_periods", { ...area, period_a: [years[0], years[5]], period_b: [years[years.length - 6], years[years.length - 1]] });
      await call("update_dashboard", { ...area, tab: "trends" });
      text = compare(r, g);
    } else if (/anomal|explain|unusual|spike|why/.test(q) || (year && month)) {
      const a = g.analysis;
      let target: MonthStat | undefined;
      if (year && month) target = a.months.find((m) => m.year === year && m.month === month);
      else if (year) target = a.anomalies.find((m) => m.year === year) ?? a.months.filter((m) => m.year === year).sort((x, y) => (y.z ?? 0) - (x.z ?? 0))[0];
      else target = a.anomalies[0];
      if (target) await call("update_dashboard", { ...area, year: target.year, month: target.month, layer: "anomaly", tab: "calendar" });
      text = target ? insight(g, target) : overview(g);
    } else if (/harmon|modis|viirs|sensor|calibrat|method|how do you/.test(q)) {
      text = method(g);
    } else if (/peak|season|when/.test(q)) {
      await call("update_dashboard", { ...area, tab: "trends" });
      text = peak(g);
    } else {
      await call("get_area_overview", area);
      if (region || year) await call("update_dashboard", { ...area, ...(year ? { year } : {}) });
      text = overview(g);
    }
    }
  }

  const parts = text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < parts.length; i += 3) {
    if (isClosed()) return;
    send({ type: "delta", text: parts.slice(i, i + 3).join("") });
    await new Promise((r) => setTimeout(r, 14));
  }
}

function trendLine(g: Grounding) {
  const t = g.analysis.trend;
  return t.significant
    ? `${t.direction} by about **${Math.abs(t.senSlope)} fire-days per year** (Mann-Kendall p = ${t.pValue})`
    : `no statistically significant trend (Mann-Kendall p = ${t.pValue}, Sen's slope ${t.senSlope}/yr)`;
}

function peak(g: Grounding) {
  const a = g.analysis;
  const [p1, p2, p3] = a.peakMonths;
  const c = (m: number) => a.climatology[m - 1];
  return `**Peak burning season in ${g.regionName}: ${mName(p1)}–${mName(p2)}**

**${mName(p1)}** averages **${c(p1).mean} fire-days**, followed by ${mName(p2)} (${c(p2).mean}) and ${mName(p3)} (${c(p3).mean}). These three months hold **${Math.round((c(p1).share + c(p2).share + c(p3).share) * 100)}%** of the year's burning.

- Quietest months: ${[...a.climatology].sort((x, y) => x.mean - y.mean).slice(0, 3).map((x) => mName(x.month)).join(", ")}
- Long-term: ${trendLine(g)}

The Trends tab shows whether the season is starting earlier.`;
}

function method(g: Grounding) {
  const a = g.analysis;
  return `**How FireCal harmonizes MODIS and VIIRS**

1. **Confidence filter.** Low-confidence detections, static industrial sources and offshore detections are dropped.
2. **Common-grid fire-days.** Each detection is snapped to a 0.01° grid. Unique cell-days are counted, so several 375 m VIIRS pixels on one fire count once.
3. **Overlap calibration.** In ${a.overlapYears[0]}–${a.overlapYears[1]}, VIIRS records **k = ${a.k}×** the MODIS fire-days here, so MODIS-only years are scaled by k.

Result: **${a.totals.naive.toLocaleString()}** mixed-sensor detections become **${a.totals.harmonized.toLocaleString()}** consistent fire-days.`;
}

function insight(g: Grounding, f: Focus) {
  const m = g.analysis.months.find((x) => x.year === f.year && x.month === f.month);
  if (!m) return `No data for ${ym(f)}.`;
  const era = m.year >= g.analysis.overlapYears[0] ? "VIIRS (with MODIS cross-check)" : `MODIS only, scaled by k = ${g.analysis.k}`;
  const level = m.anomaly === "extreme" ? "an **extreme** anomaly" : m.anomaly === "significant" ? "a **statistically significant** anomaly" : m.anomaly === "elevated" ? "**elevated** activity" : "within the normal range";
  const clim = g.analysis.climatology[m.month - 1];
  return `**${ym(m)} in ${g.regionName}: ${level}**

${ym(m)} recorded **${m.harmonized} harmonized fire-days** against a 10-year baseline of ${m.baseline ?? "n/a"} (${signed(m.pctVsBaseline)}, z = ${m.z ?? "n/a"}). ${mName(m.month)} normally holds ${pct(clim.share)} of the year's burning, so ${m.anomaly ? "this departure matters for seasonal planning" : "this month fits the usual pattern"}.

Detection basis: ${era}. MODIS saw ${m.modisRaw} raw hotspots and VIIRS saw ${m.viirsRaw}${m.ratio ? ` (ratio ${m.ratio})` : ""}. Confidence index: **${m.hci}/100**. ${m.hci >= 60 ? "The sensors agree well." : "Treat with some caution."} Possible drivers to check: a dry spell before the month (GPM IMERG rainfall) or a shift in burning practice.`;
}

function overview(g: Grounding) {
  const a = g.analysis;
  return `**${g.regionName} at a glance**

- Peak season: **${a.peakMonths.slice(0, 2).map(mName).join("–")}**
- Trend: ${trendLine(g)}
- Most notable anomaly: ${a.anomalies[0] ? `**${ym(a.anomalies[0])}** (${signed(a.anomalies[0].pctVsBaseline)} vs 10-yr avg)` : "none flagged"}
- Calibration factor k = ${a.k}

Try: "show live fires", "where are the persistent hot spots?", "is the season starting earlier?", or "what's the outlook?"`;
}

function live(r: any) {
  if (r.error) return `_${r.error}_`;
  const ch = r.change_vs_normal_pct;
  return `**Live: ${r.detections} fire detections in ${r.area} over the last 7 days**

- Last 24 hours: **${r.last_24h}** detections
- Suomi NPP fire-days: **${r.snpp_fire_days}** vs a normal of **${r.normal_fire_days_for_7_days}** for this time of year${ch === null ? "" : ` (**${signed(ch)}**)`}
${r.hottest_fire ? `- Most intense fire: **${r.hottest_fire.frp} MW** at ${r.hottest_fire.lat.toFixed(2)}°N ${r.hottest_fire.lon.toFixed(2)}°E (${r.hottest_fire.when})` : ""}
- Feeds: ${r.sources.join("; ")}

The map now shows the live layer. Pulsing points are the newest detections.`;
}

function outlookText(r: any) {
  const h = r.hindcast;
  return `**Outlook for ${r.area} (next 3 months)**

${r.months.map((m: any) => `- **${ymLabel(m.month)}**: expect ~**${m.expected_fire_days}** fire-days (likely ${m.likely_range[0]}–${m.likely_range[1]}); normal ${m.normal_10yr}; chance above normal **${Math.round(m.chance_above_normal * 100)}%**`).join("\n")}

This is a statistical outlook from past years (no weather input). In a ${h.test_years[0]}–${h.test_years[1]} hindcast it beat 10-year climatology by **${Math.round(h.skill_vs_climatology * 100)}%**, and the likely range held the real value **${Math.round(h.range_coverage * 100)}%** of the time.`;
}

function hotspots(r: any) {
  const c = r.counts;
  return `**Hot-spot trends in ${r.area}**

Getis-Ord Gi* hot-spot analysis per year, with a Mann-Kendall trend on top:
- **${c.persistent}** persistent, **${c.intensifying}** intensifying, **${c.consecutive}** consecutive, **${c.new}** new hot-spot cells
- **${c.diminishing}** diminishing and **${c.historical}** historical (cooling) cells, **${c.sporadic}** sporadic

Most active hot-spot cells:
${r.top_cells.slice(0, 4).map((x: any) => `- ${x.lat.toFixed(2)}°N ${x.lon.toFixed(2)}°E: **${x.category}**, hot in ${x.hot_years} years, ~${x.mean_fire_days_per_year} fire-days/yr`).join("\n") || "- none"}

Persistent and intensifying cells are where patrols and community outreach pay off most.`;
}

function season(r: any) {
  if (r.note) return r.note;
  const t = r.trends;
  const shift = (x: any, what: string) => (x.significant ? `${what} is shifting **${Math.abs(x.days_per_year)} days ${x.days_per_year < 0 ? "earlier" : "later"} per year** (p = ${x.p_value})` : `${what} shows no significant shift (p = ${x.p_value})`);
  const len = (x: any) => (x.significant ? `the season is getting **${Math.abs(x.days_per_year)} days ${x.days_per_year > 0 ? "longer" : "shorter"} per year** (p = ${x.p_value})` : `season length is stable (p = ${x.p_value})`);
  return `**Fire-season timing in ${r.area}**

On average the season starts around **${r.mean.onset}**, peaks around **${r.mean.peak}** and ends around **${r.mean.end}** (~${Math.round(r.mean.length_days)} days).

- Onset: ${shift(t.onset, "onset")}
- Peak: ${shift(t.peak, "the peak")}
- Length: ${len(t.length)}

An earlier start means response resources should be ready earlier than they used to be.`;
}

function rank(r: any) {
  return `**${r.ranked_by === "anomaly" ? "Most anomalous" : "Most active"} months in ${r.area}**

${r.rows.map((x: any, i: number) => `${i + 1}. **${ymLabel(x.month)}**: ${x.harmonized} fire-days${x.pct_vs_10yr !== null ? ` (${signed(x.pct_vs_10yr)} vs 10-yr avg)` : ""}`).join("\n")}

The map now shows the top month.`;
}

function compare(r: any, g: Grounding) {
  return `**${r.area}: ${r.period_a.years.join("–")} vs ${r.period_b.years.join("–")}**

- Mean per year: **${r.period_a.mean_harmonized_fire_days.toLocaleString()}** → **${r.period_b.mean_harmonized_fire_days.toLocaleString()}** fire-days (**${signed(r.change_pct)}**)
- MODIS alone (one consistent sensor): **${signed(r.modis_only_change_pct)}**, so the change is real, not a harmonization artifact
- Long-term: ${trendLine(g)}`;
}

async function brief(g: Grounding, call: (n: string, i?: Record<string, unknown>) => Promise<any>) {
  const [ov, out, hs, lv] = await Promise.all([call("get_area_overview"), call("get_outlook", { months: 3 }), call("get_hotspot_trends"), call("get_live_fires")]);
  const a = g.analysis;
  const recent = a.anomalies.filter((m) => m.year >= a.overlapYears[1] - 3).slice(0, 3);
  return `# Early-Warning Brief: ${g.regionName}

## Situation
Harmonized satellite record ${ov.record} (${a.totals.harmonized.toLocaleString()} fire-days). Peak burning is **${ov.peak_months.slice(0, 2).join("–")}**. Long-term: ${trendLine(g)}.${typeof ov.season === "object" ? ` The season typically starts around **${ov.season.onset}**.` : ""}

## Live: last 7 days
${lv.error ? `- ${lv.error}` : `- **${lv.detections}** detections, **${lv.last_24h}** in the last 24 h\n- S-NPP fire-days **${lv.snpp_fire_days}** vs normal **${lv.normal_fire_days_for_7_days}**${lv.change_vs_normal_pct === null ? "" : ` (${signed(lv.change_vs_normal_pct)})`}`}

## Outlook: next 3 months
${out.months.map((m: any) => `- **${ymLabel(m.month)}**: ~${m.expected_fire_days} fire-days (likely ${m.likely_range[0]}–${m.likely_range[1]}; normal ${m.normal_10yr})`).join("\n")}
- Statistical model; hindcast skill **${Math.round(out.hindcast.skill_vs_climatology * 100)}%** better than climatology.

## Hot-spot trends
- ${hs.counts.persistent} persistent, ${hs.counts.intensifying} intensifying, ${hs.counts.consecutive} consecutive cells
${hs.top_cells.slice(0, 3).map((c: any) => `- ${c.lat.toFixed(2)}°N ${c.lon.toFixed(2)}°E: ${c.category}, ~${c.mean_fire_days_per_year} fire-days/yr`).join("\n")}
${recent.length ? `\nRecent anomalies: ${recent.map((m) => `${ym(m)} (${signed(m.pctVsBaseline)})`).join(", ")}.` : ""}

## Recommended actions
- Check FIRMS alerts daily from about two weeks before the usual onset.
- Pre-position patrols and community volunteers at the persistent hot-spot cells above.
- Coordinate controlled-burn timing with agricultural extension before the peak.
- Re-issue this brief if live activity runs well above normal.`;
}

function rankCountries(r: any) {
  if (r.error) return `_${r.error}_`;
  const label = r.ranked_by === "trend" ? "Fastest-changing fire activity (significant trends)" : r.ranked_by === "intensity" ? "Most intense fires (FRP per fire-day)" : r.ranked_by === "night_share" ? "Most night-time burning" : "Most fire-days 2003–2024";
  return `**${label}**

${r.rows
  .map(
    (x: any, i: number) =>
      `${i + 1}. **${x.country}**: ${r.ranked_by === "trend" ? `${x.trend_fire_days_per_year > 0 ? "+" : ""}${Math.round(x.trend_fire_days_per_year).toLocaleString()} fire-days/yr (p=${x.trend_p})` : r.ranked_by === "intensity" ? `${x.frp_mw_per_fire_day} MW per fire-day` : r.ranked_by === "night_share" ? `${Math.round(x.night_share * 100)}% at night` : `${x.total_fire_days.toLocaleString()} fire-days`}`,
  )
  .join("\n")}
${r.note ? `\n_${r.note}_` : ""}

The map now shows the top country. Pick any country in the sidebar to compare.`;
}

function countryOverview(ov: any, hs: any) {
  const t = ov.trend;
  return `**${ov.area} at a glance (${ov.record})**

- Harmonized fire-days: **${ov.total_harmonized_fire_days.toLocaleString()}** (calibration k = ${ov.calibration_k})
- Peak months: **${ov.peak_months.slice(0, 2).join("–")}**
- Long-term trend: ${t.direction === "no trend" ? `no significant trend (p = ${t.p_value})` : `**${t.direction}** by ~${Math.abs(Math.round(t.sen_slope_per_year)).toLocaleString()} fire-days/yr (p = ${t.p_value})`}
${typeof ov.season === "object" ? `- Season: starts ~**${ov.season.onset}**, peaks ~**${ov.season.peak}**${ov.season.onset_p < 0.05 ? `, onset shifting ${Math.abs(ov.season.onset_shift_days_per_year)} days/yr ${ov.season.onset_shift_days_per_year < 0 ? "earlier" : "later"}` : ""}` : ""}
- Hot-spot cells (1°): **${hs.counts.persistent + hs.counts.intensifying}** persistent/intensifying, **${hs.counts.diminishing + hs.counts.historical}** cooling
${ov.top_anomalies?.[0] ? `- Biggest anomaly: **${ymLabel(ov.top_anomalies[0].month)}** (+${ov.top_anomalies[0].pct}% vs 10-yr)` : ""}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function science(r: any): string {
  const out: string[] = [`**Fire science · ${r.area}**`, ""];
  const e = r.enso_link;
  if (typeof e === "object")
    out.push(
      `- **El Niño / La Niña:** r = ${e.r} (p = ${e.p}, ${e.seasons} seasons, ONI ${e.oni_window}). ${
        e.p < 0.05 ? `Significant: each +1 °C of ONI shifts the fire season by ${e.pct_change_per_degC > 0 ? "+" : ""}${e.pct_change_per_degC}% (${e.verdict}). ENSO forecasts give months of early warning here.` : "No significant link; local land use and weather dominate."
      }`,
    );
  const i = r.intensity;
  if (typeof i === "object")
    out.push(
      `- **Intensity (${i.scope}, VIIRS):** ${i.frp_mw_per_fire_day} MW of fire radiative power per fire-day${i.frp_trend.significant ? `, trending ${i.frp_trend.senSlope > 0 ? "up" : "down"} (p = ${i.frp_trend.pValue})` : ", no significant trend"}; ${Math.round(i.night_share * 100)}% of detections at night${i.night_trend.significant ? ` (trending ${i.night_trend.senSlope > 0 ? "up" : "down"})` : ""}.`,
    );
  const g = r.fire_regime;
  if (typeof g === "object") {
    const n = g.fires_per_year.length || 1;
    const avg = (k: string) => g.fires_per_year.reduce((s: number, y: Record<string, number>) => s + y[k], 0) / n;
    out.push(
      `- **Fire regime (${g.years[0]}–${g.years[1]}):** about ${Math.round(avg("count")).toLocaleString()} individual fires a year, mean ${avg("mean_km2").toFixed(1)} km², lasting ${avg("mean_days").toFixed(1)} days. ${g.burned_km2.toLocaleString()} km² burned at least once and ${Math.round(g.reburned_share * 100)}% of that burned again; the typical return time is ${g.median_return_years ?? "—"} year(s), the signature of short shifting-cultivation cycles.`,
    );
  }
  out.push("", "_Open the **Science** tab for the charts._");
  return out.join("\n");
}

const SCIENCE_RE = /el ni|la ni|enso|climate|pacific|frp|radiative|intensity|night|re-?burn|return interval|fire size|individual fire|regime|science/;
