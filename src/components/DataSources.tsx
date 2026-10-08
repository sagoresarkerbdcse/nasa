import { motion } from "framer-motion";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { fmt } from "../lib/color";
import type { GridFile } from "../lib/types";

type Provider = "NASA" | "NOAA" | "Open data" | "FireCal";

interface Source {
  name: string;
  provider: Provider;
  product: string;
  detail: string; // resolution · period
  usedIn: string;
  href: string;
}

interface Group {
  title: string;
  sources: Source[];
}

const BADGE: Record<Provider, string> = {
  NASA: "border-signal/50 bg-nasa-blue/40 text-blue-100",
  NOAA: "border-sky-300/40 bg-sky-400/10 text-sky-100",
  "Open data": "border-white/20 bg-white/[0.05] text-slate-200",
  FireCal: "border-orange-300/40 bg-orange-400/10 text-orange-100",
};

const CITATION =
  "We acknowledge the use of data and imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://www.earthdata.nasa.gov/data/tools/firms) and NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).";

interface Props {
  meta: GridFile["meta"];
  global: { countries: number; firstYear: number; lastYear: number } | null;
  live: { generated?: string; origin: string; count: number } | null;
  oniFetched: string | null;
  llm: string | null;
  onClose: () => void;
}

export function DataSourcesModal({ meta, global, live, oniFetched, llm, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups: Group[] = [
    {
      title: "Fire detections: the core data",
      sources: [
        {
          name: "MODIS active fires",
          provider: "NASA",
          product: "FIRMS MODIS Collection 6.1 standard archive (Terra + Aqua)",
          detail: `1 km pixels · ${meta.firstYear}–${meta.lastYear}`,
          usedIn: `Harmonized record before ${meta.viirsStartYear}, and the MODIS side of the calibration factor k`,
          href: "https://www.earthdata.nasa.gov/data/tools/firms",
        },
        {
          name: "VIIRS active fires",
          provider: "NASA",
          product: "FIRMS VIIRS Suomi NPP 375 m standard archive",
          detail: `375 m pixels · ${meta.viirsStartYear}–${meta.lastYear}`,
          usedIn: "Harmonized record from 2012, calibration factor k, individual fires and re-burning, fire intensity (FRP) and night share",
          href: "https://www.earthdata.nasa.gov/data/tools/firms",
        },
        {
          name: "Live fires, last 7 days",
          provider: "NASA",
          product: "FIRMS near-real-time feed: VIIRS S-NPP, NOAA-20, NOAA-21 and MODIS",
          detail: live ? `${fmt(live.count)} detections${live.generated ? ` · updated ${live.generated.slice(0, 16).replace("T", " ")} UTC` : ""}` : "Refreshed twice a day",
          usedIn: "Live tab and the Live 7D map layer (Bangladesh study area)",
          href: "https://firms.modaps.eosdis.nasa.gov/active_fire/",
        },
        {
          name: "Global fire record",
          provider: "NASA",
          product: "FIRMS yearly all-countries archives (MODIS + VIIRS S-NPP)",
          detail: global ? `${global.countries} countries · ${global.firstYear}–${global.lastYear}` : "Not loaded",
          usedIn: "Whole-world and country views, the 1° world map and the country ranking",
          href: "https://firms.modaps.eosdis.nasa.gov/country/",
        },
      ],
    },
    {
      title: "Map imagery",
      sources: [
        {
          name: "Black Marble",
          provider: "NASA",
          product: "VIIRS Day/Night Band night lights (2016), via NASA GIBS",
          detail: "~500 m · global",
          usedIn: "Default basemap of both maps: shows where people live next to where fires burn",
          href: "https://blackmarble.gsfc.nasa.gov/",
        },
        {
          name: "True color",
          provider: "NASA",
          product: "VIIRS S-NPP / MODIS Terra Corrected Reflectance, via NASA GIBS",
          detail: "250–500 m · daily, matched to the selected date",
          usedIn: "True Color basemap: smoke and burn scars on the day you pick",
          href: "https://worldview.earthdata.nasa.gov/",
        },
        {
          name: "Blue Marble",
          provider: "NASA",
          product: "Blue Marble shaded relief and bathymetry, via NASA GIBS",
          detail: "~500 m · global",
          usedIn: "Blue Marble basemap: terrain context",
          href: "https://nasa-gibs.github.io/gibs-api-docs/",
        },
        {
          name: "Labels, borders, coastlines",
          provider: "NASA",
          product: "GIBS Reference Labels and Reference Features (built from © OpenStreetMap contributors)",
          detail: "Vector-derived tiles",
          usedIn: "Place names and borders drawn over every basemap",
          href: "https://www.openstreetmap.org/copyright",
        },
      ],
    },
    {
      title: "Climate and boundaries",
      sources: [
        {
          name: "El Niño / La Niña index",
          provider: "NOAA",
          product: "NOAA CPC Oceanic Niño Index (ONI, ERSST v5)",
          detail: `Monthly · 1950 to present${oniFetched ? ` · fetched ${oniFetched.slice(0, 10)}` : ""}`,
          usedIn: "Science tab: climate link tests and the ENSO country ranking",
          href: "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php",
        },
        {
          name: "Country shapes",
          provider: "Open data",
          product: "Natural Earth 1:50m admin-0 countries (public domain)",
          detail: "Bundled with the app",
          usedIn: "Clickable countries on the world map (invisible click targets); outlines only if NASA GIBS cannot be reached",
          href: "https://www.naturalearthdata.com/",
        },
      ],
    },
    {
      title: "Computed by FireCal",
      sources: [
        {
          name: "Harmonization and statistics",
          provider: "FireCal",
          product: "Fire-days, calibration, anomalies, trends, hot spots, outlook, ENSO tests, fire events",
          detail: "Computed in your browser and on the server from the data above",
          usedIn: "Every chart, number and map layer",
          href: "/explain",
        },
        {
          name: "AI analyst",
          provider: "FireCal",
          product: llm ? `Language model: ${llm}` : "Offline rule-based analyst (no language model)",
          detail: "Writes explanations only; every number comes from the statistics tools",
          usedIn: "Analyst chat, insight cards and the early-warning PDF",
          href: "/explain",
        },
      ],
    },
  ];

  const nasaCount = groups.flatMap((g) => g.sources).filter((s) => s.provider === "NASA").length;

  return (
    <motion.div className="fixed inset-0 z-[2000] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Data sources"
        className="panel hud max-h-[88vh] w-full max-w-3xl overflow-y-auto p-6 scroll-thin"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Data sources</div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Where every pixel and number comes from</h2>
            <p className="mt-1.5 text-[12.5px] text-slate-400">
              {nasaCount} NASA datasets, one NOAA climate index and public-domain country shapes. No key and no commercial map service is needed.
            </p>
          </div>
          <button onClick={onClose} className="rounded-[3px] p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {groups.map((g, gi) => (
          <section key={g.title} className="mb-5">
            <h3 className="eyebrow mb-2 !text-slate-300">{g.title}</h3>
            <ul className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
              {g.sources.map((s, i) => (
                <motion.li key={s.name} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * (gi * 4 + i) }} className="grid gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)]">
                  <div className="flex items-start gap-2 sm:flex-col sm:gap-1">
                    <span className={`shrink-0 rounded-[2px] border px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider ${BADGE[s.provider]}`}>{s.provider}</span>
                    <span className="text-[13px] font-semibold text-white">{s.name}</span>
                  </div>
                  <div className="min-w-0 text-[12px] leading-snug">
                    <a href={s.href} target={s.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="inline-flex items-center gap-1 text-slate-200 hover:text-signal hover:underline">
                      {s.product}
                      {s.href.startsWith("http") && <ExternalLink className="h-3 w-3 shrink-0" />}
                    </a>
                    <div className="mt-0.5 font-mono text-[10.5px] text-slate-500">{s.detail}</div>
                    <div className="mt-0.5 text-slate-400">
                      <span className="text-slate-500">Used in: </span>
                      {s.usedIn}
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>
          </section>
        ))}

        <section className="rounded-[4px] border border-white/[0.08] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="eyebrow !text-slate-300">How to cite</h3>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(CITATION).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }, () => {});
              }}
              className="flex items-center gap-1 rounded-[3px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:bg-white/5"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-400">{CITATION}</p>
        </section>
      </motion.div>
    </motion.div>
  );
}
