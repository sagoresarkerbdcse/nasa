import { AnimatePresence, motion } from "framer-motion";
import L from "leaflet";
import { Pause, Play, Satellite, SquareDashedMousePointer, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { fmt, heat, powScale } from "../lib/color";
import { cellValues } from "../lib/harmonize";
import { MONTHS, REGIONS } from "../lib/regions";
import type { BBox, GridFile, PointsFile, SensorView } from "../lib/types";
import { EmberCanvas, type EmberSource } from "./EmberCanvas";

interface Props {
  grid: GridFile;
  points: PointsFile | null;
  bbox: BBox;
  regionId: string;
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
}

const VIEWS: { id: SensorView; label: string; sub: string }[] = [
  { id: "harmonized", label: "Harmonized", sub: "fire-days" },
  { id: "modis", label: "MODIS", sub: "1 km" },
  { id: "viirs", label: "VIIRS", sub: "375 m" },
];

const toBounds = (b: BBox): L.LatLngBoundsExpression => [
  [b[1], b[0]],
  [b[3], b[2]],
];

export function MapPanel(p: Props) {
  const { grid, points, bbox, view, year, month } = p;
  const [drawing, setDrawing] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [embers, setEmbers] = useState<EmberSource[]>([]);
  const viirsMissing = view === "viirs" && year < grid.meta.viirsStartYear;

  const values = useMemo(() => cellValues(grid, year, view, month ?? undefined), [grid, year, view, month]);
  // Scale against the busiest year so the slider shows real year-to-year change.
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

  const years = grid.meta.lastYear - grid.meta.firstYear + 1;

  return (
    <div className="glass glass-warm relative h-full min-h-[460px] overflow-hidden rounded-2xl">
      <MapContainer
        center={[23.6, 90.4]}
        zoom={7}
        minZoom={5}
        maxZoom={12}
        preferCanvas
        zoomControl={false}
        className={`absolute inset-0 h-full w-full ${drawing ? "cursor-crosshair" : ""}`}
        attributionControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a> · Fire data: NASA FIRMS'
          subdomains="abcd"
        />
        <FitToBBox bbox={bbox} />
        <ZoomControl />
        <EmberSources cells={cells} onChange={setEmbers} />
        <Rectangle
          bounds={toBounds(bbox)}
          pathOptions={{ color: "#818cf8", weight: 1.5, dashArray: "6 6", fillColor: "#6366f1", fillOpacity: 0.04 }}
          interactive={false}
        />
        {cells.map((c) => (
          <CircleMarker
            key={`${c.i}-glow`}
            center={c.ll}
            radius={6 + 22 * c.t}
            pathOptions={{ stroke: false, fillColor: heat(c.t), fillOpacity: 0.12 + 0.12 * c.t }}
            interactive={false}
          />
        ))}
        {cells.map((c) => (
          <CircleMarker
            key={c.i}
            center={c.ll}
            radius={2.5 + 9 * c.t}
            pathOptions={{ stroke: false, fillColor: heat(0.2 + 0.8 * c.t), fillOpacity: 0.85 }}
            eventHandlers={{ mouseover: () => setHovered(c.i), mouseout: () => setHovered((h) => (h === c.i ? null : h)) }}
          >
            <Tooltip className="fc-tip" direction="top" offset={[0, -6]}>
              <div className="font-semibold text-orange-300">{fmt(c.v)} {view === "harmonized" ? "fire-days" : "hotspots"}</div>
              <div className="text-slate-400">
                {c.ll[0].toFixed(2)}°N {c.ll[1].toFixed(2)}°E · {month ? `${MONTHS[month - 1]} ` : ""}
                {year}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
        {yearPoints.map((pt, i) => (
          <CircleMarker
            key={`p${i}`}
            center={[pt[1], pt[0]]}
            radius={pt[2] === 0 ? 1.8 : 1.3}
            pathOptions={{ stroke: false, fillColor: pt[2] === 0 ? "#fb923c" : "#fde68a", fillOpacity: pt[3] === 0 ? 0.25 : 0.7 }}
            interactive={false}
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

      {/* Satellite switcher */}
      <div className="absolute left-3 top-3 z-[500]">
        <div className="glass flex items-center gap-1 rounded-full p-1 pr-1.5" role="tablist" aria-label="Sensor view">
          <Satellite className="ml-2 mr-1 h-4 w-4 text-slate-400" aria-hidden />
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => p.onView(v.id)}
              className={`relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${view === v.id ? "text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {view === v.id && (
                <motion.span layoutId="sensor-pill" className="absolute inset-0 rounded-full bg-gradient-to-r from-ember/80 via-flame/80 to-solar/70 shadow-[0_0_20px_rgba(249,115,22,0.45)]" transition={{ type: "spring", stiffness: 420, damping: 32 }} />
              )}
              <span className="relative flex h-2 w-2">
                {view === v.id && <span className="absolute inline-flex h-full w-full animate-radar rounded-full bg-white" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${view === v.id ? "bg-white" : "bg-slate-600"}`} />
              </span>
              <span className="relative">{v.label}</span>
              <span className="relative hidden font-mono text-[10px] font-normal opacity-75 sm:inline">{v.sub}</span>
            </button>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {viirsMissing && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-[112px] left-1/2 z-[500] -translate-x-1/2 whitespace-nowrap rounded-xl border border-amber-300/30 bg-ink-900/90 px-3 py-2 text-xs text-amber-200"
          >
            VIIRS launched in late 2011. Its data starts in {grid.meta.viirsStartYear}.
          </motion.div>
        )}
      </AnimatePresence>

      {/* AOI selector */}
      <div className="absolute left-3 right-16 top-[60px] z-[500] flex flex-wrap gap-1.5">
        {REGIONS.map((r) => (
          <button
            key={r.id}
            onClick={() => p.onRegion(r.id)}
            title={r.blurb}
            className={`glass rounded-full px-3 py-1.5 text-xs font-medium transition-all hover:-translate-y-0.5 ${p.regionId === r.id ? "!border-ai/60 text-white shadow-[0_0_18px_rgba(99,102,241,0.45)]" : "text-slate-300"}`}
          >
            {r.short}
          </button>
        ))}
        <button
          onClick={() => setDrawing((d) => !d)}
          className={`glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all hover:-translate-y-0.5 ${drawing || p.regionId === "custom" ? "!border-ai-2/60 text-teal-200 shadow-[0_0_18px_rgba(20,184,166,0.4)]" : "text-slate-300"}`}
        >
          {drawing ? <X className="h-3.5 w-3.5" /> : <SquareDashedMousePointer className="h-3.5 w-3.5" />}
          {drawing ? "Cancel" : "Draw AOI"}
        </button>
      </div>
      <AnimatePresence>
        {drawing && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute left-1/2 top-[104px] z-[500] -translate-x-1/2 rounded-full bg-teal-500/90 px-4 py-1.5 text-xs font-semibold text-ink-950 shadow-lg">
            Click and drag on the map to draw your area of interest
          </motion.div>
        )}
      </AnimatePresence>

      {/* Time playbar */}
      <div className="absolute inset-x-3 bottom-3 z-[500]">
        <div className="glass glass-warm rounded-2xl px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => p.onPlaying(!p.playing)}
              aria-label={p.playing ? "Pause" : "Play through years"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-flame to-ember text-white shadow-[0_0_18px_rgba(249,115,22,0.6)] transition-transform hover:scale-105 active:scale-95"
            >
              {p.playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
            <div className="w-[72px] shrink-0">
              <motion.div key={year} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="font-mono text-xl font-semibold leading-none text-white">
                {year}
              </motion.div>
              <div className="mt-1 font-mono text-[10px] text-slate-400">{month ? MONTHS[month - 1] : "All year"}</div>
            </div>
            <div className="min-w-0 flex-1">
              <input
                type="range"
                className="fc-range w-full"
                min={grid.meta.firstYear}
                max={grid.meta.lastYear}
                value={year}
                onChange={(e) => p.onYear(Number(e.target.value))}
                aria-label="Year"
              />
              <div className="flex justify-between font-mono text-[9px] text-slate-500">
                {Array.from({ length: years }, (_, i) => grid.meta.firstYear + i)
                  .filter((y) => y % 5 === 0 || y === grid.meta.firstYear || y === grid.meta.lastYear)
                  .map((y) => (
                    <span key={y} className={y === grid.meta.viirsStartYear ? "text-amber-300" : ""}>
                      {y}
                    </span>
                  ))}
              </div>
            </div>
            <div className="hidden shrink-0 text-right md:block">
              <div className="font-mono text-sm font-semibold text-orange-300">{fmt(total)}</div>
              <div className="text-[10px] text-slate-400">{view === "harmonized" ? "fire-days" : "hotspots"} in view</div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 overflow-x-auto scroll-thin">
            <button onClick={() => p.onMonth(null)} className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${month === null ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`}>
              ALL
            </button>
            {MONTHS.map((m, i) => (
              <button
                key={m}
                onClick={() => p.onMonth(month === i + 1 ? null : i + 1)}
                className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] ${month === i + 1 ? "bg-flame/80 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {m}
              </button>
            ))}
            <div className="ml-auto hidden items-center gap-2 pl-2 sm:flex">
              <span className="font-mono text-[9px] text-slate-500">low</span>
              <span className="h-1.5 w-20 rounded-full" style={{ background: `linear-gradient(90deg, ${heat(0.2)}, ${heat(0.5)}, ${heat(0.75)}, ${heat(1)})` }} />
              <span className="font-mono text-[9px] text-slate-500">high</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FitToBBox({ bbox }: { bbox: BBox }) {
  const map = useMap();
  const key = bbox.join(",");
  useEffect(() => {
    map.flyToBounds(toBounds(bbox), { padding: [40, 40], duration: 0.9, maxZoom: 9 });
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
    const top = [...cells].sort((a, b) => b.t - a.t).slice(0, 24).filter((c) => c.t > 0.35);
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
  return cur ? <Rectangle bounds={cur} pathOptions={{ color: "#14b8a6", weight: 2, dashArray: "4 4", fillOpacity: 0.08 }} /> : null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
