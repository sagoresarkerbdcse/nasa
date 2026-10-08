import { motion } from "framer-motion";
import { BookOpen, Compass, Database, FlaskConical, Info, Presentation, Sigma } from "lucide-react";
import { useEffect, useState } from "react";
import type { GridFile } from "../lib/types";

interface Props {
  meta: GridFile["meta"];
  harmonized: boolean;
  onHarmonized: (h: boolean) => void;
  onAbout: () => void;
  onPresent: () => void;
  onSources: () => void;
  onGuide: () => void;
}

/** FireCal mark: an orbit around a burning point (deliberately not an agency insignia). */
export function LogoMark({ size = 36, spin = true }: { size?: number; spin?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <radialGradient id="fc-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff3c4" />
          <stop offset="45%" stopColor="#ffb020" />
          <stop offset="100%" stopColor="#e8361f" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="19" fill="#0b3d91" />
      <circle cx="20" cy="20" r="19" fill="none" stroke="rgba(255,255,255,0.18)" />
      <motion.g style={{ originX: "20px", originY: "20px" }} animate={spin ? { rotate: 360 } : undefined} transition={{ repeat: Infinity, duration: 14, ease: "linear" }}>
        <ellipse cx="20" cy="20" rx="16" ry="6.5" fill="none" stroke="#fc3d21" strokeWidth="1.6" transform="rotate(-28 20 20)" />
        <circle cx="34.1" cy="12.6" r="1.8" fill="#fff" />
      </motion.g>
      <circle cx="20" cy="20" r="6" fill="url(#fc-core)" />
    </svg>
  );
}

function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const iso = now.toISOString();
  return (
    <div className="text-right">
      <div className="eyebrow !text-[9.5px]">UTC</div>
      <div className="font-mono text-[13px] tabular-nums text-white">
        {iso.slice(0, 10)} <span className="text-signal">{iso.slice(11, 19)}</span>
      </div>
    </div>
  );
}

function SatStatus({ name, sensor, since }: { name: string; sensor: string; since: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-radar rounded-full bg-emerald-400" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      <div>
        <div className="eyebrow !text-[9.5px]">{name}</div>
        <div className="font-mono text-[12px] text-white">
          {sensor} <span className="text-slate-500">· since {since}</span>
        </div>
      </div>
    </div>
  );
}

export function Header({ meta, harmonized, onHarmonized, onAbout, onPresent, onSources, onGuide }: Props) {
  return (
    <header className="relative border-b border-white/[0.07] bg-[#070a0f]/80 backdrop-blur">
      {/* NASA-style tri-band accent */}
      <div className="absolute inset-x-0 top-0 flex h-[3px]">
        <span className="flex-[3] bg-nasa-blue" />
        <span className="flex-1 bg-nasa-red" />
        <span className="flex-[0.5] bg-white/80" />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pb-3 pt-4 lg:px-5">
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }} className="flex items-center gap-3">
          <LogoMark />
          <div>
            <h1 className="text-[19px] font-extrabold uppercase leading-none tracking-[-0.01em]">
              FireCal <span className="text-signal">AI</span>
            </h1>
            <p className="eyebrow mt-1.5 !text-[9.5px]">Earth observation · Active fire harmonization</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.6 }} className="hidden items-center gap-6 border-l border-white/[0.07] pl-6 xl:flex">
          <SatStatus name="Terra · Aqua" sensor="MODIS 1 km" since={2000} />
          <SatStatus name="Suomi NPP" sensor="VIIRS 375 m" since={meta.viirsStartYear} />
        </motion.div>

        <div className="ml-auto flex items-center gap-4">
          {meta.source === "sample" ? (
            <button onClick={onAbout} className="flex items-center gap-1.5 rounded-sm border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-amber-200">
              <FlaskConical className="h-3.5 w-3.5" /> Sample data
            </button>
          ) : (
            <button
              onClick={onSources}
              data-guide="sources"
              className="hidden items-center gap-1.5 rounded-sm border border-signal/40 bg-nasa-blue/30 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-blue-100 transition-colors hover:border-signal hover:bg-nasa-blue/60 sm:flex"
              title="See where every dataset comes from"
            >
              <Database className="h-3.5 w-3.5" /> Data sources
            </button>
          )}

          <div className="flex items-center gap-2" data-guide="harmonize">
            <span className="eyebrow hidden md:inline">Harmonization</span>
            <div className="relative flex rounded-[4px] border border-white/10 bg-black/40 p-0.5 font-mono text-[10.5px] uppercase tracking-wider" role="radiogroup" aria-label="Harmonization">
              {[
                [false, "Before"],
                [true, "After"],
              ].map(([val, label]) => (
                <button
                  key={String(val)}
                  role="radio"
                  aria-checked={harmonized === val}
                  onClick={() => onHarmonized(val as boolean)}
                  className={`relative rounded-[3px] px-3 py-1.5 transition-colors ${harmonized === val ? "text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {harmonized === val && (
                    <motion.span layoutId="harm-pill" className={`absolute inset-0 rounded-[3px] ${val ? "bg-nasa-blue shadow-[0_0_18px_rgba(77,142,255,0.45)]" : "bg-slate-700"}`} transition={{ type: "spring", stiffness: 420, damping: 32 }} />
                  )}
                  <span className="relative">{label as string}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="hidden border-l border-white/[0.07] pl-4 lg:block">
            <UtcClock />
          </div>

          <div className="flex items-center gap-2" data-guide="actions">
          <a href="/lab" className="hidden items-center gap-1.5 rounded-[4px] border border-white/10 px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-slate-200 transition-colors hover:border-signal/60 lg:flex" title="Harmonization Lab: method, validation, detection model, orbit drift, emissions, open dataset">
            <Sigma className="h-3.5 w-3.5 text-signal" /> Lab
          </a>
          <a href="/explain" className="hidden items-center gap-1.5 rounded-[4px] border border-white/10 px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-slate-200 transition-colors hover:border-signal/60 md:flex">
            <BookOpen className="h-3.5 w-3.5 text-signal" /> Explain
          </a>
          <button onClick={onPresent} className="flex items-center gap-1.5 rounded-[4px] bg-nasa-red px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-white shadow-[0_0_16px_rgba(252,61,33,0.4)] transition-colors hover:bg-[#ff5a3f]">
            <Presentation className="h-3.5 w-3.5" /> Present
          </button>
          <button onClick={onGuide} className="grid h-8 w-8 place-items-center rounded-[4px] border border-white/10 text-slate-400 transition-colors hover:border-signal/60 hover:text-white" aria-label="Guided tour of the dashboard" title="Guided tour">
            <Compass className="h-4 w-4" />
          </button>
          <button onClick={onAbout} className="grid h-8 w-8 place-items-center rounded-[4px] border border-white/10 text-slate-400 transition-colors hover:border-signal/60 hover:text-white" aria-label="About the method" title="Method">
            <Info className="h-4 w-4" />
          </button>
          </div>
        </div>
      </div>
    </header>
  );
}
