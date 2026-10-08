import { AnimatePresence, motion } from "framer-motion";
import { BLACK_MARBLE, FEATURES, LABELS, loadAtlas } from "../lib/basemaps";
import L from "leaflet";
import { Box, Crosshair, Pause, Play, Radio } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, ImageOverlay, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { HOTSPOT_FAMILY, HOTSPOT_META, RISK_CLASSES, divergingColor } from "../lib/analytics";
import { fmt, heat, powScale } from "../lib/color";
import { atlasName, cellCenter, grid1Anomaly, grid1Hotspots, grid1Outlook, grid1Values, normName, type Grid1File } from "../lib/global";
import { MONTHS } from "../lib/regions";
import type { BBox, MapLayer } from "../lib/types";
import { Globe } from "./Globe";

interface Props {
  g1: Grid1File;
  countryNames: string[];
  selected: string | null; // FIRMS country name, null = world
  onCountry: (name: string | null) => void;
  bbox: BBox;
  label: string;
  year: number;
  onYear: (y: number) => void;
  month: number | null;
  onMonth: (m: number | null) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  layer: MapLayer;
  onLayer: (l: MapLayer) => void;
  view3d: boolean;
  onView3d: (v: boolean) => void;
  outlookTarget: { year: number; month: number };
  outlookScale: number;
}

const LAYERS: { id: MapLayer; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "anomaly", label: "Anomaly" },
  { id: "hotspots", label: "Hot-spot trends" },
  { id: "outlook", label: "Outlook" },
  { id: "live", label: "Live 7d" },
];

// Risk thresholds per 1° cell (~16× the area of a 0.25° cell).
const RISK_SCALE = 16;

const MERC_MAX = 85;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-MERC_MAX, Math.min(MERC_MAX, lat)) * Math.PI) / 360));

/** Paints one value per 1° cell into a Web-Mercator canvas (fast for ~16k cells). */
function paint(cells: Map<number, string>, ids: number[]) {
  const W = 1440;
  const Hh = 1440;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = Hh;
  const ctx = c.getContext("2d")!;
  const top = mercY(MERC_MAX);
  const yOf = (lat: number) => ((top - mercY(lat)) / (2 * top)) * Hh;
  for (const [i, color] of cells) {
    const [lonC, latC] = cellCenter(ids[i]);
    const lon = lonC - 0.5;
    const lat = latC - 0.5;
    if (lat + 1 < -MERC_MAX || lat > MERC_MAX) continue;
    const x0 = ((lon + 180) / 360) * W;
    const y0 = yOf(lat + 1);
    const y1 = yOf(lat);
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, W / 360 + 0.4, y1 - y0 + 0.4);
  }
  return c.toDataURL("image/png");
}

export function WorldMapPanel(p: Props) {
  const { g1, layer, year, month } = p;
  const [atlas, setAtlas] = useState<GeoJSON.FeatureCollection | null>(null);
  // If NASA GIBS is unreachable, make the bundled country outlines carry the geography.
  const [gibsDown, setGibsDown] = useState(false);
  const baseHandlers = useMemo<L.LeafletEventHandlerFnMap>(() => {
    let loads = 0;
    let errors = 0;
    return { tileload: () => void loads++, tileerror: () => void (++errors >= 6 && loads === 0 && setGibsDown(true)) };
  }, []);
  const [hover, setHover] = useState<{ x: number; y: number; html: string } | null>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    loadAtlas().then(setAtlas);
  }, []);

  // Values + colors for the active layer.
  const { colors, info } = useMemo(() => {
    const colors = new Map<number, string>();
    const info = new Map<number, string>();
    if (layer === "activity" || layer === "live") {
      const vals = grid1Values(g1, year, month);
      let max = 1;
      for (const v of vals.values()) max = Math.max(max, v);
      for (const [i, v] of vals) {
        const t = powScale(v, max);
        colors.set(i, heat(0.15 + 0.85 * t, 0.35 + 0.6 * t));
        info.set(i, `${fmt(v)} fire-days${month ? ` · typical ${MONTHS[month - 1]}` : ` · ${year}`}`);
      }
    } else if (layer === "anomaly") {
      for (const [i, a] of grid1Anomaly(g1, year)) {
        colors.set(i, divergingColor(Math.max(-1, Math.min(1, a.change / 1.5))));
        info.set(i, `${a.change >= 0 ? "+" : ""}${Math.round(a.change * 100)}% vs prev. 10 yrs · ${fmt(a.value)} vs ${fmt(a.baseline)}`);
      }
    } else if (layer === "hotspots") {
      grid1Hotspots(g1).forEach((c, i) => {
        if (c.category === "none") return;
        colors.set(i, HOTSPOT_META[c.category].color);
        info.set(i, `${HOTSPOT_META[c.category].label} hot spot · hot in ${c.hotYears} yrs · ~${fmt(c.meanFireDays)} fd/yr`);
      });
    } else if (layer === "outlook") {
      for (const [i, v] of grid1Outlook(g1, p.outlookTarget.month, p.outlookScale)) {
        const rc = RISK_CLASSES.find((c) => v < c.max * RISK_SCALE)!;
        colors.set(i, rc.color);
        info.set(i, `${rc.label} risk · ~${fmt(v)} expected fire-days · ${MONTHS[p.outlookTarget.month - 1]} ${p.outlookTarget.year}`);
      }
    }
    return { colors, info };
  }, [g1, layer, year, month, p.outlookTarget, p.outlookScale]);

  const url = useMemo(() => paint(colors, g1.ids), [colors, g1.ids]);
  const idIndex = useMemo(() => new Map(g1.ids.map((id, i) => [id, i])), [g1.ids]);

  // Atlas name → FIRMS name, for clickable borders.
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    p.countryNames.forEach((n) => m.set(atlasName(n), n));
    return m;
  }, [p.countryNames]);
  const selectedAtlas = p.selected ? atlasName(p.selected) : null;

  const globeSpikes = useMemo(() => {
    const vals = [...grid1Values(g1, year, month).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3500);
    const max = vals[0]?.[1] ?? 1;
    return vals.map(([i, v]) => {
      const [lon, lat] = cellCenter(g1.ids[i]);
      return { lon, lat, t: powScale(v, max) };
    });
  }, [g1, year, month]);

  const years = g1.meta.lastYear - g1.meta.firstYear + 1;

  return (
    <section className="panel hud flex h-full min-h-[480px] flex-col overflow-hidden" aria-label="World map" data-guide="map">
      <header className="panel-head flex items-center gap-3 px-4 py-2.5">
        <span className="font-mono text-[10.5px] text-signal">01</span>
        <h2 className="eyebrow shrink-0 whitespace-nowrap !text-slate-200">Spatial view</h2>
        <span className="hidden min-w-0 truncate text-[12px] text-slate-400 md:inline">· {p.label} · 1° grid</span>
        <div className="ml-auto hidden items-center gap-1.5 font-mono text-[10.5px] text-slate-400 sm:flex">
          <Crosshair className="h-3.5 w-3.5 text-slate-500" />
          <span ref={coordRef} className="tabular-nums">--.---° --.---°</span>
        </div>
      </header>
      <div className="border-b border-white/[0.06] bg-black/20" data-guide="layers">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-3 py-1.5 scroll-thin" role="tablist" aria-label="Map layer">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={layer === l.id}
              onClick={() => p.onLayer(l.id)}
              className={`relative shrink-0 rounded-[3px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${layer === l.id ? "text-white" : "text-slate-400 hover:text-white"}`}
            >
              {layer === l.id && <motion.span layoutId="wlayer-pill" className="absolute inset-0 rounded-[3px] bg-nasa-blue" />}
              <span className="relative flex items-center gap-1">
                {l.id === "live" && <Radio className="h-3 w-3 text-nasa-red" />}
                {l.label}
              </span>
            </button>
          ))}
          <button
            onClick={() => p.onView3d(!p.view3d)}
            className={`ml-1 flex shrink-0 items-center gap-1 rounded-[3px] border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${p.view3d ? "border-cyan bg-cyan/15 text-cyan" : "border-white/10 text-slate-300 hover:border-white/30"}`}
            aria-pressed={p.view3d}
          >
            <Box className="h-3 w-3" /> 3D
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <MapContainer center={[15, 20]} zoom={2} minZoom={2} maxZoom={9} zoomControl={false} worldCopyJump={false} maxBounds={[[-85, -200], [85, 200]]} className="absolute inset-0 h-full w-full" attributionControl>
          <TileLayer url={BLACK_MARBLE.url} maxNativeZoom={BLACK_MARBLE.max} opacity={0.8} eventHandlers={baseHandlers} attribution={`${BLACK_MARBLE.attr} · Labels: NASA GIBS / © OpenStreetMap · Fire data: NASA FIRMS`} />
          <TileLayer url={FEATURES.url} maxNativeZoom={FEATURES.max} opacity={0.35} zIndex={640} />
          <ImageOverlay url={url} bounds={[[-MERC_MAX, -180], [MERC_MAX, 180]]} opacity={0.95} className="fc-pixelated" zIndex={300} />
          {atlas && (
            <GeoJSON
              key={`${selectedAtlas}-${gibsDown}`}
              data={atlas}
              style={(f) => {
                const n = normName(String(f?.properties?.name ?? ""));
                const sel = n === selectedAtlas;
                return { color: sel ? "#4d8eff" : gibsDown ? "rgba(170,195,235,0.35)" : "rgba(170,195,235,0.14)", weight: sel ? 2.4 : 0.5, fillColor: "#0b3d91", fillOpacity: sel ? 0.12 : 0 };
              }}
              onEachFeature={(f, lyr) => {
                const n = normName(String(f.properties?.name ?? ""));
                const firms = nameMap.get(n);
                lyr.on("click", () => p.onCountry(firms ?? null));
                lyr.bindTooltip(`${f.properties?.name ?? ""}${firms ? "" : " · no FIRMS match"}`, { className: "fc-tip", sticky: true, direction: "top" });
              }}
            />
          )}
          <TileLayer url={LABELS.url} maxNativeZoom={LABELS.max} opacity={0.7} zIndex={650} />
          <FitBBox bbox={p.bbox} world={!p.selected} />
          <Hover
            onMove={(lat, lon, x, y) => {
              if (coordRef.current) coordRef.current.textContent = `${lat.toFixed(2)}° ${lon.toFixed(2)}°`;
              const id = (Math.floor(lat) + 90) * 360 + (Math.floor(lon) + 180);
              const i = idIndex.get(id);
              const txt = i !== undefined ? info.get(i) : undefined;
              setHover(txt ? { x, y, html: `${Math.floor(lat)}…${Math.floor(lat) + 1}°, ${Math.floor(lon)}…${Math.floor(lon) + 1}° · ${txt}` } : null);
            }}
          />
          <ZoomCtl />
        </MapContainer>
        {hover && !p.view3d && (
          <div className="pointer-events-none absolute z-[600] -translate-x-1/2 -translate-y-[130%] whitespace-nowrap rounded-[3px] border border-white/12 border-l-2 border-l-flame bg-[#080b10]/95 px-2.5 py-1 font-mono text-[10.5px] text-slate-200" style={{ left: hover.x, top: hover.y }}>
            {hover.html}
          </div>
        )}

        <AnimatePresence>
          {p.view3d && (
            <motion.div key="globe" className="absolute inset-0 z-[480]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Globe spikes={globeSpikes} live={[]} bbox={p.bbox} label={p.label} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute bottom-[104px] left-3 z-[500] max-w-[calc(100%-1.5rem)] rounded-[4px] border border-white/10 bg-[#070a0f]/92 px-3 py-2 backdrop-blur">
          <WorldLegend layer={layer} target={p.outlookTarget} />
        </div>

        <div className="absolute inset-x-3 bottom-3 z-[500]" data-guide="timebar">
          <div className="rounded-[4px] border border-white/10 bg-[#070a0f]/90 px-3 py-2.5 backdrop-blur sm:px-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => p.onPlaying(!p.playing)}
                aria-label={p.playing ? "Pause" : "Play through years"}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[3px] bg-nasa-red text-white shadow-[0_0_18px_rgba(252,61,33,0.5)]"
              >
                {p.playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </button>
              <div className="w-[74px] shrink-0">
                <motion.div key={year} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="font-mono text-[22px] font-medium leading-none tabular-nums text-white">
                  {month ? "Typical" : year}
                </motion.div>
                <div className="eyebrow mt-1 !text-[9.5px]">{month ? `${MONTHS[month - 1]} (10-yr)` : "Full year"}</div>
              </div>
              <div className="min-w-0 flex-1">
                <input type="range" className="fc-range w-full" min={g1.meta.firstYear} max={g1.meta.lastYear} value={year} onChange={(e) => p.onYear(Number(e.target.value))} aria-label="Year" disabled={Boolean(month)} />
                <div className="flex justify-between font-mono text-[9px] text-slate-500">
                  {Array.from({ length: years }, (_, i) => g1.meta.firstYear + i)
                    .filter((y) => y % 5 === 0 || y === g1.meta.firstYear || y === g1.meta.lastYear)
                    .map((y) => (
                      <span key={y}>{y}</span>
                    ))}
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-0.5 overflow-x-auto scroll-thin">
              <button onClick={() => p.onMonth(null)} className={`shrink-0 rounded-[2px] px-2 py-0.5 font-mono text-[10px] uppercase ${month === null ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}>
                Year
              </button>
              {MONTHS.map((m, i) => (
                <button key={m} onClick={() => p.onMonth(month === i + 1 ? null : i + 1)} className={`shrink-0 rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] uppercase ${month === i + 1 ? "bg-flame text-space" : "text-slate-400 hover:text-white"}`}>
                  {m}
                </button>
              ))}
              <span className="ml-auto hidden pl-2 font-mono text-[9.5px] text-slate-500 md:inline">Click a country to analyse it</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorldLegend({ layer, target }: { layer: MapLayer; target: { year: number; month: number } }) {
  if (layer === "hotspots")
    return (
      <div>
        <div className="eyebrow mb-1 !text-[9.5px]">Emerging hot spots · 1° cells · Gi* + Mann-Kendall</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {Object.values(HOTSPOT_FAMILY).map((f) => (
            <span key={f.label} className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="h-2.5 w-2.5 rounded-[1px]" style={{ background: f.color }} />
              {f.label}
            </span>
          ))}
        </div>
      </div>
    );
  if (layer === "outlook")
    return (
      <div>
        <div className="eyebrow mb-1 !text-[9.5px]">
          Fire risk outlook · {MONTHS[target.month - 1]} {target.year} · per 1° cell
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {RISK_CLASSES.map((c) => (
            <span key={c.label} className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="h-2.5 w-2.5 rounded-[1px]" style={{ background: c.color }} />
              {c.label}
            </span>
          ))}
        </div>
      </div>
    );
  if (layer === "anomaly")
    return (
      <div className="flex items-center gap-2">
        <span className="eyebrow !text-[9.5px]">Change vs previous 10 yrs</span>
        <span className="font-mono text-[9px] uppercase text-blue-300">Below</span>
        <span className="h-1.5 w-24 rounded-[1px]" style={{ background: `linear-gradient(90deg, ${divergingColor(-1)}, ${divergingColor(0)}, ${divergingColor(1)})` }} />
        <span className="font-mono text-[9px] uppercase text-orange-300">Above</span>
      </div>
    );
  if (layer === "live")
    return <div className="max-w-xs text-[11px] text-slate-300">The live 7-day feed covers the Bangladesh study area. Pick Bangladesh in the sidebar for live fires. Showing annual activity.</div>;
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow !text-[9.5px]">Harmonized fire-days per 1° cell</span>
      <span className="font-mono text-[9px] uppercase text-slate-500">Low</span>
      <span className="h-1.5 w-20 rounded-[1px]" style={{ background: `linear-gradient(90deg, ${heat(0.2)}, ${heat(0.5)}, ${heat(0.75)}, ${heat(1)})` }} />
      <span className="font-mono text-[9px] uppercase text-slate-500">High</span>
    </div>
  );
}

function Hover({ onMove }: { onMove: (lat: number, lon: number, x: number, y: number) => void }) {
  useMapEvents({
    mousemove(e) {
      onMove(e.latlng.lat, ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180, e.containerPoint.x, e.containerPoint.y);
    },
  });
  return null;
}

function FitBBox({ bbox, world }: { bbox: BBox; world: boolean }) {
  const map = useMap();
  const key = bbox.join(",");
  useEffect(() => {
    if (world) map.flyTo([15, 20], 2, { duration: 1 });
    else
      map.flyToBounds(
        [
          [bbox[1], bbox[0]],
          [bbox[3], bbox[2]],
        ],
        { padding: [50, 50], duration: 1.1, maxZoom: 7 },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, world, map]);
  return null;
}

function ZoomCtl() {
  const map = useMap();
  useEffect(() => {
    const c = L.control.zoom({ position: "topright" });
    c.addTo(map);
    return () => {
      c.remove();
    };
  }, [map]);
  return null;
}
