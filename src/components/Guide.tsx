import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BookOpen, Compass, Presentation, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/**
 * First-visit guided tour: spotlights each part of the dashboard in turn with a
 * short explanation. Targets are elements carrying data-guide="<id>"; a step
 * whose target is hidden (small screens, collapsed panels) shows as a centred card.
 */
interface Step {
  target?: string;
  kicker: string;
  title: string;
  body: string;
  tip?: string;
}

const STEPS: Step[] = [
  {
    kicker: "Welcome",
    title: "FireCal AI in 60 seconds",
    body: "Two NASA satellite fire records, MODIS since 2000 and VIIRS since 2012, merged into one consistent history of burning for any place on Earth. This short tour shows where everything is.",
    tip: "Use ← → or the buttons. Esc skips.",
  },
  {
    target: "harmonize",
    kicker: "The core idea",
    title: "Before / After harmonization",
    body: "VIIRS sees 2–3× more fire than MODIS because its pixels are smaller. Before shows that fake jump in 2012. After puts every year in the same units, so real trends become visible.",
    tip: "Flip it and watch the numbers and the calendar change.",
  },
  {
    target: "kpis",
    kicker: "At a glance",
    title: "Key numbers for the selected area",
    body: "Total fire activity, peak season, the MODIS-to-VIIRS calibration factor, the long-term trend with its significance, the biggest anomaly and the record length.",
  },
  {
    target: "sidebar",
    kicker: "Choose a place",
    title: "Explore: world, country or region",
    body: "Pick the whole world, any country (ranked by fire activity, with trend sparklines), the Bangladesh high-detail regions, or draw your own area on the map.",
    tip: "Search a country by name.",
  },
  {
    target: "layers",
    kicker: "What the map shows",
    title: "Map layers",
    body: "Activity: how much burns. Anomaly: above or below normal. Hot-spot trends: where burning is intensifying or fading. Outlook: next months' risk. Live 7D: fires detected this week. 3D turns it into a globe.",
  },
  {
    target: "map",
    kicker: "The map",
    title: "NASA imagery under the fire data",
    body: "The background is NASA's Black Marble night lights, so you can see where people live next to where fires burn. Switch to true-color satellite imagery for the date you select. Hover a cell for its numbers; click a country to analyse it.",
  },
  {
    target: "timebar",
    kicker: "Time",
    title: "Travel through the record",
    body: "Drag the slider or press play to animate year by year. Pick a month to see that season only.",
  },
  {
    target: "insights",
    kicker: "Analysis",
    title: "Insights tabs",
    body: "Calendar: every month of every year as a heatmap, with anomalies glowing. Trends: annual totals and whether the season starts earlier. Hot spots, Outlook (validated forecast), Live, and Science: El Niño links, fire intensity and re-burning.",
    tip: "Click any glowing month for an instant explanation.",
  },
  {
    target: "analyst",
    kicker: "Ask in plain language",
    title: "AI analyst",
    body: "Ask questions like \"Which countries are burning more?\" or \"Does El Niño affect fires in Indonesia?\". It runs the real statistics, answers with numbers, and moves the map for you. Early-warning PDF exports a brief for responders.",
  },
  {
    target: "sources",
    kicker: "Trust",
    title: "Data sources",
    body: "Every dataset, its provider, resolution, period and where it is used, plus a citation you can copy.",
  },
  {
    target: "actions",
    kicker: "Share it",
    title: "Explain, present, revisit",
    body: "Lab shows the science: blind validation, how often MODIS sees fires, orbit drift, emissions, and the open dataset with a citation. Explain opens animated stories for kids, teens and seniors. Present runs a guided story for an audience. The compass reopens this tour.",
  },
];

const KEY = "firecal-guide-v1";

export function guideSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "done";
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, "done");
  } catch {
    /* ignore */
  }
}

type Rect = { x: number; y: number; w: number; h: number };

function measure(target?: string): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-guide="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || getComputedStyle(el).visibility === "hidden") return null;
  const pad = 6;
  const x = Math.max(4, r.left - pad);
  const y = Math.max(4, r.top - pad);
  return { x, y, w: Math.min(window.innerWidth - 4, r.right + pad) - x, h: Math.min(window.innerHeight - 4, r.bottom + pad) - y };
}

/** Card position: beside the spotlight where there is room, otherwise below/above, else centred. */
function place(rect: Rect | null, cw: number, ch: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const m = 14;
  if (!rect || W < 640) return { left: Math.max(m, (W - cw) / 2), top: rect && W < 640 ? H - ch - m : Math.max(m, (H - ch) / 2) };
  const clampY = (y: number) => Math.min(Math.max(m, y), H - ch - m);
  const clampX = (x: number) => Math.min(Math.max(m, x), W - cw - m);
  if (rect.x + rect.w + m + cw < W) return { left: rect.x + rect.w + m, top: clampY(rect.y) };
  if (rect.x - m - cw > 0) return { left: rect.x - m - cw, top: clampY(rect.y) };
  if (rect.y + rect.h + m + ch < H) return { left: clampX(rect.x), top: rect.y + rect.h + m };
  if (rect.y - m - ch > 0) return { left: clampX(rect.x), top: rect.y - m - ch };
  return { left: (W - cw) / 2, top: H - ch - m };
}

interface Props {
  onClose: () => void;
  onPresent: () => void;
}

export function Guide({ onClose, onPresent }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [, setTick] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const close = useCallback(() => {
    markSeen();
    onClose();
  }, [onClose]);

  // Bring the target into view, then measure it (and keep measuring on resize/scroll).
  useLayoutEffect(() => {
    const el = step.target ? document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`) : null;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setRect(measure(step.target));
        setTick((t) => t + 1);
      });
    };
    update();
    const settle = setTimeout(update, 450);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") last ? close() : setI((n) => n + 1);
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, last]);

  const cw = Math.min(360, window.innerWidth - 28);
  const pos = place(rect, cw, last ? 300 : 250);

  return (
    <div className="fixed inset-0 z-[3000]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Dim everything except the spotlight (a huge box-shadow around the hole). */}
      {rect ? (
        <motion.div
          className="pointer-events-none absolute rounded-[6px] ring-2 ring-signal"
          initial={false}
          animate={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          style={{ boxShadow: "0 0 0 9999px rgba(3,6,12,0.74), 0 0 28px rgba(77,142,255,0.55)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(3,6,12,0.74)]" />
      )}
      {/* Clicks outside the card do nothing but are swallowed so the page isn't changed mid-tour. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          className="panel hud absolute p-4 shadow-2xl"
          style={{ left: pos.left, top: pos.top, width: cw }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Compass className="h-4 w-4 text-signal" aria-hidden />
              <span className="eyebrow !text-signal">
                {step.kicker} · {i + 1}/{STEPS.length}
              </span>
            </div>
            <button onClick={close} className="-m-1 rounded-[3px] p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Skip tour">
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 className="mt-2 text-[17px] font-bold leading-tight tracking-tight text-white">{step.title}</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">{step.body}</p>
          {step.tip && <p className="mt-2 border-l-2 border-signal/60 pl-2 text-[11.5px] text-slate-400">{step.tip}</p>}

          {last && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  close();
                  onPresent();
                }}
                className="flex items-center justify-center gap-1.5 rounded-[4px] bg-nasa-red px-2 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-white hover:bg-[#ff5a3f]"
              >
                <Presentation className="h-3.5 w-3.5" /> Start story
              </button>
              <a href="/explain" onClick={markSeen} className="flex items-center justify-center gap-1.5 rounded-[4px] border border-white/15 px-2 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-slate-200 hover:border-signal/60">
                <BookOpen className="h-3.5 w-3.5 text-signal" /> Explain
              </a>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex gap-1" aria-hidden>
              {STEPS.map((_, k) => (
                <button key={k} tabIndex={-1} onClick={() => setI(k)} className={`h-1.5 rounded-full transition-all ${k === i ? "w-4 bg-signal" : "w-1.5 bg-white/20 hover:bg-white/40"}`} />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {i > 0 && (
                <button onClick={() => setI(i - 1)} className="flex items-center gap-1 rounded-[4px] px-2 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-slate-300 hover:bg-white/5" aria-label="Previous step">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                autoFocus
                onClick={() => (last ? close() : setI(i + 1))}
                className="flex items-center gap-1 rounded-[4px] bg-nasa-blue px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-white hover:bg-[#1450b8]"
              >
                {i === 0 ? "Start tour" : last ? "Done" : "Next"}
                {!last && <ArrowRight className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
