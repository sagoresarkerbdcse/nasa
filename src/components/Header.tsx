import { motion } from "framer-motion";
import { Flame, FlaskConical, Info, Satellite } from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber";
import type { AoiAnalysis, GridFile } from "../lib/types";

interface Props {
  meta: GridFile["meta"];
  analysis: AoiAnalysis;
  harmonized: boolean;
  onHarmonized: (h: boolean) => void;
  onAbout: () => void;
}

export function Header({ meta, analysis, harmonized, onHarmonized, onAbout }: Props) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-5">
      <div className="flex items-center gap-3">
        <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-ember via-flame to-solar shadow-[0_0_24px_rgba(249,115,22,0.55)]">
          <Flame className="h-5 w-5 text-white" strokeWidth={2.5} />
          <motion.span className="absolute inset-0 rounded-xl ring-2 ring-orange-300/60" animate={{ scale: [1, 1.18], opacity: [0.7, 0] }} transition={{ repeat: Infinity, duration: 2 }} />
        </div>
        <div>
          <h1 className="text-lg font-extrabold leading-none tracking-tight">
            FireCal <span className="text-ai">AI</span>
          </h1>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
            <Satellite className="h-3 w-3" /> Harmonized MODIS + VIIRS burning calendar · {meta.firstYear}–{meta.lastYear}
          </p>
        </div>
      </div>

      {meta.source === "sample" ? (
        <button onClick={onAbout} className="flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[10.5px] font-semibold text-amber-200" title="Synthetic demo data. Run the FIRMS pipeline for real data.">
          <FlaskConical className="h-3.5 w-3.5" /> SAMPLE DATA
        </button>
      ) : (
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> NASA FIRMS
        </span>
      )}

      {/* Harmonization toggle with animated counter */}
      <div className="glass ml-auto flex items-center gap-3 rounded-2xl py-1.5 pl-1.5 pr-3">
        <div className="relative flex rounded-xl bg-ink-950/70 p-0.5 text-[11px] font-semibold" role="radiogroup" aria-label="Harmonization">
          {[
            [false, "Before"],
            [true, "After"],
          ].map(([val, label]) => (
            <button
              key={String(val)}
              role="radio"
              aria-checked={harmonized === val}
              onClick={() => onHarmonized(val as boolean)}
              className={`relative rounded-lg px-3 py-1.5 transition-colors ${harmonized === val ? "text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {harmonized === val && (
                <motion.span
                  layoutId="harm-pill"
                  className={`absolute inset-0 rounded-lg ${val ? "bg-gradient-to-r from-ai to-ai-2 shadow-[0_0_16px_rgba(20,184,166,0.45)]" : "bg-slate-600/70"}`}
                  transition={{ type: "spring", stiffness: 420, damping: 30 }}
                />
              )}
              <span className="relative">{label as string}</span>
            </button>
          ))}
        </div>
        <div className="leading-tight">
          <div className="font-mono text-base font-semibold text-white">
            <AnimatedNumber value={harmonized ? analysis.totals.harmonized : analysis.totals.naive} />
          </div>
          <div className="text-[10px] text-slate-400">{harmonized ? `fire-days · k = ${analysis.k}` : "raw detections (mixed sensors)"}</div>
        </div>
      </div>

      <button onClick={onAbout} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white" aria-label="About the method">
        <Info className="h-4 w-4" />
      </button>
    </header>
  );
}
