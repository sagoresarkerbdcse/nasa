import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Crosshair, Minus, Radio, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import {
  HOTSPOT_FAMILY,
  HOTSPOT_META,
  hindcast,
  hotspotsInBBox,
  liveSummary,
  seasonTiming,
  type HotspotCategory,
  type OutlookMonth,
} from "../lib/analytics";
import { fmt } from "../lib/color";
import { MONTHS } from "../lib/regions";
import type { AoiAnalysis, BBox, GridFile, LiveFile } from "../lib/types";

const axis = { fill: "#7b8494", fontSize: 10, fontFamily: "DM Mono" };
const tooltipStyle = {
  contentStyle: { background: "rgba(8,11,16,0.97)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, fontSize: 11, fontFamily: "DM Mono" },
  labelStyle: { color: "#fff", fontWeight: 600 },
  itemStyle: { color: "#cbd5e1" },
};

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-[4px] border border-white/[0.07] bg-white/[0.02] px-3 py-2">
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className={`mt-1 text-[17px] font-semibold leading-none tabular-nums ${tone ?? "text-white"}`}>{value}</div>
      {sub && <div className="mt-1 font-mono text-[9.5px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Shift({ days, p, unit = "days/yr", invert = false }: { days: number; p: number; unit?: string; invert?: boolean }) {
  const sig = p < 0.05;
  const Icon = !sig ? Minus : (days < 0) !== invert ? ArrowDownRight : ArrowUpRight;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {sig ? `${days > 0 ? "+" : ""}${days} ${unit}` : "no shift"}
    </span>
  );
}

// ---------------------------------------------------------------------------
export function TrendsTab({ analysis, meta, harmonized }: { analysis: AoiAnalysis; meta: GridFile["meta"]; harmonized: boolean }) {
  const s = useMemo(() => seasonTiming(analysis), [analysis]);
  const annual = analysis.annual.map((a) => ({ year: a.year, harmonized: Math.round(a.harmonized), naive: a.naive }));
  const season = s.years.map((y) => ({ year: y.year, range: [Math.round(y.onset), Math.round(y.end)] as [number, number], peak: Math.round(y.peak), onset: Math.round(y.onset) }));
  const t = analysis.trend;
  return (
    <div className="space-y-4 pb-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Long-term trend" value={t.significant ? `${t.senSlope > 0 ? "+" : ""}${fmt(t.senSlope)}/yr` : "Stable"} sub={`Mann-Kendall p=${t.pValue}`} tone={t.significant ? (t.senSlope > 0 ? "text-nasa-red" : "text-emerald-400") : undefined} />
        {s.years.length ? (
          <>
            <Stat label="Season onset" value={s.label(s.mean.onset)} sub={<Shift days={s.trends.onset.senSlope} p={s.trends.onset.pValue} />} />
            <Stat label="Season peak" value={s.label(s.mean.peak)} sub={<Shift days={s.trends.peak.senSlope} p={s.trends.peak.pValue} />} />
            <Stat label="Season length" value={`${Math.round(s.mean.length)} d`} sub={<Shift days={s.trends.length.senSlope} p={s.trends.length.pValue} invert />} />
          </>
        ) : (
          <div className="col-span-3 self-center font-mono text-[11px] text-slate-500">Too little fire here to time a season.</div>
        )}
      </div>

      <figure>
        <figcaption className="mb-1 flex flex-wrap items-center gap-3 text-[11px]">
          <span className="eyebrow !text-[9.5px] !text-slate-300">Annual burning</span>
          <span className={`flex items-center gap-1.5 ${harmonized ? "text-slate-200" : "text-slate-500"}`}>
            <span className="h-0.5 w-3 bg-flame" /> Harmonized fire-days
          </span>
          <span className={`flex items-center gap-1.5 ${!harmonized ? "text-slate-200" : "text-slate-500"}`}>
            <span className="h-0.5 w-3 border-t-2 border-dashed border-signal" /> Naive raw counts
          </span>
        </figcaption>
        <div className="h-[170px]">
          <ResponsiveContainer>
            <ComposedChart data={annual} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="trFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff7a1a" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#ff7a1a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} interval={3} />
              <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
              <Tooltip {...tooltipStyle} />
              <ReferenceLine x={meta.viirsStartYear} stroke="#4d8eff" strokeDasharray="3 3" label={{ value: "VIIRS", fill: "#4d8eff", fontSize: 9, position: "insideTopLeft" }} />
              <Area animationDuration={500} type="monotone" dataKey="harmonized" name="Harmonized" stroke="#ff7a1a" strokeWidth={2} fill="url(#trFill)" />
              <Line animationDuration={500} type="monotone" dataKey="naive" name="Naive raw" stroke="#4d8eff" strokeDasharray="5 4" strokeWidth={harmonized ? 1.2 : 2} dot={false} strokeOpacity={harmonized ? 0.6 : 1} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </figure>

      {s.years.length > 0 && (
        <figure>
          <figcaption className="mb-1 flex flex-wrap items-center gap-3 text-[11px]">
            <span className="eyebrow !text-[9.5px] !text-slate-300">Fire season each year</span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-2 w-3 rounded-[1px] bg-flame/50" /> 10%–90% of burning
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-2 w-2 rounded-full bg-white" /> 50% (peak)
            </span>
          </figcaption>
          <div className="h-[190px]">
            <ResponsiveContainer>
              <ComposedChart data={season} margin={{ top: 6, right: 8, left: 6, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} interval={3} />
                <YAxis tick={axis} tickLine={false} axisLine={false} reversed domain={["dataMin - 15", "dataMax + 10"]} tickFormatter={(d) => s.label(d)} width={48} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: unknown, name?: unknown) => (Array.isArray(v) ? [`${s.label(v[0])} → ${s.label(v[1])}`, "Season"] : [s.label(v as number), String(name)])}
                />
                <Bar dataKey="range" name="Season" fill="rgba(255,122,26,0.5)" radius={4} barSize={7} animationDuration={500} />
                <Scatter dataKey="peak" name="Peak" fill="#ffffff" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-slate-400">
            Each bar runs from the date 10% of that year's fire-days had happened to the date 90% had. Earlier dates are higher on the chart.
            {s.trends.onset.significant && s.trends.onset.senSlope < 0 && (
              <>
                {" "}
                Onset has moved about <strong className="text-white">{Math.round(Math.abs(s.trends.onset.senSlope) * 10)} days earlier per decade</strong>.
              </>
            )}
          </p>
        </figure>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function HotspotsTab({ grid, bbox, onFocus }: { grid: GridFile; bbox: BBox; onFocus: (b: BBox) => void }) {
  const h = useMemo(() => hotspotsInBBox(grid, bbox), [grid, bbox]);
  const order: HotspotCategory[] = ["intensifying", "new", "consecutive", "persistent", "diminishing", "historical", "sporadic"];
  const max = Math.max(1, ...order.map((k) => h.counts[k]));
  const total = order.reduce((s, k) => s + h.counts[k], 0);
  return (
    <div className="space-y-4 pb-2">
      <p className="text-[12px] leading-relaxed text-slate-400">
        For every year, each 0.25° cell gets a <strong className="text-slate-200">Getis-Ord Gi*</strong> score: is it, together with its neighbours, burning significantly more than the area as a whole? A <strong className="text-slate-200">Mann-Kendall</strong> test on
        those scores then says whether each hot spot is growing or fading.
      </p>
      <div className="space-y-1.5" role="list" aria-label="Hot-spot cells by pattern">
        {order.map((k, i) => (
          <div key={k} role="listitem" className="grid grid-cols-[96px_1fr_36px] items-center gap-2" title={HOTSPOT_META[k].blurb}>
            <span className="flex items-center gap-1.5 text-[11.5px] text-slate-300">
              <span
                className="h-2.5 w-2.5 rounded-[1px]"
                style={{ background: HOTSPOT_META[k].color, outline: HOTSPOT_META[k].outline === "none" ? undefined : `1.5px ${HOTSPOT_META[k].outline} #fff`, outlineOffset: -1 }}
              />
              {HOTSPOT_META[k].label}
            </span>
            <div className="h-3 rounded-[2px] bg-white/[0.04]">
              <motion.div className="h-full rounded-[2px]" style={{ background: HOTSPOT_META[k].color }} initial={{ width: 0 }} animate={{ width: `${(h.counts[k] / max) * 100}%` }} transition={{ delay: 0.05 * i, duration: 0.6 }} />
            </div>
            <span className="text-right font-mono text-[11px] tabular-nums text-slate-200">{h.counts[k]}</span>
          </div>
        ))}
        <div className="pt-1 font-mono text-[10px] text-slate-500">
          {total} of {h.cells.length} cells show a significant space-time pattern · families: {Object.values(HOTSPOT_FAMILY).map((f) => f.label.toLowerCase()).join(", ")}
        </div>
      </div>

      <div>
        <div className="eyebrow mb-1.5 !text-[9.5px] !text-slate-300">Most active hot-spot cells · click to zoom</div>
        <div className="divide-y divide-white/[0.05] rounded-[4px] border border-white/[0.07]">
          {h.ranked.slice(0, 8).map((c) => (
            <button
              key={c.cell}
              onClick={() => onFocus([c.lon - 0.375, c.lat - 0.375, c.lon + 0.375, c.lat + 0.375])}
              className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-2 font-mono text-[11px] text-slate-200">
                <Crosshair className="h-3 w-3 text-slate-500" />
                {c.lat.toFixed(2)}°N {c.lon.toFixed(2)}°E
              </span>
              <span className="text-[11px] text-slate-300">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-[1px]" style={{ background: HOTSPOT_META[c.category].color }} />
                {HOTSPOT_META[c.category].label}
              </span>
              <span className="w-24 text-right font-mono text-[10.5px] text-slate-400">~{fmt(c.meanFireDays)} fd/yr</span>
            </button>
          ))}
          {h.ranked.length === 0 && <div className="px-3 py-2 text-[11.5px] text-slate-500">No significant hot spots in this area.</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function OutlookTab({ analysis, outlook, target, onTarget }: { analysis: AoiAnalysis; outlook: OutlookMonth[]; target: number; onTarget: (i: number) => void }) {
  const h = useMemo(() => hindcast(analysis), [analysis]);
  const recent = analysis.months.filter((m) => !m.missing).slice(-24);
  const data = [
    ...recent.map((m) => ({ label: `${MONTHS[m.month - 1]} ${String(m.year).slice(2)}`, actual: m.harmonized })),
    ...outlook.map((o) => ({ label: `${MONTHS[o.month - 1]} ${String(o.year).slice(2)}`, expected: o.expected, range: [o.p10, o.p90] as [number, number], normal: o.normal })),
  ];
  const gap = outlook.length && recent.length ? `${recent[recent.length - 1].year}-${recent[recent.length - 1].month} → ${outlook[0].year}-${outlook[0].month}` : "";
  const hc = h.points.filter((p) => p.year >= h.years[1] - 2).map((p) => ({ label: `${MONTHS[p.month - 1]} ${String(p.year).slice(2)}`, actual: p.actual, predicted: p.predicted }));
  return (
    <div className="space-y-4 pb-2">
      <div className="grid grid-cols-3 gap-2">
        {outlook.map((o, i) => {
          const Icon = o.signal === "above" ? ArrowUpRight : o.signal === "below" ? ArrowDownRight : Minus;
          return (
            <button
              key={`${o.year}-${o.month}`}
              onClick={() => onTarget(i)}
              className={`rounded-[4px] border px-3 py-2 text-left transition-colors ${target === i ? "border-signal bg-nasa-blue/25" : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"}`}
              aria-pressed={target === i}
            >
              <div className="eyebrow !text-[9px]">
                {MONTHS[o.month - 1]} {o.year}
              </div>
              <div className="mt-1 text-[18px] font-semibold leading-none tabular-nums text-white">~{fmt(o.expected)}</div>
              <div className="mt-1 font-mono text-[9.5px] text-slate-500">
                likely {fmt(o.p10)}–{fmt(o.p90)} · normal {fmt(o.normal)}
              </div>
              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-200">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {o.signal === "above" ? "Above normal" : o.signal === "below" ? "Below normal" : "Near normal"} · {Math.round(o.probAbove * 100)}%
              </div>
            </button>
          );
        })}
      </div>

      <figure>
        <figcaption className="mb-1 flex flex-wrap items-center gap-3 text-[11px]">
          <span className="eyebrow !text-[9.5px] !text-slate-300">Recent months → outlook</span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="h-0.5 w-3 bg-flame" /> Observed
          </span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="h-0.5 w-3 border-t-2 border-dashed border-signal" /> Expected
          </span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="h-2 w-3 rounded-[1px] bg-signal/30" /> Likely range
          </span>
        </figcaption>
        <div className="h-[170px]">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={5} />
              <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
              <Tooltip {...tooltipStyle} formatter={(v: unknown, n?: unknown) => (Array.isArray(v) ? [`${fmt(v[0])} – ${fmt(v[1])}`, "Likely range"] : [fmt(v as number), String(n)])} />
              <Area dataKey="range" name="Likely range" stroke="none" fill="#4d8eff" fillOpacity={0.25} animationDuration={500} />
              <Line dataKey="actual" name="Observed" stroke="#ff7a1a" strokeWidth={2} dot={false} animationDuration={500} />
              <Line dataKey="expected" name="Expected" stroke="#4d8eff" strokeDasharray="4 3" strokeWidth={2} dot={{ r: 3, fill: "#4d8eff" }} animationDuration={500} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {gap && <p className="font-mono text-[9.5px] text-slate-500">Archive ends {gap.split(" → ")[0]}; outlook targets the next months from today ({gap.split(" → ")[1]}).</p>}
      </figure>

      <div className="rounded-[4px] border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-300">
          <ShieldCheck className="h-4 w-4" /> Validated on years the model never saw
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat label="Skill vs climatology" value={`${h.skill >= 0 ? "+" : ""}${Math.round(h.skill * 100)}%`} sub="lower error than 10-yr mean" tone={h.skill > 0 ? "text-emerald-300" : "text-slate-200"} />
          <Stat label="Range coverage" value={`${Math.round(h.coverage * 100)}%`} sub="actual inside likely range" />
          <Stat label="Mean abs. error" value={fmt(h.maeModel)} sub={`climatology ${fmt(h.maeClim)}`} />
        </div>
        <div className="mt-2 h-[110px]">
          <ResponsiveContainer>
            <ComposedChart data={hc} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={8} />
              <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
              <Tooltip {...tooltipStyle} formatter={(v: unknown, n?: unknown) => [fmt(v as number), String(n)]} />
              <Line dataKey="actual" name="Actual" stroke="#ff7a1a" strokeWidth={2} dot={false} animationDuration={500} />
              <Line dataKey="predicted" name="Hindcast" stroke="#4d8eff" strokeDasharray="4 3" strokeWidth={2} dot={false} animationDuration={500} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[10.5px] leading-snug text-slate-400">
          Hindcast {h.years[0]}–{h.years[1]}: each month predicted using only earlier years (last 3 years shown: orange actual, blue dashed hindcast). Model: exponentially weighted geometric mean, half-life 3 years, chosen on 2008–2014. No weather input, so use it for planning, not
          for daily alerts.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
const SENSORS: [number, string, string][] = [
  [1, "VIIRS · Suomi NPP", "#ffe08a"],
  [2, "VIIRS · NOAA-20", "#ff9a52"],
  [3, "VIIRS · NOAA-21", "#ff5a3f"],
  [0, "MODIS · Terra/Aqua", "#c084fc"],
];

export function LiveTab({ live, origin, analysis, bbox, onFocus }: { live: LiveFile | null; origin: string | null; analysis: AoiAnalysis; bbox: BBox; onFocus: (b: BBox) => void }) {
  const s = useMemo(() => (live ? liveSummary(live, analysis, bbox) : null), [live, analysis, bbox]);
  if (!live || !s) return <div className="py-6 text-center text-[12px] text-slate-500">Connecting to the NASA FIRMS live feed…</div>;
  const ch = s.change;
  const days = s.days.map((d) => ({ ...d, label: d.date.slice(5) }));
  return (
    <div className="space-y-4 pb-2">
      <div className="flex items-center gap-2 text-[11.5px] text-slate-300">
        <Radio className="h-4 w-4 text-nasa-red" />
        <span>
          {origin === "firms" ? "Fetched live from NASA FIRMS" : "FIRMS snapshot"} · updated {new Date(live.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Detections · 7 d" value={s.total} sub="all satellites, this area" />
        <Stat label="Last 24 h" value={s.last24h} sub={s.latest ? `newest ${s.latest.slice(11, 16)} UTC` : "—"} tone={s.last24h ? "text-nasa-red" : undefined} />
        <Stat label="S-NPP fire-days" value={s.snppFireDays} sub={`normal ≈ ${fmt(s.normalFireDays)} for 7 days`} />
        <Stat
          label="vs normal"
          value={ch === null ? "n/a" : `${ch >= 0 ? "+" : ""}${Math.round(ch * 100)}%`}
          sub={ch === null ? "season too quiet to compare" : ch > 0.5 ? "well above normal" : ch < -0.5 ? "well below normal" : "near normal"}
          tone={ch !== null && ch > 0.5 ? "text-nasa-red" : undefined}
        />
      </div>

      <figure>
        <figcaption className="eyebrow mb-1 !text-[9.5px] !text-slate-300">Detections per day (UTC) · this area</figcaption>
        <div className="h-[120px]">
          <ResponsiveContainer>
            <ComposedChart data={days} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="count" name="Detections" fill="#ff7a1a" radius={[4, 4, 0, 0]} barSize={16} animationDuration={500} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="eyebrow !text-[9.5px] !text-slate-300">By satellite</div>
          {SENSORS.map(([k, name, color]) => {
            const src = live.sources.find((x) => x.label === name);
            return (
              <div key={k} className="flex items-center justify-between text-[11.5px]">
                <span className="flex items-center gap-2 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  {name}
                </span>
                <span className="font-mono tabular-nums text-slate-200">{src && !src.ok ? "offline" : (s.bySensor[k] ?? 0)}</span>
              </div>
            );
          })}
        </div>
        <div>
          <div className="eyebrow mb-1.5 !text-[9.5px] !text-slate-300">Most intense fire</div>
          {s.hottest ? (
            <button onClick={() => onFocus([s.hottest!.lon - 0.3, s.hottest!.lat - 0.3, s.hottest!.lon + 0.3, s.hottest!.lat + 0.3])} className="w-full rounded-[4px] border border-white/[0.07] px-3 py-2 text-left hover:border-white/20">
              <div className="text-[17px] font-semibold text-white">{s.hottest.frp} MW</div>
              <div className="font-mono text-[10px] text-slate-400">
                {s.hottest.lat.toFixed(3)}°N {s.hottest.lon.toFixed(3)}°E · {s.hottest.when}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[10.5px] text-signal">
                <Crosshair className="h-3 w-3" /> Zoom to it
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-2 text-[11.5px] text-slate-400">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> No detections in this area this week.
            </div>
          )}
        </div>
      </div>
      <p className="text-[10.5px] leading-snug text-slate-500">
        Fire radiative power (FRP) measures how much heat a fire gives off. "vs normal" compares this week's S-NPP fire-days, counted exactly like the harmonized record, with recent years for this time of year.
      </p>
    </div>
  );
}
