import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { LogoMark } from "./Header";

const STEPS = [
  "Linking NASA FIRMS archive",
  "Loading MODIS C6.1 · Terra / Aqua",
  "Loading VIIRS 375 m · Suomi NPP",
  "Gridding fire-days on a 0.01° lattice",
  "Calibrating sensor overlap (k)",
  "Scanning for anomalies",
];

/** Short mission-style boot sequence while data loads (skipped after the first visit). */
export function BootScreen({ ready, error, onDone }: { ready: boolean; error: string | null; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const fast = typeof window !== "undefined" && (sessionStorageGet("fc-booted") || window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (error) return;
    const id = setInterval(() => setStep((s) => Math.min(STEPS.length, s + 1)), fast ? 60 : 260);
    return () => clearInterval(id);
  }, [error, fast]);

  useEffect(() => {
    if (ready && step >= STEPS.length) {
      const id = setTimeout(() => {
        sessionStorageSet("fc-booted", "1");
        onDone();
      }, fast ? 50 : 350);
      return () => clearTimeout(id);
    }
  }, [ready, step, onDone, fast]);

  const progress = Math.min(step, STEPS.length) / STEPS.length;

  return (
    <motion.div className="space-bg fixed inset-0 z-[3000] grid place-items-center p-6" exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.5 }}>
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-4">
          <LogoMark size={52} />
          <div>
            <div className="text-2xl font-extrabold uppercase tracking-tight">
              FireCal <span className="text-signal">AI</span>
            </div>
            <div className="eyebrow mt-1">Harmonized active-fire record</div>
          </div>
        </div>
        <div className="space-y-1.5 font-mono text-[12px]">
          <AnimatePresence initial={false}>
            {STEPS.slice(0, step + 1).map((s, i) => (
              <motion.div key={s} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
                <span className={i < step ? "text-emerald-400" : "animate-blink text-signal"}>{i < step ? "[ OK ]" : "[ .. ]"}</span>
                <span className={i < step ? "text-slate-300" : "text-white"}>{s}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="mt-6 h-[3px] overflow-hidden rounded-full bg-white/10">
          <motion.div className="h-full bg-gradient-to-r from-nasa-blue via-signal to-flame" animate={{ width: `${progress * 100}%` }} transition={{ ease: "easeOut" }} />
        </div>
        {error && <p className="mt-4 font-mono text-xs text-nasa-red">ERROR: {error}</p>}
      </div>
    </motion.div>
  );
}

function sessionStorageGet(k: string) {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function sessionStorageSet(k: string, v: string) {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}
