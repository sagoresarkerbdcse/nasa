import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalystPanel, type ExportState, type Health } from "./components/AnalystPanel";
import { BootScreen } from "./components/BootScreen";
import { CalendarPanel } from "./components/CalendarPanel";
import { Header } from "./components/Header";
import { KpiStrip } from "./components/KpiStrip";
import { MapPanel } from "./components/MapPanel";
import { Tour, type TourControls, type TourFacts } from "./components/Tour";
import { hindcast, hotspotsInBBox, outlook as runOutlook, seasonTiming } from "./lib/analytics";
import { analyzeAoi } from "./lib/harmonize";
import { MONTHS_LONG, REGIONS, formatBBox } from "./lib/regions";
import type { BBox, GridFile, InsightTab, LiveFile, MapLayer, MonthStat, PointsFile, SensorView } from "./lib/types";
import { useAnalyst } from "./lib/useAnalyst";

const ExplainPage = lazy(() => import("./explain/ExplainPage"));

export function App() {
  const isExplain = typeof window !== "undefined" && /^\/explain\/?$/.test(window.location.pathname);
  if (isExplain)
    return (
      <Suspense fallback={<div className="grid h-full place-items-center text-sm text-slate-400">Loading stories…</div>}>
        <ExplainPage />
      </Suspense>
    );
  return <DashboardApp />;
}

function DashboardApp() {
  const [grid, setGrid] = useState<GridFile | null>(null);
  const [points, setPoints] = useState<PointsFile | null>(null);
  const [live, setLive] = useState<{ data: LiveFile; origin: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    fetch("/data/grid.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`grid.json: HTTP ${r.status}`))))
      .then(setGrid)
      .catch((e) => setError(String(e.message ?? e)));
    fetch("/data/points.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => p && setPoints(p))
      .catch(() => {});
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ llm: false, model: null }));
    // Live: API (fetches FIRMS, 15-min cache) → committed snapshot.
    fetch("/api/live")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setLive({ data: d, origin: d.origin ?? "firms" }))
      .catch(() =>
        fetch("/data/live.json")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && setLive({ data: d, origin: "snapshot" }))
          .catch(() => {}),
      );
  }, []);

  const done = useCallback(() => setBooted(true), []);

  return (
    <div className="space-bg min-h-full lg:h-full">
      {grid && <Dashboard grid={grid} points={points} health={health} live={live} />}
      <AnimatePresence>{!booted && <BootScreen key="boot" ready={Boolean(grid)} error={error} onDone={done} />}</AnimatePresence>
    </div>
  );
}

const enter = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.15 + i * 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
});

const TAB_LAYER: Record<InsightTab, MapLayer> = { calendar: "activity", trends: "activity", hotspots: "hotspots", outlook: "outlook", live: "live" };

/** Initial state from the URL hash, e.g. #r=cht&y=2023&m=4&l=anomaly&t=calendar */
function readHash() {
  const h = new URLSearchParams(window.location.hash.slice(1));
  const num = (k: string) => (h.get(k) && Number.isFinite(Number(h.get(k))) ? Number(h.get(k)) : undefined);
  const bbox = h.get("b")?.split(",").map(Number);
  return {
    r: h.get("r") ?? undefined,
    b: bbox && bbox.length === 4 && bbox.every(Number.isFinite) ? (bbox as BBox) : undefined,
    y: num("y"),
    m: num("m"),
    l: (h.get("l") as MapLayer) ?? undefined,
    t: (h.get("t") as InsightTab) ?? undefined,
    v: (h.get("v") as SensorView) ?? undefined,
    g: h.get("3d") === "1",
    h: h.get("h") !== "0",
    present: h.has("present"),
  };
}

function Dashboard({ grid, points, health, live }: { grid: GridFile; points: PointsFile | null; health: Health | null; live: { data: LiveFile; origin: string } | null }) {
  const init = useRef(readHash()).current;
  const [regionId, setRegionId] = useState(init.b ? "custom" : init.r && REGIONS.some((r) => r.id === init.r) ? init.r : "domain");
  const [customBBox, setCustomBBox] = useState<BBox | null>(init.b ?? null);
  const [view, setView] = useState<SensorView>(init.v && ["harmonized", "modis", "viirs"].includes(init.v) ? init.v : "harmonized");
  const [year, setYear] = useState(init.y && init.y >= grid.meta.firstYear && init.y <= grid.meta.lastYear ? init.y : grid.meta.lastMonth === 12 ? grid.meta.lastYear : grid.meta.lastYear - 1);
  const [month, setMonth] = useState<number | null>(init.m && init.m >= 1 && init.m <= 12 ? init.m : null);
  const [playing, setPlaying] = useState(false);
  const [harmonized, setHarmonized] = useState(init.h);
  const [selected, setSelected] = useState<{ year: number; month: number } | null>(null);
  const [layer, setLayer] = useState<MapLayer>(init.l && Object.values(TAB_LAYER).includes(init.l) ? init.l : init.l === "anomaly" ? "anomaly" : "activity");
  const [tab, setTabState] = useState<InsightTab>(init.t && init.t in TAB_LAYER ? init.t : "calendar");
  const [view3d, setView3d] = useState(init.g);
  const [outlookIdx, setOutlookIdx] = useState(0);
  const [analystOpen, setAnalystOpen] = useState(true);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [about, setAbout] = useState(false);
  const [presenting, setPresenting] = useState(init.present);

  const setTab = useCallback((t: InsightTab) => {
    setTabState(t);
    setLayer((l) => (t === "calendar" || t === "trends" ? (l === "anomaly" ? l : "activity") : TAB_LAYER[t]));
  }, []);

  // The analyst can drive the dashboard through `update_dashboard`.
  const onAction = useCallback((a: Record<string, unknown>) => {
    if (typeof a.regionId === "string") {
      setRegionId(a.regionId);
      setSelected(null);
    } else if (Array.isArray(a.bbox) && a.bbox.length === 4) {
      setCustomBBox(a.bbox as BBox);
      setRegionId("custom");
    }
    if (typeof a.year === "number") setYear(a.year);
    if (a.month === null || typeof a.month === "number") setMonth(a.month as number | null);
    if (typeof a.tab === "string") setTabState(a.tab as InsightTab);
    if (typeof a.layer === "string") setLayer(a.layer as MapLayer);
    else if (typeof a.tab === "string") setLayer(TAB_LAYER[a.tab as InsightTab]);
    if (typeof a.view3d === "boolean") setView3d(a.view3d);
    if (typeof a.year === "number" && typeof a.month === "number") setSelected({ year: a.year, month: a.month });
    setPlaying(false);
  }, []);
  const analyst = useAnalyst(onAction);

  const region = REGIONS.find((r) => r.id === regionId);
  const bbox: BBox = regionId === "custom" && customBBox ? customBBox : (region ?? REGIONS[REGIONS.length - 1]).bbox;
  const regionName = regionId === "custom" ? `Custom AOI (${formatBBox(bbox)})` : region!.name;
  const regionShort = regionId === "custom" ? "this area" : region!.short === "Full domain" ? "Bangladesh" : region!.short;
  const bboxKey = bbox.join(",");
  const analysis = useMemo(() => analyzeAoi(grid, bbox), [grid, bboxKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedStat = selected ? analysis.months.find((m) => m.year === selected.year && m.month === selected.month) : undefined;

  const outlookTargets = useMemo(() => {
    const now = new Date();
    return [1, 2, 3].map((i) => {
      const idx = now.getUTCFullYear() * 12 + now.getUTCMonth() + i;
      return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
    });
  }, []);
  const outlook = useMemo(() => runOutlook(analysis, outlookTargets), [analysis, outlookTargets]);
  const target = outlook[outlookIdx] ?? outlook[0];
  const outlookScale = target && target.normal > 0 ? target.expected / target.normal : 1;

  // Keep the URL shareable.
  useEffect(() => {
    const h = new URLSearchParams();
    if (regionId === "custom" && customBBox) h.set("b", customBBox.join(","));
    else h.set("r", regionId);
    h.set("y", String(year));
    if (month) h.set("m", String(month));
    if (layer !== "activity") h.set("l", layer);
    if (tab !== "calendar") h.set("t", tab);
    if (view !== "harmonized") h.set("v", view);
    if (view3d) h.set("3d", "1");
    if (!harmonized) h.set("h", "0");
    window.history.replaceState(null, "", `#${h.toString()}`);
  }, [regionId, customBBox, year, month, layer, tab, view, view3d, harmonized]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setYear((y) => (y >= grid.meta.lastYear ? grid.meta.firstYear : y + 1)), 1100);
    return () => clearInterval(id);
  }, [playing, grid.meta.firstYear, grid.meta.lastYear]);

  const base = { bbox, regionName };
  const explain = useCallback(
    (m: MonthStat) => {
      setAnalystOpen(true);
      analyst.ask({ ...base, mode: "insight", focus: { year: m.year, month: m.month } });
    },
    [analyst, bboxKey, regionName], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onSelect = (m: MonthStat) => {
    if (m.missing) return;
    setSelected({ year: m.year, month: m.month });
    setYear(m.year);
    setMonth(m.month);
    setPlaying(false);
    if (m.anomaly) explain(m);
  };

  const changeRegion = (id: string) => {
    setRegionId(id);
    setSelected(null);
  };
  const focusBBox = (b: BBox) => {
    setCustomBBox(b.map((v) => Math.round(v * 100) / 100) as BBox);
    setRegionId("custom");
    setSelected(null);
  };

  const exportPdf = async () => {
    let brief = [...analyst.messages].reverse().find((m) => m.kind === "brief" && !m.streaming && m.regionName === regionName && m.content.length > 200)?.content;
    if (!brief) {
      setAnalystOpen(true);
      setExportState("drafting");
      brief = await analyst.ask({ ...base, mode: "brief" }, "Generate Responder Early-Warning Brief.");
    }
    if (!brief) {
      setExportState("idle");
      return;
    }
    setExportState("rendering");
    const { downloadBriefPdf } = await import("./lib/pdf");
    downloadBriefPdf({ brief, regionName, analysis, meta: grid.meta });
    setExportState("done");
    setTimeout(() => setExportState("idle"), 2400);
  };

  // Presentation facts (computed for the whole study area so captions are stable).
  const facts = useMemo((): TourFacts => {
    const dom = analyzeAoi(grid, REGIONS[REGIONS.length - 1].bbox);
    const s = seasonTiming(dom);
    const h = hotspotsInBBox(grid, dom.bbox);
    const ov = dom.annual.filter((y) => y.year >= grid.meta.viirsStartYear);
    const pre = dom.annual.filter((y) => y.year < grid.meta.viirsStartYear).slice(-3);
    const post = ov.slice(0, 3);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
    const full = dom.annual.filter((y) => y.year < grid.meta.lastYear || grid.meta.lastMonth === 12);
    const first6 = mean(full.slice(0, 6).map((y) => y.harmonized));
    const last6 = mean(full.slice(-6).map((y) => y.harmonized));
    return {
      firstYear: grid.meta.firstYear,
      lastYear: grid.meta.lastYear,
      detections: dom.totals.modisRaw + dom.totals.viirsRaw,
      naiveJump: Math.round((mean(post.map((y) => y.naive)) / Math.max(1, mean(pre.map((y) => y.naive)))) * 10) / 10,
      k: dom.k,
      declinePct: first6 > 0 ? Math.round(((last6 - first6) / first6) * 100) : null,
      onsetDaysPerDecade: s.trends.onset.significant ? Math.round(s.trends.onset.senSlope * 10) : null,
      persistent: h.counts.persistent + h.counts.intensifying,
      diminishing: h.counts.diminishing + h.counts.historical,
      topAnomaly: dom.anomalies[0],
      outlookSkill: hindcast(dom).skill,
      liveCount: live ? live.data.detections.length : null,
    };
  }, [grid, live]);

  const controls: TourControls = {
    region: changeRegion,
    year: setYear,
    month: setMonth,
    layer: setLayer,
    tab: setTabState,
    view3d: setView3d,
    harmonized: setHarmonized,
    playing: setPlaying,
    select: (m) => {
      setSelected({ year: m.year, month: m.month });
      setYear(m.year);
      setMonth(m.month);
    },
  };

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <Header meta={grid.meta} harmonized={harmonized} onHarmonized={setHarmonized} onAbout={() => setAbout(true)} onPresent={() => setPresenting(true)} />

      <motion.div {...enter(0)} className="px-3 pt-3 lg:px-4">
        <KpiStrip analysis={analysis} meta={grid.meta} harmonized={harmonized} regionName={regionName} onAnomaly={() => analysis.anomalies[0] && onSelect(analysis.anomalies[0])} />
      </motion.div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,57fr)_minmax(0,43fr)] lg:px-4">
        <motion.div {...enter(1)} className="h-[66vh] min-h-[500px] lg:h-auto lg:min-h-0">
          <MapPanel
            grid={grid}
            points={points}
            bbox={bbox}
            regionId={regionId}
            regionName={regionName}
            onRegion={changeRegion}
            onCustomBBox={focusBBox}
            view={view}
            onView={setView}
            year={year}
            onYear={(y) => {
              setYear(y);
              setPlaying(false);
            }}
            month={month}
            onMonth={setMonth}
            playing={playing}
            onPlaying={setPlaying}
            layer={layer}
            onLayer={setLayer}
            view3d={view3d}
            onView3d={setView3d}
            live={live?.data ?? null}
            outlookTarget={target ?? { year, month: 1 }}
            outlookScale={outlookScale}
          />
        </motion.div>

        <div className="flex min-h-0 flex-col gap-3">
          <motion.div {...enter(2)} layout className={`min-h-[440px] ${analystOpen ? "lg:min-h-0 lg:flex-[1.15]" : "lg:min-h-0 lg:flex-1"}`}>
            <CalendarPanel
              analysis={analysis}
              meta={grid.meta}
              harmonized={harmonized}
              year={year}
              selected={selected}
              onSelect={onSelect}
              regionName={regionName}
              tab={tab}
              onTab={setTab}
              grid={grid}
              bbox={bbox}
              live={live?.data ?? null}
              liveOrigin={live?.origin ?? null}
              outlook={outlook}
              outlookTarget={outlookIdx}
              onOutlookTarget={(i) => {
                setOutlookIdx(i);
                setLayer("outlook");
              }}
              onFocus={focusBBox}
            />
          </motion.div>
          <motion.div {...enter(3)} layout className={analystOpen ? "h-[520px] lg:h-auto lg:min-h-0 lg:flex-1" : "shrink-0"}>
            <AnalystPanel
              messages={analyst.messages}
              busy={analyst.busy}
              open={analystOpen}
              onToggle={() => setAnalystOpen((o) => !o)}
              onAsk={(q) => analyst.ask({ ...base, mode: "chat", question: q }, q)}
              onBrief={() => analyst.ask({ ...base, mode: "brief" }, "Generate Responder Early-Warning Brief.")}
              onExplain={explain}
              onExport={exportPdf}
              onClear={analyst.clear}
              exportState={exportState}
              regionShort={regionShort}
              topAnomaly={analysis.anomalies[0]}
              selectedMonth={selectedStat}
              health={health}
              budget={analyst.budget}
            />
          </motion.div>
        </div>
      </main>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] px-4 py-2 font-mono text-[9.5px] uppercase tracking-wider text-slate-500">
        <span>Data · NASA FIRMS MODIS C6.1 + VIIRS (S-NPP, NOAA-20, NOAA-21)</span>
        <span>Imagery · NASA GIBS</span>
        <span className="hidden md:inline">Record {grid.meta.firstYear}–{grid.meta.lastYear} + live 7 days</span>
        <a href="/explain" className="text-signal hover:underline">
          Explain it to me →
        </a>
        <span className="ml-auto normal-case tracking-normal">Independent project for the NASA Space Apps Challenge 2026 · not affiliated with or endorsed by NASA</span>
      </footer>

      <AnimatePresence>{about && <AboutModal meta={grid.meta} k={analysis.k} onClose={() => setAbout(false)} />}</AnimatePresence>
      {presenting && <Tour facts={facts} controls={controls} onClose={() => setPresenting(false)} />}
    </div>
  );
}

function AboutModal({ meta, k, onClose }: { meta: GridFile["meta"]; k: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const steps: [string, string][] = [
    ["Confidence filter", `Low-confidence detections are dropped (MODIS < 30%, VIIRS "low"), along with static industrial sources such as gas flares and brick kilns, and offshore detections.`],
    ["Common-grid fire-days", `Each detection is snapped to a ${meta.fireDayGrid}° (~1 km) grid. We count unique cell × day pairs, so several 375 m VIIRS pixels on one fire count once.`],
    ["Overlap calibration", `From ${meta.viirsStartYear}, both sensors fly. The ratio of VIIRS to MODIS fire-days (k = ${k} for this area) lifts the MODIS-only years (${meta.firstYear}–${meta.viirsStartYear - 1}) to VIIRS-equivalent units.`],
    ["Anomalies and trends", "Each month is compared with the same month over the previous 10 years (z-score and % change, with an over-dispersed counting-noise floor). Trends use Mann-Kendall and Sen's slope."],
    ["Emerging hot spots", "Getis-Ord Gi* per 0.25° cell and year (queen neighbours), then Mann-Kendall on the Gi* scores, sorted into intensifying, persistent, diminishing, new, consecutive, sporadic and historical hot spots."],
    ["Season timing", "For each fire-year, the dates when 10%, 50% and 90% of the fire-days are reached give onset, peak and end. Their trends show whether the season is shifting."],
    ["Outlook", "An exponentially weighted geometric mean of past years (half-life 3 years, chosen on 2008–2014). It is validated on held-out 2015–2024 against the 10-year average, and its range comes from the model's own past errors."],
    ["Live", "The last 7 days of FIRMS detections from VIIRS (S-NPP, NOAA-20, NOAA-21) and MODIS, compared with normal using the same fire-day definition."],
  ];
  return (
    <motion.div className="fixed inset-0 z-[2000] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="About FireCal AI"
        className="panel hud max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6 scroll-thin"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="eyebrow">Methodology</div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">From two sensors to decisions</h2>
          </div>
          <button onClick={onClose} className="rounded-[3px] p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ol className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
          {steps.map(([title, body], i) => (
            <motion.li key={title} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.06 * i }} className="flex gap-4 py-3">
              <span className="font-mono text-sm text-signal">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <div className="text-sm font-semibold text-white">{title}</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-slate-400">{body}</p>
              </div>
            </motion.li>
          ))}
        </ol>
        <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-slate-500">
          Record: {MONTHS_LONG[0]} {meta.firstYear} – {MONTHS_LONG[meta.lastMonth - 1]} {meta.lastYear}. {meta.notes}
        </p>
      </motion.div>
    </motion.div>
  );
}
