import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, FileDown, Loader2, RotateCcw, SendHorizontal, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "../lib/markdown";
import { MONTHS_LONG } from "../lib/regions";
import type { AnalystMessage } from "../lib/useAnalyst";
import type { MonthStat } from "../lib/types";

export type ExportState = "idle" | "drafting" | "rendering" | "done";

interface Props {
  messages: AnalystMessage[];
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  onAsk: (q: string) => void;
  onBrief: () => void;
  onExplain: (m: MonthStat) => void;
  onExport: () => void;
  onClear: () => void;
  exportState: ExportState;
  regionShort: string;
  topAnomaly: MonthStat | undefined;
  selectedMonth: MonthStat | undefined;
  health: { llm: boolean; model: string | null } | null;
}

export function AnalystAvatar({ active, size = 36 }: { active: boolean; size?: number }) {
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ background: "conic-gradient(from 0deg, #0b3d91, #4d8eff, #38d3f0, #fc3d21, #0b3d91)" }}
        animate={{ rotate: active ? 360 : 0, opacity: active ? 1 : 0.55 }}
        transition={active ? { repeat: Infinity, duration: 2.2, ease: "linear" } : { duration: 0.4 }}
      />
      {active && <motion.div className="absolute inset-0 rounded-full bg-signal/40 blur-md" animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0.15, 0.6] }} transition={{ repeat: Infinity, duration: 1.6 }} />}
      <div className="relative grid place-items-center rounded-full bg-[#0a0e13]" style={{ width: size - 4, height: size - 4 }}>
        <Sparkles className="h-4 w-4 text-cyan" />
      </div>
    </div>
  );
}

export function AnalystPanel(p: Props) {
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const last = p.messages[p.messages.length - 1];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [p.messages.length, last?.content.length]);

  const chips = [
    `When is peak burning season in ${p.regionShort}?`,
    p.topAnomaly ? `Explain the ${MONTHS_LONG[p.topAnomaly.month - 1]} ${p.topAnomaly.year} anomaly in ${p.regionShort}.` : `Is burning in ${p.regionShort} increasing over time?`,
    "Generate Responder Early-Warning Brief.",
    "How do you harmonize MODIS and VIIRS?",
  ];

  const submit = (q: string) => {
    const text = q.trim();
    if (!text || p.busy) return;
    setInput("");
    if (/early-warning brief/i.test(text)) p.onBrief();
    else p.onAsk(text);
  };

  const exporting = p.exportState === "drafting" || p.exportState === "rendering";

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden" aria-label="FireCal Analyst">
      <header className="panel-head flex items-center gap-3 px-4 py-2">
        <span className="font-mono text-[10.5px] text-signal">03</span>
        <AnalystAvatar active={p.busy} size={30} />
        <div className="min-w-0 flex-1">
          <h2 className="eyebrow !text-slate-200">FireCal Analyst</h2>
          <p className="truncate font-mono text-[10px] text-slate-500">
            {p.health === null ? "connecting…" : p.health.llm ? `Claude · ${p.health.model} · grounded on harmonized data` : "offline analyst · set ANTHROPIC_API_KEY for Claude"}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: exporting ? 1 : 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={p.onExport}
          disabled={exporting}
          className="relative hidden items-center gap-1.5 overflow-hidden rounded-[3px] bg-nasa-red px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-white shadow-[0_0_16px_rgba(252,61,33,0.35)] transition-colors hover:bg-[#ff5a3f] disabled:cursor-wait sm:flex"
        >
          {exporting && <span className="absolute inset-0 animate-shimmer bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)] bg-[length:200%_100%]" />}
          {exporting ? <Loader2 className="relative h-3.5 w-3.5 animate-spin" /> : <FileDown className="relative h-3.5 w-3.5" />}
          <span className="relative">{p.exportState === "drafting" ? "Drafting brief…" : p.exportState === "rendering" ? "Rendering PDF…" : p.exportState === "done" ? "Downloaded ✓" : "Early-warning PDF"}</span>
        </motion.button>
        {p.messages.length > 0 && (
          <button onClick={p.onClear} className="rounded-[3px] p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Clear conversation">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
        <button onClick={p.onToggle} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label={p.open ? "Collapse analyst" : "Expand analyst"}>
          <ChevronDown className={`h-4 w-4 transition-transform ${p.open ? "" : "rotate-180"}`} />
        </button>
      </header>

      <AnimatePresence initial={false}>
        {p.open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex min-h-0 flex-1 flex-col">
            <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 scroll-thin">
              {p.messages.length === 0 && (
                <div className="py-2 text-center">
                  <p className="text-xs text-slate-400">
                    Ask about seasons, trends or anomalies. Click any <span className="text-amber-300">glowing month</span> in the calendar for an instant AI insight.
                  </p>
                </div>
              )}
              {p.selectedMonth && !p.selectedMonth.anomaly && !p.busy && last?.focus?.month !== p.selectedMonth.month && (
                <button
                  onClick={() => p.onExplain(p.selectedMonth!)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-[4px] border border-dashed border-signal/40 py-2 font-mono text-[10.5px] uppercase tracking-wider text-blue-200 hover:bg-signal/10"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Explain {MONTHS_LONG[p.selectedMonth.month - 1]} {p.selectedMonth.year}
                </button>
              )}
              {p.messages.map((m) => (
                <MessageBubble key={m.id} m={m} />
              ))}
            </div>

            <div className="border-t border-white/5 px-3 pb-3 pt-2">
              <div className="mb-2 flex gap-1.5 overflow-x-auto scroll-thin">
                {chips.map((c) => (
                  <motion.button
                    key={c}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    disabled={p.busy}
                    onClick={() => submit(c)}
                    className="shrink-0 rounded-[3px] border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-200 transition-colors hover:border-signal/60 hover:bg-nasa-blue/30 disabled:opacity-50"
                  >
                    {c}
                  </motion.button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(input);
                }}
                className="flex items-center gap-2 rounded-[4px] border border-white/10 bg-black/40 px-3 py-1.5 focus-within:border-signal/70 focus-within:shadow-[0_0_0_3px_rgba(77,142,255,0.15)]"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`Ask about fires in ${p.regionShort}…`}
                  className="min-w-0 flex-1 bg-transparent py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                  aria-label="Ask the analyst"
                />
                <button type="submit" disabled={!input.trim() || p.busy} className="grid h-8 w-8 place-items-center rounded-[3px] bg-nasa-blue text-white hover:bg-signal transition-opacity disabled:opacity-40" aria-label="Send">
                  {p.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                </button>
              </form>
              <button onClick={p.onExport} disabled={exporting} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-nasa-red py-2 font-mono text-[10.5px] uppercase tracking-wider text-white sm:hidden">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} Download Early-Warning PDF Brief
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function MessageBubble({ m }: { m: AnalystMessage }) {
  if (m.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="ml-8 rounded-[4px] border border-white/[0.06] bg-white/[0.05] px-3 py-2 text-sm text-slate-100">
        {m.content}
      </motion.div>
    );
  }
  const special = m.kind === "insight" || m.kind === "brief";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={special ? "rounded-[5px] bg-gradient-to-br from-signal/70 via-nasa-blue/40 to-flame/60 p-px" : ""}>
      <div className={`rounded-[4px] ${special ? "bg-[#0a0e13] px-3.5 py-3" : "mr-4 border-l-2 border-signal/60 bg-white/[0.02] px-3 py-2"}`}>
        {special && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
            <Sparkles className="h-3 w-3 text-cyan" />
            <span className="text-blue-300">{m.kind === "insight" ? "Auto-insight" : "Responder brief"}</span>
            {m.focus && (
              <span className="font-mono text-slate-400">
                · {MONTHS_LONG[m.focus.month - 1]} {m.focus.year}
              </span>
            )}
            {m.regionName && <span className="ml-auto truncate font-normal normal-case tracking-normal text-slate-500">{m.regionName}</span>}
          </div>
        )}
        {m.content ? (
          <div className="text-[13px] leading-relaxed text-slate-200">
            <Markdown text={m.content} streaming={m.streaming} />
          </div>
        ) : (
          <div className="flex items-center gap-2 py-1 text-xs text-slate-400">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-signal" animate={{ opacity: [0.2, 1, 0.2], y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />
              ))}
            </span>
            Analyzing harmonized record…
          </div>
        )}
        {!m.streaming && m.source === "offline" && <div className="mt-1 font-mono text-[9px] text-slate-500">offline analyst</div>}
      </div>
    </motion.div>
  );
}
