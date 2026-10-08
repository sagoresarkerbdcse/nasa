import { motion } from "framer-motion";
import { Activity, CalendarRange, Flame, Gauge, TrendingDown, TrendingUp, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { MONTHS } from "../lib/regions";
import type { AoiAnalysis, GridFile } from "../lib/types";
import { AnimatedNumber } from "./AnimatedNumber";

interface Props {
  analysis: AoiAnalysis;
  meta: GridFile["meta"];
  harmonized: boolean;
  regionName: string;
  onAnomaly: () => void;
}

export function KpiStrip({ analysis: a, meta, harmonized, regionName, onAnomaly }: Props) {
  const top = a.anomalies[0];
  const t = a.trend;
  const tiles: { label: string; icon: ReactNode; value: ReactNode; sub: ReactNode; accent?: string; onClick?: () => void }[] = [
    {
      label: harmonized ? "Harmonized fire-days" : "Raw detections",
      icon: <Flame className="h-3.5 w-3.5" />,
      value: <AnimatedNumber value={harmonized ? a.totals.harmonized : a.totals.naive} />,
      sub: harmonized ? "VIIRS-equivalent units" : "mixed MODIS / VIIRS counts",
      accent: "text-flame",
    },
    {
      label: "Peak season",
      icon: <CalendarRange className="h-3.5 w-3.5" />,
      value: `${MONTHS[a.peakMonths[0] - 1]}–${MONTHS[a.peakMonths[1] - 1]}`,
      sub: `${Math.round((a.climatology[a.peakMonths[0] - 1].share + a.climatology[a.peakMonths[1] - 1].share) * 100)}% of annual burning`,
    },
    {
      label: "Calibration k",
      icon: <Gauge className="h-3.5 w-3.5" />,
      value: (
        <>
          {a.k.toFixed(2)}
          <span className="text-base text-slate-400">×</span>
        </>
      ),
      sub: a.kSource === "aoi" ? "VIIRS ÷ MODIS fire-days, this area" : "domain factor (area too sparse)",
      accent: "text-signal",
    },
    {
      label: "Long-term trend",
      icon: t.direction === "decreasing" ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />,
      value: t.significant ? `${t.senSlope > 0 ? "+" : ""}${t.senSlope}/yr` : "Stable",
      sub: `Mann-Kendall p = ${t.pValue}`,
      accent: t.significant ? (t.senSlope > 0 ? "text-nasa-red" : "text-emerald-400") : undefined,
    },
    {
      label: "Top anomaly",
      icon: <Zap className="h-3.5 w-3.5" />,
      value: top ? `${MONTHS[top.month - 1]} ${top.year}` : "None",
      sub: top ? `+${top.pctVsBaseline}% vs 10-yr avg · z ${top.z}` : "no significant months",
      accent: top ? "text-solar" : undefined,
      onClick: top ? onAnomaly : undefined,
    },
    {
      label: "Satellite record",
      icon: <Activity className="h-3.5 w-3.5" />,
      value: `${meta.firstYear}–${String(meta.lastYear).slice(2)}`,
      sub: `${(a.totals.modisRaw + a.totals.viirsRaw).toLocaleString()} hotspots · ${a.cellCount} cells`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-white/[0.07] bg-white/[0.07] sm:grid-cols-3 xl:grid-cols-6" aria-label={`Key statistics for ${regionName}`} data-guide="kpis">
      {tiles.map((tile, i) => {
        const Comp = tile.onClick ? motion.button : motion.div;
        return (
          <Comp
            key={tile.label}
            onClick={tile.onClick}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className={`group relative bg-panel px-4 py-3 text-left ${tile.onClick ? "cursor-pointer transition-colors hover:bg-panel-2" : ""}`}
          >
            <div className="eyebrow flex items-center gap-1.5 !text-[9.5px]">
              <span className={tile.accent ?? "text-slate-500"}>{tile.icon}</span>
              {tile.label}
            </div>
            <motion.div key={regionName + harmonized} initial={{ opacity: 0.2 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className={`mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums ${tile.accent ?? "text-white"}`}>
              {tile.value}
            </motion.div>
            <div className="mt-1.5 truncate font-mono text-[10px] text-slate-500">{tile.sub}</div>
            {tile.onClick && <span className="absolute bottom-0 left-0 h-[2px] w-0 bg-solar transition-all duration-300 group-hover:w-full" />}
          </Comp>
        );
      })}
    </div>
  );
}
