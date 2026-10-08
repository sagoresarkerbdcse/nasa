import { AnimatePresence, motion } from "framer-motion";
import { DARK_BASE, FEATURES, GIBS, LABELS } from "../lib/basemaps";
import L from "leaflet";
import { Box, Crosshair, Layers, Pause, Play, Radio, Satellite, SquareDashedMousePointer, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { fmt, heat, powScale } from "../lib/color";
import { cellValues } from "../lib/harmonize";
import { MONTHS, REGIONS } from "../lib/regions";
import { HOTSPOT_FAMILY, HOTSPOT_META, RISK_CLASSES, cellAnomaly, cellOutlook, divergingColor, emergingHotspots, riskClass } from "../lib/analytics";
import type { BBox, GridFile, LiveFile, MapLayer, PointsFile, SensorView } from "../lib/types";
import { Globe } from "./Globe";
import { EmberCanvas, type EmberSource } from "./EmberCanvas";

interface Props {
  grid: GridFile;
  points: PointsFile | null;
  bbox: BBox;
  regionId: string;
  regionName: string;
  onRegion: (id: string) => void;
  onCustomBBox: (b: BBox) => void;
  view: SensorView;
  onView: (v: SensorView) => void;
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
  live: LiveFile | null;
  outlookTarget: { year: number; month: number };
  outlookScale: number;
  /** Incremented by the sidebar's "Draw your own area" button. */
  drawSignal?: number;
}

const LAYERS: { id: MapLayer; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "anomaly", label: "Anomaly" },
  { id: "hotspots", label: "Hot-spot trends" },
  { id: "outlook", label: "Outlook" },
  { id: "live", label: "Live 7d" },
];

const NO_CELLS: { t: number; ll: [number, number] }[] = [];
const SENSOR_COLORS: Record<number, string> = { 0: "#c084fc", 1: "#ffe08a", 2: "#ff9a52", 3: "#ff5a3f" };
const SENSOR_NAMES: Record<number, string> = { 0: "MODIS", 1: "VIIRS S-NPP", 2: "VIIRS NOAA-20", 3: "VIIRS NOAA-21" };

const VIEWS: { id: SensorView; label: string; sub: string }[] = [
  { id: "harmonized", label: "Harmonized", sub: "fire-days" },
  { id: "modis", label: "MODIS", sub: "1 km" },
  { id: "viirs", label: "VIIRS", sub: "375 m" },
];

type Basemap = "black" | "blue" | "true" | "dark";
const BASEMAPS: { id: Basemap; label: string }[] = [
  { id: "black", label: "Black Marble" },
  { id: "true", label: "True Color" },
  { id: "blue", label: "Blue Marble" },
  { id: "dark", label: "Dark" },
];

function basemapLayer(b: Basemap, year: number, month: number | null, viirsStart: number) {
  const date = `${year}-${String(month ?? 3).padStart(2, "0")}-15`;
  switch (b) {
    case "black":
      return { url: `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, max: 8, attr: "NASA GIBS · VIIRS Black Marble" };
    case "blue":
      return { url: `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`, max: 8, attr: "NASA GIBS · Blue Marble" };
    case "true": {
      const layer = year >= viirsStart ? "VIIRS_SNPP_CorrectedReflectance_TrueColor" : "MODIS_Terra_CorrectedReflectance_TrueColor";
      return { url: `${GIBS}/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, max: 9, attr: `NASA GIBS · ${year >= viirsStart ? "VIIRS" : "MODIS Terra"} true color ${date}` };
    }
    default:
      return DARK_BASE;
  }
}

const toBounds = (b: BBox): L.LatLngBoundsExpression => [
  [b[1], b[0]],
  [b[3], b[2]],
];

export function MapPanel(p: Props) {
  const { grid, points, bbox, view, year, month } = p;
  const [drawing, setDrawing] = useState(false);
  useEffect(() => {
    if (p.drawSignal) setDrawing(true);
  }, [p.drawSignal]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [embers, setEmbers] = useState<EmberSource[]>([]);
  const [basemap, setBasemap] = useState<Basemap>("black");
  const [gibsDown, setGibsDown] = useState(false);
  const coordRef = useRef<HTMLSpanElement>(null);
  const canvas = useMemo(() => L.canvas({ padding: 0.3 }), []);
  const viirsMissing = view === "viirs" && year < grid.meta.viirsStartYear;

  const values = useMemo(() => cellValues(grid, year, view, month ?? undefined), [grid, year, view, month]);
  const max = useMemo(() => {
    let m = 1;
    for (let y = grid.meta.firstYear; y <= grid.meta.lastYear; y++) for (const v of cellValues(grid, y, view, month ?? undefined).values()) m = Math.max(m, v);
    return m;
  }, [grid, view, month]);
  const total = useMemo(() => [...values.values()].reduce((s, v) => s + v, 0), [values]);
  const cells = useMemo(
    () => [...values.entries()].map(([i, v]) => ({ i, v, t: powScale(v, max), ll: [grid.cells[i][1], grid.cells[i][0]] as [number, number] })).sort((a, b) => a.v - b.v),
    [values, max, grid],
  );
  const yearPoints = useMemo(() => {
    const pts = points?.byYear[year] ?? [];
    return pts.filter((pt) => (!month || pt[4] === month) && (view === "harmonized" || (view === "modis" ? pt[2] === 0 : pt[2] === 1)));
  }, [points, year, month, view]);

  const effectiveBase = gibsDown && basemap !== "dark" ? "dark" : basemap;
  const base = basemapLayer(effectiveBase, year, month, grid.meta.viirsStartYear);
  // One counter set per basemap URL (memoized so re-renders don't reset it).
  const tileHandlers = useMemo(() => tileFallback(() => setGibsDown(true), effectiveBase !== "dark"), [base.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const years = grid.meta.lastYear - grid.meta.firstYear + 1;
  const animKey = `${year}-${month ?? 0}-${view}`;
  const { layer } = p;
  const cellSize = grid.meta.cellSize;
  const cellBounds = (i: number): L.LatLngBoundsExpression => {
    const [lon, lat] = grid.cells[i];
    return [
      [lat - cellSize / 2, lon - cellSize / 2],
      [lat + cellSize / 2, lon + cellSize / 2],
    ];
  };
  const anomalies = useMemo(() => (layer === "anomaly" ? cellAnomaly(grid, year, month ?? undefined) : null), [layer, grid, year, month]);
  const hotspots = useMemo(() => (layer === "hotspots" ? emergingHotspots(grid).filter((c) => c.category !== "none") : null), [layer, grid]);
  const risk = useMemo(() => (layer === "outlook" ? cellOutlook(grid, p.outlookTarget.month, p.outlookScale) : null), [layer, grid, p.outlookTarget.month, p.outlookScale]);
  const liveLatest = useMemo(() => {
    const d = p.live?.detections ?? [];
    return d.length ? Math.max(...d.map((x) => Date.parse(`${x[5]}T${x[6].slice(0, 2)}:${x[6].slice(2)}:00Z`))) : 0;
  }, [p.live]);
  const liveDets = useMemo(
    () =>
      (p.live?.detections ?? []).map((d) => ({
        d,
        recent: liveLatest - Date.parse(`${d[5]}T${d[6].slice(0, 2)}:${d[6].slice(2)}:00Z`) <= 24 * 3600 * 1000,
      })),
    [p.live, liveLatest],
  );
  const globeSpikes = useMemo(() => cells.map((c) => ({ lon: c.ll[1], lat: c.ll[0], t: c.t })), [cells]);
  const globeLive = useMemo(() => liveDets.map(({ d, recent }) => ({ lon: d[0], lat: d[1], recent })), [liveDets]);
  const timeLayer = layer === "activity" || layer === "anomaly";

  return (
    <section className="panel hud flex h-full min-h-[480px] flex-col overflow-hidden" aria-label="Spatial view">
      <header className="panel-head flex items-center gap-3 px-4 py-2.5">
        <span className="font-mono text-[10.5px] text-signal">01</span>
        <h2 className="eyebrow shrink-0 whitespace-nowrap !text-slate-200">Spatial view</h2>
        <span className="hidden min-w-0 truncate text-[12px] text-slate-400 md:inline">· {p.regionName}</span>
        <div className="ml-auto hidden items-center gap-1.5 font-mono text-[10.5px] text-slate-400 sm:flex">
          <Crosshair className="h-3.5 w-3.5 text-slate-500" />
          <span ref={coordRef} className="tabular-nums">--.---°N --.---°E</span>
        </div>
      </header>
      <div className="border-b border-white/[0.06] bg-black/20">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-3 py-1.5 scroll-thin" role="tablist" aria-label="Map layer">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={layer === l.id}
              onClick={() => p.onLayer(l.id)}
              className={`relative shrink-0 rounded-[3px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${layer === l.id ? "text-white" : "text-slate-400 hover:text-white"}`}
            >
              {layer === l.id && <motion.span layoutId="layer-pill" className="absolute inset-0 rounded-[3px] bg-nasa-blue" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="relative flex items-center gap-1">
                {l.id === "live" && <Radio className={`h-3 w-3 ${layer === "live" ? "" : "text-nasa-red"}`} />}
                {l.label}
              </span>
            </button>
          ))}
          <button
            onClick={() => p.onView3d(!p.view3d)}
            className={`ml-1 flex shrink-0 items-center gap-1 rounded-[3px] border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${p.view3d ? "border-cyan bg-cyan/15 text-cyan" : "border-white/10 text-slate-300 hover:border-white/30"}`}
            aria-pressed={p.view3d}
          >
            <Box className="h-3 w-3" /> 3D
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <MapContainer center={[23.6, 90.4]} zoom={7} minZoom={5} maxZoom={12} zoomControl={false} className={`absolute inset-0 h-full w-full ${drawing ? "cursor-crosshair" : ""}`} attributionControl>
          <TileLayer
            key={base.url}
            url={base.url}
            maxNativeZoom={base.max}
            maxZoom={12}
            attribution={`${base.attr} · Fire data: NASA FIRMS`}
            eventHandlers={tileHandlers}
          />
          <TileLayer url={FEATURES.url} maxNativeZoom={FEATURES.max} maxZoom={12} opacity={0.45} zIndex={640} attribution="Labels: NASA GIBS / © OpenStreetMap" />
          <TileLayer url={LABELS.url} maxNativeZoom={LABELS.max} maxZoom={12} opacity={0.85} zIndex={650} />
          <FitToBBox bbox={bbox} />
          <ZoomControl />
          <MouseCoords target={coordRef} />
          <EmberSources cells={layer === "activity" ? cells : NO_CELLS} onChange={setEmbers} />
          <Rectangle bounds={toBounds(bbox)} pathOptions={{ color: "#4d8eff", weight: 1.5, dashArray: "2 6", fillColor: "#0b3d91", fillOpacity: 0.06 }} interactive={false} />
          {layer === "activity" && cells.map((c) => (
            <CircleMarker
              key={`${animKey}-${c.i}-g`}
              center={c.ll}
              radius={6 + 22 * c.t}
              className="fc-cell"
              pathOptions={{ stroke: false, fillColor: heat(c.t), fillOpacity: 0.1 + 0.14 * c.t }}
              interactive={false}
            />
          ))}
          {layer === "activity" && cells.map((c) => (
            <CircleMarker
              key={`${animKey}-${c.i}`}
              center={c.ll}
              radius={2.5 + 9 * c.t}
              className={c.t > 0.82 ? "fc-cell-hot" : "fc-cell"}
              pathOptions={{ stroke: c.t > 0.82, color: "#fff7d6", weight: 1, fillColor: heat(0.2 + 0.8 * c.t), fillOpacity: 0.9 }}
              eventHandlers={{ mouseover: () => setHovered(c.i), mouseout: () => setHovered((h) => (h === c.i ? null : h)) }}
            >
              <Tooltip className="fc-tip" direction="top" offset={[0, -6]}>
                <div className="font-medium text-orange-300">
                  {fmt(c.v)} {view === "harmonized" ? "fire-days" : "hotspots"}
                </div>
                <div className="text-slate-400">
                  {c.ll[0].toFixed(2)}°N {c.ll[1].toFixed(2)}°E · {month ? `${MONTHS[month - 1]} ` : ""}
                  {year}
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
          {layer === "activity" && yearPoints.map((pt, i) => (
            <CircleMarker
              key={`p${i}`}
              center={[pt[1], pt[0]]}
              radius={pt[2] === 0 ? 1.8 : 1.3}
              renderer={canvas}
              pathOptions={{ stroke: false, fillColor: pt[2] === 0 ? "#ff9a52" : "#ffe08a", fillOpacity: pt[3] === 0 ? 0.25 : 0.75 }}
              interactive={false}
            />
          ))}
          {anomalies &&
            [...anomalies.entries()].map(([i, a]) => {
              const up = a.change > 0;
              const t = Math.max(-1, Math.min(1, a.change / 1.5));
              return (
                <Rectangle
                  key={`an-${animKey}-${i}`}
                  bounds={cellBounds(i)}
                  className="fc-cell"
                  pathOptions={{ color: "#0c1016", weight: 1, fillColor: divergingColor(t), fillOpacity: 0.78 }}
                >
                  <Tooltip className="fc-tip" direction="top">
                    <div className={up ? "text-orange-300" : "text-blue-300"}>
                      {up ? "+" : ""}
                      {Math.round(a.change * 100)}% vs previous 10 yrs
                    </div>
                    <div className="text-slate-400">
                      {fmt(a.value)} fire-days vs {fmt(a.baseline)} normal · {month ? `${MONTHS[month - 1]} ` : ""}
                      {year}
                    </div>
                  </Tooltip>
                </Rectangle>
              );
            })}
          {hotspots?.map((c) => (
            <Rectangle
              key={`hs-${c.cell}`}
              bounds={cellBounds(c.cell)}
              className="fc-cell"
              pathOptions={{
                color: HOTSPOT_META[c.category].outline === "none" ? "#0c1016" : "#ffffff",
                weight: HOTSPOT_META[c.category].outline === "none" ? 1 : 1.6,
                dashArray: HOTSPOT_META[c.category].outline === "dashed" ? "3 3" : undefined,
                fillColor: HOTSPOT_META[c.category].color,
                fillOpacity: 0.72,
              }}
            >
              <Tooltip className="fc-tip" direction="top">
                <div className="text-white">{HOTSPOT_META[c.category].label} hot spot</div>
                <div className="text-slate-400">
                  hot in {c.hotYears} yrs · ~{fmt(c.meanFireDays)} fire-days/yr
                </div>
                <div className="text-slate-500">{HOTSPOT_META[c.category].blurb}</div>
              </Tooltip>
            </Rectangle>
          ))}
          {risk &&
            [...risk.entries()].map(([i, v]) => {
              const rc = riskClass(v);
              return (
                <Rectangle key={`rk-${i}-${p.outlookTarget.month}`} bounds={cellBounds(i)} className="fc-cell" pathOptions={{ color: "#0c1016", weight: 1, fillColor: rc.color, fillOpacity: v < 1 ? 0.35 : 0.82 }}>
                  <Tooltip className="fc-tip" direction="top">
                    <div className="text-white">{rc.label} risk</div>
                    <div className="text-slate-400">
                      ~{fmt(v)} expected fire-days · {MONTHS[p.outlookTarget.month - 1]} {p.outlookTarget.year}
                    </div>
                  </Tooltip>
                </Rectangle>
              );
            })}
          {layer === "live" &&
            liveDets.map(({ d, recent }, i) => (
              <CircleMarker
                key={`lv-${i}`}
                center={[d[1], d[0]]}
                radius={recent ? 4.5 : 3}
                pathOptions={{ color: "#fff", weight: recent ? 1 : 0, fillColor: SENSOR_COLORS[d[2]], fillOpacity: recent ? 1 : 0.65 }}
              >
                <Tooltip className="fc-tip" direction="top">
                  <div style={{ color: SENSOR_COLORS[d[2]] }}>{SENSOR_NAMES[d[2]]}</div>
                  <div className="text-slate-400">
                    {d[5]} {d[6].slice(0, 2)}:{d[6].slice(2)} UTC · {d[7] ? "night" : "day"}
                  </div>
                  <div className="text-slate-400">
                    FRP {d[4]} MW · {["low", "nominal", "high"][d[3]]} confidence
                  </div>
                </Tooltip>
              </CircleMarker>
            ))}
          {layer === "live" &&
            liveDets
              .filter((x) => x.recent)
              .slice(-60)
              .map(({ d }, i) => (
                <Marker
                  key={`lp-${i}`}
                  position={[d[1], d[0]]}
                  interactive={false}
                  icon={L.divIcon({ className: "", html: '<div class="fc-pulse" style="width:18px;height:18px"><span style="border-color:#fc3d21;box-shadow:0 0 14px #fc3d21"></span></div>', iconSize: [18, 18] })}
                />
              ))}
          {hovered !== null && grid.cells[hovered] && (
            <Marker
              position={[grid.cells[hovered][1], grid.cells[hovered][0]]}
              interactive={false}
              icon={L.divIcon({ className: "", html: '<div class="fc-pulse" style="width:22px;height:22px"><span></span><span></span></div>', iconSize: [22, 22] })}
            />
          )}
          {drawing && (
            <DrawBox
              onDone={(b) => {
                setDrawing(false);
                if (b) p.onCustomBBox(b);
              }}
            />
          )}
        </MapContainer>

        <EmberCanvas sources={embers} />
        <AnimatePresence>
          {p.view3d && (
            <motion.div key="globe" className="absolute inset-0 z-[480]" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.6 }}>
              <Globe spikes={layer === "live" ? [] : globeSpikes} live={layer === "live" || layer === "activity" ? globeLive : []} bbox={bbox} label={p.regionName} />
            </motion.div>
          )}
        </AnimatePresence>
        <LayerLegend layer={layer} live={p.live} target={p.outlookTarget} />

        {/* Satellite swath sweep */}
        <div className="pointer-events-none absolute inset-0 z-[440] overflow-hidden" aria-hidden>
          <div className="absolute inset-y-0 left-0 w-[18%] animate-sweep">
            <div className="h-full w-full bg-gradient-to-r from-transparent via-signal/[0.03] to-signal/[0.08]" />
            <div className="absolute inset-y-0 right-0 w-px bg-signal/60 shadow-[0_0_12px_rgba(77,142,255,0.9)]" />
            <span className="absolute right-2 top-[45%] font-mono text-[9px] uppercase tracking-[0.2em] text-signal/80">Swath</span>
          </div>
        </div>

        {/* Row 1: sensor switcher */}
        <div className={`absolute left-3 top-3 z-[500] transition-opacity ${layer === "activity" && !p.view3d ? "" : "pointer-events-none opacity-0"}`}>
          <div className="flex items-center rounded-[4px] border border-white/10 bg-[#070a0f]/90 p-0.5 backdrop-blur" role="tablist" aria-label="Sensor view">
            <Satellite className="mx-2 h-3.5 w-3.5 text-slate-500" aria-hidden />
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => p.onView(v.id)}
                className={`relative flex items-center gap-1.5 rounded-[3px] px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-wider transition-colors ${view === v.id ? "text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                {view === v.id && <motion.span layoutId="sensor-pill" className="absolute inset-0 rounded-[3px] bg-gradient-to-r from-ember to-flame" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className="relative flex h-1.5 w-1.5">
                  {view === v.id && <span className="absolute inline-flex h-full w-full animate-radar rounded-full bg-white" />}
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${view === v.id ? "bg-white" : "bg-slate-600"}`} />
                </span>
                <span className="relative">{v.label}</span>
                <span className="relative hidden normal-case opacity-70 md:inline">{v.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: AOI + basemap */}
        <div className="absolute left-3 right-14 top-[50px] z-[500] flex flex-wrap items-start gap-1.5">
          {REGIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => p.onRegion(r.id)}
              title={r.blurb}
              className={`rounded-[3px] border px-2.5 py-1 text-[11.5px] font-medium backdrop-blur transition-all ${
                p.regionId === r.id ? "border-signal bg-nasa-blue/80 text-white shadow-[0_0_14px_rgba(77,142,255,0.45)]" : "border-white/10 bg-[#070a0f]/85 text-slate-300 hover:border-white/30"
              }`}
            >
              {r.short}
            </button>
          ))}
          <button
            onClick={() => setDrawing((d) => !d)}
            className={`flex items-center gap-1.5 rounded-[3px] border px-2.5 py-1 text-[11.5px] font-medium backdrop-blur transition-all ${
              drawing || p.regionId === "custom" ? "border-cyan bg-cyan/15 text-cyan" : "border-white/10 bg-[#070a0f]/85 text-slate-300 hover:border-white/30"
            }`}
          >
            {drawing ? <X className="h-3.5 w-3.5" /> : <SquareDashedMousePointer className="h-3.5 w-3.5" />}
            {drawing ? "Cancel" : "Draw AOI"}
          </button>
          <select
            value={basemap}
            onChange={(e) => {
              setBasemap(e.target.value as Basemap);
              setGibsDown(false);
            }}
            aria-label="Basemap"
            className={`ml-auto rounded-[3px] border border-white/10 bg-[#070a0f]/90 px-2 py-1 font-mono text-[10px] uppercase text-slate-200 sm:hidden ${p.view3d ? "invisible" : ""}`}
          >
            {BASEMAPS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <div className={`ml-auto hidden items-center rounded-[3px] border border-white/10 bg-[#070a0f]/85 p-0.5 backdrop-blur sm:flex ${p.view3d ? "invisible" : ""}`}>
            <Layers className="mx-1.5 h-3.5 w-3.5 text-slate-500" aria-hidden />
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setBasemap(b.id);
                  setGibsDown(false);
                }}
                className={`rounded-[2px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${basemap === b.id ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence>
          {drawing && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute left-1/2 top-[96px] z-[500] -translate-x-1/2 rounded-[3px] bg-cyan px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-space shadow-lg">
              Click and drag to define your area of interest
            </motion.div>
          )}
          {gibsDown && basemap !== "dark" && !p.view3d && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute bottom-[112px] left-1/2 z-[500] w-max max-w-[90%] -translate-x-1/2 rounded-[3px] border border-amber-300/30 bg-[#070a0f]/90 px-3 py-1.5 font-mono text-[10.5px] text-amber-200">
              NASA GIBS imagery unreachable. Showing the dark basemap.
            </motion.div>
          )}
          {viirsMissing && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-[112px] left-1/2 z-[500] -translate-x-1/2 whitespace-nowrap rounded-[3px] border border-amber-300/30 bg-[#070a0f]/90 px-3 py-2 font-mono text-[11px] text-amber-200"
            >
              VIIRS (Suomi NPP) data begins in {grid.meta.viirsStartYear}.
            </motion.div>
          )}
        </AnimatePresence>

        {/* Time playbar */}
        <div className={`absolute inset-x-3 bottom-3 z-[500] transition-opacity ${timeLayer ? "" : "pointer-events-none opacity-0"}`} aria-hidden={!timeLayer}>
          <div className="rounded-[4px] border border-white/10 bg-[#070a0f]/90 px-3 py-2.5 backdrop-blur sm:px-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => p.onPlaying(!p.playing)}
                aria-label={p.playing ? "Pause" : "Play through years"}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[3px] bg-nasa-red text-white shadow-[0_0_18px_rgba(252,61,33,0.5)] transition-transform hover:scale-105 active:scale-95"
              >
                {p.playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </button>
              <div className="w-[74px] shrink-0">
                <motion.div key={year} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="font-mono text-[22px] font-medium leading-none tabular-nums text-white">
                  {year}
                </motion.div>
                <div className="eyebrow mt-1 !text-[9.5px]">{month ? MONTHS[month - 1] : "Full year"}</div>
              </div>
              <div className="min-w-0 flex-1">
                <input type="range" className="fc-range w-full" min={grid.meta.firstYear} max={grid.meta.lastYear} value={year} onChange={(e) => p.onYear(Number(e.target.value))} aria-label="Year" />
                <div className="flex justify-between font-mono text-[9px] text-slate-500">
                  {Array.from({ length: years }, (_, i) => grid.meta.firstYear + i)
                    .filter((y) => y % 5 === 0 || y === grid.meta.firstYear || y === grid.meta.lastYear)
                    .map((y) => (
                      <span key={y} className={y === grid.meta.viirsStartYear ? "text-signal" : ""}>
                        {y}
                      </span>
                    ))}
                </div>
              </div>
              <div className="hidden shrink-0 border-l border-white/10 pl-3 text-right md:block">
                <div className="font-mono text-[15px] tabular-nums text-orange-300">{fmt(total)}</div>
                <div className="eyebrow !text-[9px]">{view === "harmonized" ? "fire-days" : "hotspots"}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-0.5 overflow-x-auto scroll-thin">
              <button onClick={() => p.onMonth(null)} className={`shrink-0 rounded-[2px] px-2 py-0.5 font-mono text-[10px] uppercase ${month === null ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}>
                All
              </button>
              {MONTHS.map((m, i) => (
                <button
                  key={m}
                  onClick={() => p.onMonth(month === i + 1 ? null : i + 1)}
                  className={`shrink-0 rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] uppercase ${month === i + 1 ? "bg-flame text-space" : "text-slate-400 hover:text-white"}`}
                >
                  {m}
                </button>
              ))}
              {layer === "anomaly" ? (
                <div className="ml-auto hidden items-center gap-2 pl-2 sm:flex">
                  <span className="font-mono text-[9px] uppercase text-blue-300">Below normal</span>
                  <span className="h-1.5 w-24 rounded-[1px]" style={{ background: `linear-gradient(90deg, ${divergingColor(-1)}, ${divergingColor(0)}, ${divergingColor(1)})` }} />
                  <span className="font-mono text-[9px] uppercase text-orange-300">Above</span>
                </div>
              ) : (
                <div className="ml-auto hidden items-center gap-2 pl-2 sm:flex">
                  <span className="font-mono text-[9px] uppercase text-slate-500">Low</span>
                  <span className="h-1.5 w-20 rounded-[1px]" style={{ background: `linear-gradient(90deg, ${heat(0.2)}, ${heat(0.5)}, ${heat(0.75)}, ${heat(1)})` }} />
                  <span className="font-mono text-[9px] uppercase text-slate-500">High</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Switch to the dark basemap if the first tiles all fail (e.g. GIBS blocked by a network). */
function tileFallback(onDown: () => void, active: boolean): L.LeafletEventHandlerFnMap {
  let errors = 0;
  let loads = 0;
  return {
    tileload: () => {
      loads++;
    },
    tileerror: () => {
      errors++;
      if (active && loads === 0 && errors >= 6) onDown();
    },
  };
}

function MouseCoords({ target }: { target: React.RefObject<HTMLSpanElement | null> }) {
  useMapEvents({
    mousemove(e) {
      if (target.current) target.current.textContent = `${e.latlng.lat.toFixed(3)}°N ${e.latlng.lng.toFixed(3)}°E`;
    },
  });
  return null;
}

function FitToBBox({ bbox }: { bbox: BBox }) {
  const map = useMap();
  const key = bbox.join(",");
  useEffect(() => {
    map.flyToBounds(toBounds(bbox), { padding: [60, 60], duration: 1.1, maxZoom: 8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function ZoomControl() {
  const map = useMap();
  useEffect(() => {
    const ctl = L.control.zoom({ position: "topright" });
    ctl.addTo(map);
    return () => {
      ctl.remove();
    };
  }, [map]);
  return null;
}

/** Projects the hottest cells to screen space for the ember canvas. */
function EmberSources({ cells, onChange }: { cells: { t: number; ll: [number, number] }[]; onChange: (s: EmberSource[]) => void }) {
  const map = useMap();
  const update = () => {
    const top = [...cells].sort((a, b) => b.t - a.t).slice(0, 24).filter((c) => c.t > 0.45);
    onChange(top.map((c) => ({ ...map.latLngToContainerPoint(c.ll), t: c.t })));
  };
  useMapEvents({ move: update, zoom: update, resize: update });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(update, [cells, map]);
  return null;
}

function DrawBox({ onDone }: { onDone: (b: BBox | null) => void }) {
  const map = useMap();
  const start = useRef<L.LatLng | null>(null);
  const [cur, setCur] = useState<L.LatLngBounds | null>(null);
  useEffect(() => {
    map.dragging.disable();
    map.boxZoom.disable();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone(null);
    window.addEventListener("keydown", onKey);
    return () => {
      map.dragging.enable();
      map.boxZoom.enable();
      window.removeEventListener("keydown", onKey);
    };
  }, [map, onDone]);
  useMapEvents({
    mousedown(e) {
      start.current = e.latlng;
      setCur(L.latLngBounds(e.latlng, e.latlng));
    },
    mousemove(e) {
      if (start.current) setCur(L.latLngBounds(start.current, e.latlng));
    },
    mouseup() {
      if (!cur || !start.current) return;
      start.current = null;
      const sw = cur.getSouthWest();
      const ne = cur.getNorthEast();
      if (Math.abs(ne.lat - sw.lat) < 0.15 || Math.abs(ne.lng - sw.lng) < 0.15) {
        setCur(null);
        return;
      }
      onDone([round2(sw.lng), round2(sw.lat), round2(ne.lng), round2(ne.lat)]);
    },
  });
  return cur ? <Rectangle bounds={cur} pathOptions={{ color: "#38d3f0", weight: 2, dashArray: "4 4", fillOpacity: 0.08 }} /> : null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function LayerLegend({ layer, live, target }: { layer: MapLayer; live: LiveFile | null; target: { year: number; month: number } }) {
  if (layer === "activity" || layer === "anomaly") return null; // these share the time playbar legend
  const box = "absolute bottom-3 left-3 z-[500] max-w-[calc(100%-1.5rem)] rounded-[4px] border border-white/10 bg-[#070a0f]/92 px-3 py-2.5 backdrop-blur";
  if (layer === "hotspots")
    return (
      <motion.div key="lg-hs" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={box}>
        <div className="eyebrow mb-1.5 !text-[9.5px]">Emerging hot spots · Gi* + Mann-Kendall · 2003–present</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {Object.values(HOTSPOT_FAMILY).map((f) => (
            <span key={f.label} className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="h-2.5 w-2.5 rounded-[1px]" style={{ background: f.color }} />
              {f.label}
            </span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[9.5px] text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 border border-white" /> intensifying / new</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 border border-dashed border-white" /> consecutive / historical</span>
          <span>no outline: persistent / diminishing</span>
        </div>
      </motion.div>
    );
  if (layer === "outlook")
    return (
      <motion.div key="lg-ol" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={box}>
        <div className="eyebrow mb-1.5 !text-[9.5px]">
          Fire risk outlook · {MONTHS[target.month - 1]} {target.year} · expected fire-days per 0.25° cell
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {RISK_CLASSES.map((c, i) => (
            <span key={c.label} className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="h-2.5 w-2.5 rounded-[1px]" style={{ background: c.color }} />
              {c.label} <span className="font-mono text-[9.5px] text-slate-500">{i === 0 ? "<1" : c.max === Infinity ? `≥${RISK_CLASSES[i - 1].max}` : `${RISK_CLASSES[i - 1].max}–${c.max}`}</span>
            </span>
          ))}
        </div>
        <div className="mt-1 font-mono text-[9.5px] text-slate-500">Statistical model from past years. No weather input.</div>
      </motion.div>
    );
  // live
  const n = live?.detections.length ?? 0;
  return (
    <motion.div key="lg-lv" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={box}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-radar rounded-full bg-nasa-red" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-nasa-red" />
        </span>
        <span className="eyebrow !text-[9.5px] !text-slate-200">
          Live · last 7 days · {n} detections{live ? ` · updated ${new Date(live.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {[1, 2, 3, 0].map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SENSOR_COLORS[k] }} />
            {SENSOR_NAMES[k]}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-slate-300">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-nasa-red" /> last 24 h
        </span>
      </div>
      {n === 0 && <div className="mt-1 text-[11px] text-slate-500">No fires detected in the study area this week (off-season).</div>}
    </motion.div>
  );
}
