import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalystPanel, type ExportState } from "./components/AnalystPanel";
import { BootScreen } from "./components/BootScreen";
import { CalendarPanel } from "./components/CalendarPanel";
import { Header } from "./components/Header";
import { KpiStrip } from "./components/KpiStrip";
import { MapPanel } from "./components/MapPanel";
import { analyzeAoi } from "./lib/harmonize";
import { MONTHS_LONG, REGIONS, formatBBox } from "./lib/regions";
import type { BBox, GridFile, MonthStat, PointsFile, SensorView } from "./lib/types";
import { useAnalyst } from "./lib/useAnalyst";

type Health = { llm: boolean; model: string | null };

export function App() {
  const [grid, setGrid] = useState<GridFile | null>(null);
  const [points, setPoints] = useState<PointsFile | null>(null);
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
  }, []);

  const done = useCallback(() => setBooted(true), []);

  return (
    <div className="space-bg min-h-full lg:h-full">
      {grid && <Dashboard grid={grid} points={points} health={health} />}
      <AnimatePresence>{!booted && <BootScreen key="boot" ready={Boolean(grid)} error={error} onDone={done} />}</AnimatePresence>
    </div>
  );
}

const enter = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.15 + i * 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
});

function Dashboard({ grid, points, health }: { grid: GridFile; points: PointsFile | null; health: Health | null }) {
  const [regionId, setRegionId] = useState("domain");
  const [customBBox, setCustomBBox] = useState<BBox | null>(null);
  const [view, setView] = useState<SensorView>("harmonized");
  const [year, setYear] = useState(grid.meta.lastMonth === 12 ? grid.meta.lastYear : grid.meta.lastYear - 1);
  const [month, setMonth] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [harmonized, setHarmonized] = useState(true);
  const [selected, setSelected] = useState<{ year: number; month: number } | null>(null);
  const [analystOpen, setAnalystOpen] = useState(true);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [about, setAbout] = useState(false);
  const analyst = useAnalyst();

  const region = REGIONS.find((r) => r.id === regionId);
  const bbox: BBox = regionId === "custom" && customBBox ? customBBox : (region ?? REGIONS[REGIONS.length - 1]).bbox;
  const regionName = regionId === "custom" ? `Custom AOI (${formatBBox(bbox)})` : region!.name;
  const regionShort = regionId === "custom" ? "this area" : region!.short === "Full domain" ? "Bangladesh" : region!.short;
  const analysis = useMemo(() => analyzeAoi(grid, bbox), [grid, bbox.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedStat = selected ? analysis.months.find((m) => m.year === selected.year && m.month === selected.month) : undefined;

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
    [analyst, bbox.join(","), regionName], // eslint-disable-line react-hooks/exhaustive-deps
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
    const { downloadBriefPdf } = await import("./lib/pdf"); // jsPDF is large; load on demand
    downloadBriefPdf({ brief, regionName, analysis, meta: grid.meta });
    setExportState("done");
    setTimeout(() => setExportState("idle"), 2400);
  };

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <Header meta={grid.meta} harmonized={harmonized} onHarmonized={setHarmonized} onAbout={() => setAbout(true)} />

      <motion.div {...enter(0)} className="px-3 pt-3 lg:px-4">
        <KpiStrip analysis={analysis} meta={grid.meta} harmonized={harmonized} regionName={regionName} onAnomaly={() => analysis.anomalies[0] && onSelect(analysis.anomalies[0])} />
      </motion.div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] lg:px-4">
        <motion.div {...enter(1)} className="h-[64vh] min-h-[480px] lg:h-auto lg:min-h-0">
          <MapPanel
            grid={grid}
            points={points}
            bbox={bbox}
            regionId={regionId}
            regionName={regionName}
            onRegion={changeRegion}
            onCustomBBox={(b) => {
              setCustomBBox(b);
              setRegionId("custom");
              setSelected(null);
            }}
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
          />
        </motion.div>

        <div className="flex min-h-0 flex-col gap-3">
          <motion.div {...enter(2)} layout className={`min-h-[400px] ${analystOpen ? "lg:min-h-0 lg:flex-[1.1]" : "lg:min-h-0 lg:flex-1"}`}>
            <CalendarPanel analysis={analysis} meta={grid.meta} harmonized={harmonized} year={year} selected={selected} onSelect={onSelect} regionName={regionName} />
          </motion.div>
          <motion.div {...enter(3)} layout className={analystOpen ? "h-[500px] lg:h-auto lg:min-h-0 lg:flex-1" : "shrink-0"}>
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
            />
          </motion.div>
        </div>
      </main>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] px-4 py-2 font-mono text-[9.5px] uppercase tracking-wider text-slate-500">
        <span>Data · NASA FIRMS MODIS C6.1 + VIIRS S-NPP 375 m</span>
        <span>Imagery · NASA GIBS</span>
        <span className="hidden md:inline">Record {grid.meta.firstYear}–{grid.meta.lastYear}</span>
        <span className="ml-auto normal-case tracking-normal">Independent project for the NASA Space Apps Challenge 2026 · not affiliated with or endorsed by NASA</span>
      </footer>

      <AnimatePresence>{about && <AboutModal meta={grid.meta} k={analysis.k} onClose={() => setAbout(false)} />}</AnimatePresence>
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
    ["Anomalies and trend", "Each month is compared with the same month over the previous 10 years (z-score and % change, with an over-dispersed counting-noise floor). The long-term trend uses Mann-Kendall and Sen's slope."],
    ["Confidence index (HCI)", "A 0–100 score combining detection confidence, MODIS/VIIRS agreement and sample size."],
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
            <h2 className="mt-1 text-2xl font-bold tracking-tight">How FireCal harmonizes 2 sensors into 1 record</h2>
          </div>
          <button onClick={onClose} className="rounded-[3px] p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {meta.source === "sample" && (
          <p className="mb-4 rounded-[4px] border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
            <strong>You are viewing synthetic demo data.</strong> Run <code className="font-mono">npm run data:fetch-country</code> and <code className="font-mono">npm run data:ingest</code> to load the real NASA FIRMS archive.
          </p>
        )}
        <ol className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
          {steps.map(([title, body], i) => (
            <motion.li key={title} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * i }} className="flex gap-4 py-3">
              <span className="font-mono text-sm text-signal">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <div className="text-sm font-semibold text-white">{title}</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-slate-400">{body}</p>
              </div>
            </motion.li>
          ))}
        </ol>
        <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-slate-500">
          Record: {MONTHS_LONG[0]} {meta.firstYear} – {MONTHS_LONG[meta.lastMonth - 1]} {meta.lastYear}. {meta.notes} The AI analyst only receives these computed statistics, and the prompt tells it to cite them, not invent numbers.
        </p>
      </motion.div>
    </motion.div>
  );
}
