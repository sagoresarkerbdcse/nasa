/**
 * Rule-based analyst used when no Anthropic credentials are configured. It
 * answers the common questions straight from the grounding numbers so the demo
 * still works offline. It's deliberately plainer than the Claude analyst.
 */
import { MONTHS_LONG } from "../src/lib/regions";
import type { MonthStat } from "../src/lib/types";
import type { Focus, Grounding } from "./context";

const mName = (m: number) => MONTHS_LONG[m - 1];
const ym = (m: { year: number; month: number }) => `${mName(m.month)} ${m.year}`;
const pct = (share: number) => (share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
const signed = (v: number | null) => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v}%`);

export function offlineAnswer(g: Grounding, mode: "chat" | "insight" | "brief", question: string, focus?: Focus): string {
  if (mode === "brief") return brief(g);
  if (mode === "insight" && focus) return insight(g, focus);
  const q = question.toLowerCase();
  const year = Number(q.match(/\b(20\d\d)\b/)?.[1]);
  const monthIdx = MONTHS_LONG.findIndex((m) => q.includes(m.toLowerCase()) || q.includes(m.slice(0, 3).toLowerCase() + " "));
  if (/brief|warning|responder/.test(q)) return brief(g);
  if (/anomal|explain|unusual|spike|why/.test(q)) {
    const a = g.analysis;
    let target: MonthStat | undefined;
    if (year && monthIdx >= 0) target = a.months.find((m) => m.year === year && m.month === monthIdx + 1);
    else if (year) target = a.anomalies.find((m) => m.year === year) ?? [...a.months].filter((m) => m.year === year).sort((x, y) => (y.z ?? 0) - (x.z ?? 0))[0];
    else target = a.anomalies[0];
    if (target) return insight(g, target);
  }
  if (/trend|increas|decreas|changing|over time/.test(q)) return trend(g);
  if (/harmon|modis|viirs|sensor|calibrat|method/.test(q)) return method(g);
  if (/peak|season|when|month/.test(q)) return peak(g);
  return overview(g);
}

function peak(g: Grounding) {
  const a = g.analysis;
  const [p1, p2, p3] = a.peakMonths;
  const c = (m: number) => a.climatology[m - 1];
  const top3 = Math.round((c(p1).share + c(p2).share + c(p3).share) * 100);
  return `**Peak burning season in ${g.regionName}: ${mName(p1)}–${mName(p2)}**

Across the harmonized record, **${mName(p1)}** averages **${c(p1).mean} fire-days**, followed by ${mName(p2)} (${c(p2).mean}) and ${mName(p3)} (${c(p3).mean}). Together these three months hold **${top3}%** of annual burning activity.

- Quietest months: ${[...a.climatology].sort((x, y) => x.mean - y.mean).slice(0, 3).map((x) => mName(x.month)).join(", ")}
- Long-term trend: ${trendLine(g)}

Pre-position monitoring and response resources a few weeks before ${mName(p1)}.`;
}

function trendLine(g: Grounding) {
  const t = g.analysis.trend;
  return t.significant
    ? `${t.direction} by about ${Math.abs(t.senSlope)} fire-days per year (Mann-Kendall p = ${t.pValue})`
    : `no statistically significant trend (Mann-Kendall p = ${t.pValue}, Sen's slope ${t.senSlope}/yr)`;
}

function trend(g: Grounding) {
  const a = g.analysis;
  const complete = a.annual.filter((y) => y.year < g.analysis.overlapYears[1]);
  const max = [...complete].sort((x, y) => y.harmonized - x.harmonized)[0];
  const min = [...complete].sort((x, y) => x.harmonized - y.harmonized)[0];
  return `**Long-term change in ${g.regionName}**

Annual harmonized burning shows ${trendLine(g)}.

- Most active year: **${max.year}** (${Math.round(max.harmonized)} fire-days)
- Least active year: **${min.year}** (${Math.round(min.harmonized)} fire-days)
- Naive counts would suggest a ${Math.round((a.annual.find((y) => y.year === 2013)!.naive / Math.max(1, a.annual.find((y) => y.year === 2010)!.naive)) * 10) / 10}× jump between 2010 and 2013. Most of that jump comes from the VIIRS sensor switch, not real change. The harmonized series removes it.`;
}

function method(g: Grounding) {
  const a = g.analysis;
  return `**How FireCal harmonizes MODIS and VIIRS**

1. **Confidence filter.** Low-confidence detections are dropped (MODIS < 30%, VIIRS "low").
2. **Common-grid fire-days.** Every detection is snapped to a 0.01° grid, and we count unique cell-days. Several 375 m VIIRS pixels on the same fire collapse into one fire-day.
3. **Overlap calibration.** For ${a.overlapYears[0]}–${a.overlapYears[1]}, when both sensors fly, VIIRS records **k = ${a.k}×** the MODIS fire-days here. MODIS-era months are multiplied by k.

Result: naive totals of **${a.totals.naive.toLocaleString()}** mixed-sensor detections become **${a.totals.harmonized.toLocaleString()}** consistent fire-days, comparable across all years.`;
}

function insight(g: Grounding, f: Focus) {
  const m = g.analysis.months.find((x) => x.year === f.year && x.month === f.month);
  if (!m) return `No data for ${ym(f)}.`;
  const era = m.year >= g.analysis.overlapYears[0] ? "VIIRS (with MODIS cross-check)" : `MODIS only, scaled by k = ${g.analysis.k}`;
  const level =
    m.anomaly === "extreme" ? "an **extreme** anomaly" : m.anomaly === "significant" ? "a **statistically significant** anomaly" : m.anomaly === "elevated" ? "**elevated** activity" : "within the normal range";
  const clim = g.analysis.climatology[m.month - 1];
  return `**${ym(m)} in ${g.regionName}: ${level}**

${ym(m)} recorded **${m.harmonized} harmonized fire-days** against a 10-year baseline of ${m.baseline ?? "n/a"} for ${mName(m.month)} (${signed(m.pctVsBaseline)}, z = ${m.z ?? "n/a"}). ${mName(m.month)} normally accounts for ${pct(clim.share)} of the year's burning here, so ${m.anomaly ? "this departure matters for seasonal planning" : "this month fits the usual seasonal pattern"}.

Detection basis: ${era}. MODIS saw ${m.modisRaw} raw hotspots and VIIRS saw ${m.viirsRaw}${m.ratio ? ` (VIIRS/MODIS ratio ${m.ratio})` : ""}. Harmonized Confidence Index: **${m.hci}/100**. ${m.hci >= 60 ? "The sensors agree well." : "Treat this with some caution: confidence is moderate."}`;
}

function overview(g: Grounding) {
  const a = g.analysis;
  return `**${g.regionName} at a glance**

- Peak season: **${a.peakMonths.slice(0, 2).map(mName).join("–")}**
- Trend: ${trendLine(g)}
- Most notable anomaly: ${a.anomalies[0] ? `**${ym(a.anomalies[0])}** (${signed(a.anomalies[0].pctVsBaseline)} vs 10-yr avg)` : "none flagged"}
- Calibration factor k = ${a.k}

Ask about a specific month or year, or request an early-warning brief.`;
}

function brief(g: Grounding) {
  const a = g.analysis;
  const recent = a.anomalies.filter((m) => m.year >= a.overlapYears[1] - 3).slice(0, 3);
  return `# Early-Warning Brief: ${g.regionName}

## Situation
Harmonized satellite record ${a.annual[0].year}–${a.overlapYears[1]} (MODIS + VIIRS, ${a.totals.harmonized.toLocaleString()} fire-days). Peak burning season is **${a.peakMonths.slice(0, 2).map(mName).join("–")}**. Long-term: ${trendLine(g)}.

## Outlook: next 60 days
${g.outlookMonths.map((o) => `- **${ym(o)}**: typical ${a.climatology[o.month - 1].mean} fire-days (${pct(a.climatology[o.month - 1].share)} of the annual total)`).join("\n")}

## Recent anomalies
${recent.length ? recent.map((m) => `- ${ym(m)}: ${m.anomaly}, ${signed(m.pctVsBaseline)} vs 10-yr avg (HCI ${m.hci})`).join("\n") : "- No significant anomalies in the last 3 years."}

## Watch locations
${g.hotCells.length ? g.hotCells.map((h) => `- ${h.lat.toFixed(2)}°N ${h.lon.toFixed(2)}°E: ~${h.fireDays} fire-days/yr in these months`).join("\n") : "- No recurring hot cells for the outlook months."}

## Recommended actions
- Increase satellite alert checks (FIRMS NRT) during the outlook window.
- Stage patrols and community volunteers near the watch locations.
- Coordinate with agricultural extension on controlled-burn timing.`;
}
