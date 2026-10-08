import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, ChevronsLeft, ChevronsRight, Globe2, Minus, Search, SquareDashedMousePointer } from "lucide-react";
import { useMemo, useState } from "react";
import { fmt } from "../lib/color";
import type { CountrySummary } from "../lib/global";
import { REGIONS } from "../lib/regions";

export type Scope = { kind: "global" } | { kind: "country"; name: string } | { kind: "bd"; regionId: string };

interface Props {
  scope: Scope;
  onScope: (s: Scope) => void;
  countries: CountrySummary[] | null;
  globalStatus: "loading" | "ready" | "missing";
  open: boolean;
  onToggle: () => void;
  onDrawAoi: () => void;
}

function Spark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 56},${16 - (v / max) * 14}`).join(" ");
  return (
    <svg width={56} height={18} aria-hidden className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}

export function ScopeSidebar({ scope, onScope, countries, globalStatus, open, onToggle, onDrawAoi }: Props) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (countries ?? []).map((c, i) => ({ ...c, rank: i + 1 })).filter((c) => !needle || c.name.toLowerCase().includes(needle));
  }, [countries, q]);

  if (!open)
    return (
      <aside className="panel hidden w-11 shrink-0 flex-col items-center gap-3 py-3 lg:flex" data-guide="sidebar">
        <button onClick={onToggle} className="rounded-[3px] p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Open scope sidebar">
          <ChevronsRight className="h-4 w-4" />
        </button>
        <button onClick={() => onScope({ kind: "global" })} className={`rounded-[3px] p-1.5 ${scope.kind === "global" ? "bg-nasa-blue text-white" : "text-slate-400 hover:text-white"}`} aria-label="Global">
          <Globe2 className="h-4 w-4" />
        </button>
        <button onClick={() => onScope({ kind: "bd", regionId: "domain" })} className={`rounded-[3px] px-1 py-1 font-mono text-[10px] font-bold ${scope.kind === "bd" ? "bg-nasa-blue text-white" : "text-slate-400 hover:text-white"}`} aria-label="Bangladesh detail">
          BD
        </button>
      </aside>
    );

  const active = (s: Scope) => JSON.stringify(s) === JSON.stringify(scope);
  return (
    <aside className="panel flex max-h-[70vh] w-full shrink-0 flex-col overflow-hidden lg:max-h-none lg:w-[248px]" aria-label="Choose an area" data-guide="sidebar">
      <header className="panel-head flex items-center gap-2 px-3 py-2.5">
        <span className="font-mono text-[10.5px] text-signal">00</span>
        <h2 className="eyebrow !text-slate-200">Explore</h2>
        <button onClick={onToggle} className="ml-auto hidden rounded-[3px] p-1 text-slate-400 hover:bg-white/5 hover:text-white lg:block" aria-label="Collapse sidebar">
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </header>

      <div className="space-y-1 border-b border-white/[0.06] p-2">
        <button
          onClick={() => onScope({ kind: "global" })}
          disabled={globalStatus !== "ready"}
          className={`flex w-full items-center gap-2 rounded-[4px] px-2.5 py-2 text-left text-[13px] font-semibold transition-colors disabled:opacity-50 ${active({ kind: "global" }) ? "bg-nasa-blue text-white" : "text-slate-200 hover:bg-white/[0.05]"}`}
        >
          <Globe2 className="h-4 w-4 text-cyan" /> Whole world
          <span className="ml-auto font-mono text-[9.5px] font-normal text-slate-400">{globalStatus === "loading" ? "loading…" : globalStatus === "missing" ? "not built" : `${countries?.length ?? 0} countries`}</span>
        </button>
        <div className="px-2.5 pt-2 eyebrow !text-[9px]">Bangladesh · high detail (0.25°)</div>
        {REGIONS.map((r) => {
          const s: Scope = { kind: "bd", regionId: r.id };
          return (
            <button key={r.id} onClick={() => onScope(s)} className={`flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${active(s) ? "bg-nasa-blue text-white" : "text-slate-300 hover:bg-white/[0.05]"}`} title={r.blurb}>
              <span className={`h-1.5 w-1.5 rounded-full ${active(s) ? "bg-white" : "bg-flame"}`} />
              {r.id === "domain" ? "Bangladesh + border belt" : r.name}
            </button>
          );
        })}
        <button onClick={onDrawAoi} className={`flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${scope.kind === "bd" && scope.regionId === "custom" ? "bg-cyan/15 text-cyan" : "text-slate-300 hover:bg-white/[0.05]"}`}>
          <SquareDashedMousePointer className="h-3.5 w-3.5" /> Draw your own area
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-3 pb-1.5 pt-2.5">
          <div className="eyebrow mb-1.5 !text-[9px]">Countries · ranked by fire-days 2003–2024</div>
          <label className="flex items-center gap-2 rounded-[4px] border border-white/10 bg-black/30 px-2 py-1.5 focus-within:border-signal/60">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a country" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-white placeholder:text-slate-500 focus:outline-none" aria-label="Search countries" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 scroll-thin" role="list">
          {globalStatus === "missing" && <p className="px-2 py-3 text-[11.5px] leading-relaxed text-slate-500">Global data not built yet. Run the "Build global FIRMS dataset" workflow.</p>}
          {globalStatus === "loading" && <p className="px-2 py-3 text-[11.5px] text-slate-500">Loading 236 countries…</p>}
          {list.map((c) => {
            const s: Scope = { kind: "country", name: c.name };
            const Icon = !c.trend.significant ? Minus : c.trend.senSlope > 0 ? ArrowUpRight : ArrowDownRight;
            return (
              <motion.button
                layout="position"
                key={c.name}
                role="listitem"
                onClick={() => onScope(s)}
                className={`grid w-full grid-cols-[22px_1fr_auto] items-center gap-1.5 rounded-[4px] px-1.5 py-1.5 text-left transition-colors ${active(s) ? "bg-nasa-blue text-white" : "hover:bg-white/[0.05]"}`}
                title={`${c.name}: ${c.total.toLocaleString()} fire-days · k=${c.k} · trend ${c.trend.direction} (p=${c.trend.pValue})`}
              >
                <span className="font-mono text-[9.5px] tabular-nums text-slate-500">{c.rank}</span>
                <span className="min-w-0">
                  <span className={`block truncate text-[12.5px] ${active(s) ? "text-white" : "text-slate-200"}`}>{c.name}</span>
                  <span className="flex items-center gap-1 font-mono text-[9.5px] text-slate-500">
                    {fmt(c.total)} fd
                    <Icon className={`h-3 w-3 ${c.trend.significant ? (c.trend.senSlope > 0 ? "text-nasa-red" : "text-emerald-400") : ""}`} aria-label={c.trend.direction} />
                  </span>
                </span>
                <Spark values={c.annual} color={active(s) ? "#fff" : "#ff7a1a"} />
              </motion.button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
