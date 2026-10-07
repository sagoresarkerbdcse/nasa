import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InsightTab, MapLayer, MonthStat } from "../lib/types";

export interface TourControls {
  region: (id: string) => void;
  year: (y: number) => void;
  month: (m: number | null) => void;
  layer: (l: MapLayer) => void;
  tab: (t: InsightTab) => void;
  view3d: (v: boolean) => void;
  harmonized: (h: boolean) => void;
  playing: (p: boolean) => void;
  select: (m: MonthStat) => void;
}

export interface TourFacts {
  firstYear: number;
  lastYear: number;
  detections: number;
  naiveJump: number;
  k: number;
  declinePct: number | null;
  onsetDaysPerDecade: number | null;
  persistent: number;
  diminishing: number;
  topAnomaly: MonthStat | undefined;
  outlookSkill: number;
  liveCount: number | null;
}

interface Step {
  kicker: string;
  title: string;
  body: string;
  run: (c: TourControls) => void;
  ms?: number;
}

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function buildSteps(f: TourFacts): Step[] {
  const steps: Step[] = [
    {
      kicker: "01 · Mission",
      title: `${f.lastYear - f.firstYear + 1} years of fire, seen from orbit`,
      body: `NASA's Terra, Aqua and Suomi NPP satellites recorded ${f.detections.toLocaleString()} fires over Bangladesh and its border hills. Each spike is a place that burns.`,
      run: (c) => {
        c.region("domain");
        c.layer("activity");
        c.month(null);
        c.year(f.lastYear);
        c.harmonized(true);
        c.view3d(true);
        c.tab("calendar");
      },
      ms: 9000,
    },
    {
      kicker: "02 · The problem",
      title: "Two satellites, two different rulers",
      body: `In 2012 the sharper VIIRS sensor joined MODIS. Raw counts suddenly jump about ${f.naiveJump}×. The fires didn't change. The ruler did.`,
      run: (c) => {
        c.view3d(false);
        c.harmonized(false);
        c.tab("trends");
      },
    },
    {
      kicker: "03 · The fix",
      title: "Harmonization: one ruler for every year",
      body: `We count fire-days on a common 1 km grid and calibrate MODIS against VIIRS where both fly (k = ${f.k}). The fake jump disappears and every year becomes comparable.`,
      run: (c) => c.harmonized(true),
    },
    {
      kicker: "04 · When it burns",
      title: "March and April, every year",
      body: "The calendar shows the rhythm: hill-farming fires in the dry season. Watch the map replay the years.",
      run: (c) => {
        c.tab("calendar");
        c.layer("activity");
        c.month(3);
        c.year(f.firstYear);
        c.playing(true);
      },
      ms: 11000,
    },
    {
      kicker: "05 · What is changing",
      title: f.declinePct !== null && f.declinePct < 0 ? `Burning is down ${Math.abs(f.declinePct)}%, but the season starts earlier` : "The fire season is shifting",
      body:
        f.onsetDaysPerDecade !== null
          ? `The fire season now starts about ${Math.abs(f.onsetDaysPerDecade)} days ${f.onsetDaysPerDecade < 0 ? "earlier" : "later"} per decade, and it is getting longer. Response teams need to be ready sooner.`
          : "Season timing and trends are tested with Mann-Kendall statistics, not guessed.",
      run: (c) => {
        c.playing(false);
        c.month(null);
        c.tab("trends");
      },
    },
    {
      kicker: "06 · Where it keeps burning",
      title: "Persistent hot spots in the Chittagong Hill Tracts",
      body: `Space-time hot-spot analysis (Getis-Ord Gi* + Mann-Kendall) finds ${f.persistent} persistent and ${f.diminishing} cooling hot-spot cells across the area. That is where patrols and outreach pay off.`,
      run: (c) => {
        c.region("cht");
        c.layer("hotspots");
        c.tab("hotspots");
      },
    },
  ];
  if (f.topAnomaly) {
    const a = f.topAnomaly;
    steps.push({
      kicker: "07 · What was unusual",
      title: `${MON[a.month - 1]} ${a.year}: ${a.pctVsBaseline! >= 0 ? "+" : ""}${a.pctVsBaseline}% above normal`,
      body: "Every month is compared with the same month over the previous 10 years. Red cells burned far more than their own normal.",
      run: (c) => {
        c.region("domain");
        c.layer("anomaly");
        c.tab("calendar");
        c.select(a);
      },
    });
  }
  steps.push(
    {
      kicker: "08 · What's next",
      title: "A validated outlook for the coming months",
      body: `Our model beats the 10-year average by ${Math.round(f.outlookSkill * 100)}% on years it never saw. The risk map shows where fire is most likely next.`,
      run: (c) => {
        c.layer("outlook");
        c.tab("outlook");
      },
    },
    {
      kicker: "09 · Right now",
      title: "Live NASA FIRMS detections",
      body: f.liveCount !== null ? `${f.liveCount} fires were detected in the study area over the last 7 days, compared with what is normal for this time of year.` : "The last 7 days of detections from four satellites, compared with normal.",
      run: (c) => {
        c.layer("live");
        c.tab("live");
      },
    },
    {
      kicker: "10 · Ask anything",
      title: "An AI analyst that works with the data",
      body: 'Ask "Where are the persistent hot spots?" or "Is the season starting earlier?". The analyst runs the analysis tools, moves the map, and writes a responder brief.',
      run: (c) => {
        c.layer("activity");
        c.tab("calendar");
      },
    },
  );
  return steps;
}

export function Tour({ facts, controls, onClose }: { facts: TourFacts; controls: TourControls; onClose: () => void }) {
  const [steps] = useState(() => buildSteps(facts));
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const ctl = useRef(controls);
  ctl.current = controls;
  const step = steps[i];
  const ms = step.ms ?? 8500;

  useEffect(() => {
    step.run(ctl.current);
  }, [step]);

  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(steps.length - 1, x + d))), [steps.length]);

  useEffect(() => {
    if (!auto) return;
    if (i === steps.length - 1) return;
    const id = setTimeout(() => go(1), ms);
    return () => clearTimeout(id);
  }, [auto, i, ms, go, steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setAuto((a) => !a);
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[2500] flex justify-center p-4 sm:p-6">
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          role="dialog"
          aria-live="polite"
          aria-label="Presentation"
          initial={{ opacity: 0, y: 24, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="panel hud pointer-events-auto w-full max-w-3xl border-signal/30 bg-[#070a0f]/95 px-6 py-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur"
        >
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">{step.kicker}</div>
              <h2 className="mt-1.5 text-[22px] font-bold leading-tight tracking-tight text-white sm:text-[28px]">{step.title}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-300 sm:text-[15px]">{step.body}</p>
            </div>
            <button onClick={onClose} className="pointer-events-auto rounded-[3px] p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Exit presentation">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => go(-1)} disabled={i === 0} className="grid h-8 w-8 place-items-center rounded-[3px] border border-white/10 text-slate-300 hover:border-white/30 disabled:opacity-30" aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => setAuto((a) => !a)} className="grid h-8 w-8 place-items-center rounded-[3px] bg-nasa-red text-white" aria-label={auto ? "Pause" : "Play"}>
              {auto ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
            <button onClick={() => go(1)} disabled={i === steps.length - 1} className="grid h-8 w-8 place-items-center rounded-[3px] border border-white/10 text-slate-300 hover:border-white/30 disabled:opacity-30" aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="flex flex-1 gap-1">
              {steps.map((_, k) => (
                <button key={k} onClick={() => setI(k)} className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10" aria-label={`Step ${k + 1}`}>
                  {k < i && <span className="absolute inset-0 bg-signal" />}
                  {k === i && (
                    <motion.span key={`${i}-${auto}`} className="absolute inset-y-0 left-0 bg-signal" initial={{ width: auto ? "0%" : "100%" }} animate={{ width: "100%" }} transition={{ duration: auto ? ms / 1000 : 0, ease: "linear" }} />
                  )}
                </button>
              ))}
            </div>
            <span className="font-mono text-[10.5px] tabular-nums text-slate-400">
              {i + 1}/{steps.length}
            </span>
          </div>
          <div className="mt-2 hidden font-mono text-[9.5px] text-slate-500 sm:block">← → to navigate · space to pause · esc to exit</div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
