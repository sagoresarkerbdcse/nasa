import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, LineChart as LineIcon, Zap } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, heat, powScale } from "../lib/color";
import { MONTHS } from "../lib/regions";
import type { AoiAnalysis, GridFile, MonthStat } from "../lib/types";

interface Props {
  analysis: AoiAnalysis;
  meta: GridFile["meta"];
  harmonized: boolean;
  year: number;
  selected: { year: number; month: number } | null;
  onSelect: (m: MonthStat) => void;
  regionName: string;
}

export function CalendarPanel({ analysis, meta, harmonized, year, selected, onSelect, regionName }: Props) {
  const [tab, setTab] = useState<"calendar" | "annual">("calendar");
  const [hover, setHover] = useState<{ m: MonthStat; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Show the popover below the cell when there's no room above it.
  const flip = hover ? hover.y - (wrap.current?.scrollTop ?? 0) < 150 : false;
  const val = (m: MonthStat) => (harmonized ? m.harmonized : m.naive);
  const max = useMemo(() => Math.max(1, ...analysis.months.map(val)), [analysis, harmonized]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    const out: MonthStat[][] = [];
    for (let y = meta.lastYear; y >= meta.firstYear; y--) out.push(analysis.months.filter((m) => m.year === y));
    return out;
  }, [analysis, meta]);

  return (
    <section className="panel flex h-full min-h-0 flex-col" aria-label="Fire calendar">
      <header className="panel-head flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="font-mono text-[10.5px] text-signal">02</span>
        <div className="mr-auto min-w-0">
          <h2 className="eyebrow !text-slate-200">Burning activity calendar</h2>
          <p className="truncate text-[11.5px] text-slate-400">
            {regionName} · {harmonized ? "harmonized fire-days, VIIRS-equivalent" : `raw detections: MODIS until ${meta.viirsStartYear - 1}, then VIIRS`}
          </p>
        </div>
        <div className="flex rounded-[4px] border border-white/10 bg-black/30 p-0.5 font-mono text-[10px] uppercase tracking-wider">
          {(
            [
              ["calendar", "Matrix", CalendarDays],
              ["annual", "Annual", LineIcon],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)} className={`relative flex items-center gap-1.5 rounded-[3px] px-2.5 py-1 ${tab === id ? "text-white" : "text-slate-400 hover:text-slate-200"}`}>
              {tab === id && <motion.span layoutId="cal-tab" className="absolute inset-0 rounded-[3px] bg-nasa-blue" />}
              <Icon className="relative h-3 w-3" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Anomaly pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/[0.05] px-4 py-2 scroll-thin">
        <span className="eyebrow shrink-0 pr-1 !text-[9.5px]">Anomalies</span>
        {analysis.anomalies.length === 0 && <span className="font-mono text-[10.5px] text-slate-500">None detected for this area</span>}
        {analysis.anomalies.slice(0, 6).map((m) => {
          const active = selected?.year === m.year && selected.month === m.month;
          return (
            <motion.button
              key={`${m.year}-${m.month}`}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => onSelect(m)}
              className={`flex shrink-0 items-center gap-1.5 rounded-[3px] border px-2 py-1 font-mono text-[10.5px] transition-shadow ${
                m.anomaly === "extreme" ? "border-nasa-red/60 bg-nasa-red/10 text-red-200 shadow-[0_0_14px_rgba(252,61,33,0.3)]" : "border-solar/50 bg-solar/10 text-amber-200"
              } ${active ? "ring-1 ring-white" : ""}`}
            >
              <Zap className="h-3 w-3" />
              {MONTHS[m.month - 1]} {m.year}
              <span className="font-semibold">+{m.pctVsBaseline}%</span>
              <span className="hidden opacity-60 sm:inline">vs 10-yr</span>
            </motion.button>
          );
        })}
      </div>

      <div ref={wrap} className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-3 scroll-thin" onMouseLeave={() => setHover(null)}>
        <AnimatePresence mode="wait">
          {tab === "calendar" ? (
            <motion.div key="cal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="sticky top-0 z-10 grid grid-cols-[38px_repeat(12,minmax(0,1fr))] gap-[3px] bg-[#0c1016]/95 pb-1 pt-2 backdrop-blur">
                <span />
                {MONTHS.map((m) => (
                  <span key={m} className="text-center font-mono text-[9.5px] uppercase text-slate-500">
                    {m[0]}
                    <span className="hidden xl:inline">{m.slice(1)}</span>
                  </span>
                ))}
              </div>
              {rows.map((row, ri) => {
                const y = row[0].year;
                return (
                  <motion.div key={`${y}-${regionName}-${harmonized}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(ri * 0.022, 0.5), duration: 0.35, ease: "easeOut" }}>
                    {y === meta.viirsStartYear - 1 && (
                      <div className="my-1.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-signal">
                        <span className="h-px flex-1 bg-signal/30" /> ▲ VIIRS 375 m era · MODIS-only ▼ <span className="h-px flex-1 bg-signal/30" />
                      </div>
                    )}
                    <div className={`grid grid-cols-[38px_repeat(12,minmax(0,1fr))] items-center gap-[3px] py-[1.5px] ${y === year ? "bg-signal/[0.07] shadow-[inset_2px_0_0_#4d8eff]" : ""}`}>
                      <span className={`pl-1 font-mono text-[10px] tabular-nums ${y === year ? "text-white" : "text-slate-500"}`}>{y}</span>
                      {row.map((m) => {
                        const v = val(m);
                        const t = powScale(v, max);
                        const isSel = selected?.year === m.year && selected.month === m.month;
                        return (
                          <motion.button
                            key={m.month}
                            disabled={m.missing}
                            whileHover={m.missing ? undefined : { scale: t > 0.6 ? 1.35 : 1.2, zIndex: 5 }}
                            onMouseEnter={(e) => {
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const w = wrap.current!.getBoundingClientRect();
                              setHover({ m, x: r.left - w.left + r.width / 2, y: r.top - w.top + wrap.current!.scrollTop });
                            }}
                            onClick={() => onSelect(m)}
                            aria-label={`${MONTHS[m.month - 1]} ${m.year}: ${fmt(v)}`}
                            className={`relative h-4 rounded-[2px] ${m.missing ? "border border-dashed border-white/10" : ""} ${
                              m.anomaly === "extreme" ? "cell-extreme" : m.anomaly ? "cell-anomaly" : ""
                            } ${isSel ? "outline outline-2 outline-offset-1 outline-signal" : ""} ${t > 0.75 ? "hover:animate-pulse" : ""}`}
                            style={{ background: m.missing ? "transparent" : v > 0 ? heat(0.12 + 0.88 * t) : "rgba(255,255,255,0.035)" }}
                          />
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
              <div className="mt-2.5 flex flex-wrap items-center gap-3 font-mono text-[9.5px] uppercase tracking-wider text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[1px] cell-anomaly" style={{ background: heat(0.6) }} /> significant anomaly
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[1px] cell-extreme" style={{ background: heat(0.8) }} /> extreme
                </span>
                <span className="ml-auto normal-case tracking-normal">γ 0.45 scale · max {fmt(max)}</span>
              </div>
            </motion.div>
          ) : (
            <motion.div key="annual" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full min-h-[260px]">
              <AnnualChart analysis={analysis} meta={meta} harmonized={harmonized} />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {hover && tab === "calendar" && (
            <motion.div
              key={`${hover.m.year}-${hover.m.month}`}
              initial={{ opacity: 0, y: 4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className={`pointer-events-none absolute z-20 w-52 -translate-x-1/2 rounded-[4px] border border-white/12 border-l-2 border-l-flame bg-[#080b10]/97 p-2.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.9)] ${flip ? "" : "-translate-y-full"}`}
              style={{ left: Math.min(Math.max(hover.x, 110), (wrap.current?.clientWidth ?? 300) - 110), top: flip ? hover.y + 24 : hover.y - 8 }}
            >
              <CellPopover m={hover.m} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function CellPopover({ m }: { m: MonthStat }) {
  if (m.missing) return <div className="text-xs text-slate-400">{MONTHS[m.month - 1]} {m.year}: no data yet</div>;
  const rows: [string, string][] = [
    ["Total hotspots", (m.modisRaw + m.viirsRaw).toLocaleString()],
    ["Harmonized fire-days", fmt(m.harmonized)],
    ["Confidence index (HCI)", `${m.hci}/100`],
    ["MODIS : VIIRS", `${m.modisRaw} : ${m.viirsRaw}${m.ratio ? ` (×${m.ratio})` : ""}`],
    ["vs 10-yr avg", m.pctVsBaseline === null ? "n/a" : `${m.pctVsBaseline >= 0 ? "+" : ""}${m.pctVsBaseline}%`],
  ];
  return (
    <>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-bold text-white">
          {MONTHS[m.month - 1]} {m.year}
        </span>
        {m.anomaly && (
          <span className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${m.anomaly === "extreme" ? "bg-nasa-red/25 text-red-200" : "bg-solar/20 text-amber-200"}`}>{m.anomaly}</span>
        )}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 py-[1px] text-[10.5px]">
          <span className="text-slate-400">{k}</span>
          <span className="font-mono text-slate-100">{v}</span>
        </div>
      ))}
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-nasa-blue to-cyan" style={{ width: `${m.hci}%` }} />
      </div>
    </>
  );
}

function AnnualChart({ analysis, meta, harmonized }: { analysis: AoiAnalysis; meta: GridFile["meta"]; harmonized: boolean }) {
  const data = analysis.annual.map((a) => ({ ...a, harmonized: Math.round(a.harmonized), partial: a.year === meta.lastYear && meta.lastMonth < 12 }));
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex flex-wrap gap-3 text-[10.5px]">
        <span className={`flex items-center gap-1.5 ${harmonized ? "text-orange-300" : "text-slate-500"}`}>
          <span className="h-2 w-3 rounded-sm bg-gradient-to-r from-ember to-solar" /> Harmonized fire-days
        </span>
        <span className={`flex items-center gap-1.5 ${!harmonized ? "text-blue-300" : "text-slate-500"}`}>
          <span className="h-0.5 w-3 border-t-2 border-dashed border-signal" /> Naive raw counts
        </span>
        <span className="ml-auto font-mono text-slate-400">
          Trend: {analysis.trend.direction} (p={analysis.trend.pValue})
        </span>
      </div>
      <div className="min-h-[220px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="harmFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff7a1a" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "DM Mono" }} tickLine={false} axisLine={false} interval={4} />
            <YAxis tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "DM Mono" }} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
            <Tooltip
              contentStyle={{ background: "rgba(8,11,16,0.97)", border: "1px solid rgba(249,115,22,0.3)", borderRadius: 4, fontSize: 11, fontFamily: "DM Mono" }}
              labelStyle={{ color: "#fff", fontWeight: 700 }}
            />
            <ReferenceLine x={meta.viirsStartYear} stroke="#4d8eff" strokeDasharray="3 3" label={{ value: "VIIRS starts", fill: "#4d8eff", fontSize: 9, position: "insideTopLeft" }} />
            <Area animationDuration={500} type="monotone" dataKey="harmonized" name="Harmonized" stroke="#ff7a1a" strokeWidth={harmonized ? 2.5 : 1.5} fill="url(#harmFill)" fillOpacity={harmonized ? 1 : 0.35} />
            <Line animationDuration={500} type="monotone" dataKey="naive" name="Naive raw" stroke="#4d8eff" strokeDasharray="5 4" strokeWidth={harmonized ? 1.2 : 2.2} dot={false} strokeOpacity={harmonized ? 0.55 : 1} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10.5px] leading-snug text-slate-400">
        The dashed line jumps about {rawRatio(analysis, meta.viirsStartYear)}× when VIIRS starts in {meta.viirsStartYear}. That jump comes from the sensor, not from more fire. After harmonization (k = {analysis.k}), all {meta.lastYear - meta.firstYear + 1} years are comparable.
      </p>
    </div>
  );
}

/** VIIRS raw / MODIS raw over the years both sensors fly. */
function rawRatio(a: AoiAnalysis, from: number) {
  const ov = a.annual.filter((y) => y.year >= from);
  const m = ov.reduce((s, y) => s + y.modisRaw, 0);
  const v = ov.reduce((s, y) => s + y.viirsRaw, 0);
  return m ? Math.round((v / m) * 10) / 10 : "n/a";
}
