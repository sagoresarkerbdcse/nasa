import { AnimatePresence, motion } from "framer-motion";
import { Atom, CalendarDays, Download, Flame, LineChart as LineIcon, Radio, Telescope, Zap } from "lucide-react";
import { analysisCsv, downloadText } from "../lib/download";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { OutlookMonth } from "../lib/analytics";
import { fmt, heat, powScale } from "../lib/color";
import { MONTHS } from "../lib/regions";
import type { AoiAnalysis, BBox, GridFile, InsightTab, LiveFile, MonthStat } from "../lib/types";
import { HotspotsTab, LiveTab, OutlookTab, TrendsTab, type HotspotSummary } from "./InsightTabs";

const TABS: { id: InsightTab; label: string; Icon: typeof CalendarDays }[] = [
  { id: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "trends", label: "Trends", Icon: LineIcon },
  { id: "hotspots", label: "Hot spots", Icon: Flame },
  { id: "outlook", label: "Outlook", Icon: Telescope },
  { id: "live", label: "Live", Icon: Radio },
  { id: "science", label: "Science", Icon: Atom },
];

interface Props {
  analysis: AoiAnalysis;
  meta: GridFile["meta"];
  harmonized: boolean;
  year: number;
  selected: { year: number; month: number } | null;
  onSelect: (m: MonthStat) => void;
  regionName: string;
  tab: InsightTab;
  onTab: (t: InsightTab) => void;
  hotspots: HotspotSummary;
  cellSize: number;
  bbox: BBox;
  live: LiveFile | null;
  liveOrigin: string | null;
  outlook: OutlookMonth[];
  outlookTarget: number;
  onOutlookTarget: (i: number) => void;
  onFocus: (b: BBox) => void;
  science: ReactNode;
}

export function CalendarPanel(p: Props) {
  const { analysis, meta, harmonized, year, selected, onSelect, regionName, tab, onTab: setTab } = p;
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
    <section className="panel flex h-full min-h-0 flex-col" aria-label="Fire calendar" data-guide="insights">
      <header className="panel-head flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="font-mono text-[10.5px] text-signal">02</span>
        <div className="mr-auto min-w-0">
          <h2 className="eyebrow !text-slate-200">Insights</h2>
          <p className="truncate text-[11.5px] text-slate-400">
            {regionName} · {harmonized ? "harmonized fire-days, VIIRS-equivalent" : `raw detections: MODIS until ${meta.viirsStartYear - 1}, then VIIRS`}
          </p>
        </div>
        <button
          onClick={() => downloadText(`firecal_${regionName.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_monthly.csv`, analysisCsv(analysis, regionName))}
          className="order-last grid h-7 w-7 place-items-center rounded-[4px] border border-white/10 text-slate-400 transition-colors hover:border-signal/60 hover:text-white sm:order-none"
          title="Download this area's monthly record (CSV, with 90% intervals)"
          aria-label="Download CSV"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <div className="flex max-w-full overflow-x-auto rounded-[4px] border border-white/10 bg-black/30 p-0.5 font-mono text-[10px] uppercase tracking-wider scroll-thin" role="tablist">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`relative flex shrink-0 items-center gap-1.5 rounded-[3px] px-2 py-1 ${tab === id ? "text-white" : "text-slate-400 hover:text-slate-200"}`}>
              {tab === id && <motion.span layoutId="cal-tab" className="absolute inset-0 rounded-[3px] bg-nasa-blue" />}
              <Icon className={`relative h-3 w-3 ${id === "live" && tab !== "live" ? "text-nasa-red" : ""}`} />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Anomaly pills */}
      <div className={`${tab === "calendar" ? "flex" : "hidden"} items-center gap-1.5 overflow-x-auto border-b border-white/[0.05] px-4 py-2 scroll-thin`}>
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
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pt-3">
              {tab === "trends" && <TrendsTab analysis={analysis} meta={meta} harmonized={harmonized} />}
              {tab === "hotspots" && <HotspotsTab summary={p.hotspots} cellSize={p.cellSize} onFocus={p.onFocus} />}
              {tab === "outlook" && <OutlookTab analysis={analysis} outlook={p.outlook} target={p.outlookTarget} onTarget={p.onOutlookTarget} />}
              {tab === "science" && p.science}
              {tab === "live" &&
                (p.live ? (
                  <LiveTab live={p.live} origin={p.liveOrigin} analysis={analysis} bbox={p.bbox} onFocus={p.onFocus} />
                ) : (
                  <p className="py-6 text-center text-[12px] leading-relaxed text-slate-400">The live 7-day FIRMS feed covers the Bangladesh study area. Choose Bangladesh in the sidebar to see live fires.</p>
                ))}
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
