import { geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoProjection } from "d3-geo";
import { useEffect, useRef } from "react";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { heat } from "../lib/color";
import type { BBox } from "../lib/types";

export interface GlobeSpike {
  lon: number;
  lat: number;
  t: number; // 0-1 intensity
}

interface Props {
  spikes: GlobeSpike[];
  live: { lon: number; lat: number; recent: boolean }[];
  bbox: BBox;
  label: string;
}

type Geo = { land: GeoJSON.FeatureCollection | GeoJSON.Feature; borders: GeoJSON.MultiLineString };
let geoCache: Promise<Geo> | null = null;
function loadGeo() {
  geoCache ??= import("world-atlas/countries-50m.json").then((m) => {
    const topo = (m.default ?? m) as unknown as Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
    return {
      land: feature(topo, topo.objects.land),
      borders: mesh(topo, topo.objects.countries, (a, b) => a !== b),
    };
  });
  return geoCache;
}

/**
 * Orthographic "mission view" globe on canvas: real coastlines and borders,
 * fire intensity as glowing spikes, live detections as pulses. Drag to rotate,
 * wheel to zoom; idles with a slow spin and flies to the area of interest.
 */
export function Globe({ spikes, live, bbox, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({
    rot: [-20, -10] as [number, number],
    target: [-(bbox[0] + bbox[2]) / 2, -(bbox[1] + bbox[3]) / 2] as [number, number],
    zoom: 0.9,
    targetZoom: 2.6,
    dragging: false,
    lastInteract: 0,
    heights: new Map<string, number>(),
  });
  const data = useRef({ spikes, live, label, bbox });
  data.current = { spikes, live, label, bbox };

  useEffect(() => {
    state.current.target = [-(bbox[0] + bbox[2]) / 2, -(bbox[1] + bbox[3]) / 2];
    const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    state.current.targetZoom = Math.min(9, Math.max(2.2, 14 / span));
    state.current.lastInteract = 0;
  }, [bbox]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let geo: Geo | null = null;
    loadGeo().then((g) => (geo = g));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const projection: GeoProjection = geoOrthographic().clipAngle(90).precision(0.4);
    const path = geoPath(projection, ctx);
    const graticule = geoGraticule10();
    const stars = Array.from({ length: 140 }, () => [Math.random(), Math.random(), Math.random()]);

    // Drag + wheel
    let last: [number, number] | null = null;
    const down = (e: PointerEvent) => {
      last = [e.clientX, e.clientY];
      state.current.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      const s = state.current;
      const k = 0.25 / s.zoom;
      s.rot = [s.rot[0] + (e.clientX - last[0]) * k, Math.max(-80, Math.min(80, s.rot[1] - (e.clientY - last[1]) * k))];
      s.target = [...s.rot];
      s.lastInteract = performance.now();
      last = [e.clientX, e.clientY];
    };
    const up = () => {
      last = null;
      state.current.dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = state.current;
      s.targetZoom = Math.max(0.7, Math.min(10, s.targetZoom * Math.exp(-e.deltaY * 0.0015)));
      s.lastInteract = performance.now();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });

    const tick = (now: number) => {
      const s = state.current;
      const { spikes: sp, live: lv } = data.current;
      // Ease rotation/zoom toward the target; idle spin after 6 s without input.
      const idle = !s.dragging && s.lastInteract && now - s.lastInteract > 6000;
      if (idle && !reduced) s.target = [s.target[0] + 0.02, s.target[1]];
      if (!s.dragging) {
        const ease = reduced ? 1 : 0.045;
        let dLon = s.target[0] - s.rot[0];
        dLon = ((dLon + 540) % 360) - 180;
        s.rot = [s.rot[0] + dLon * ease, s.rot[1] + (s.target[1] - s.rot[1]) * ease];
      }
      s.zoom += (s.targetZoom - s.zoom) * (reduced ? 1 : 0.04);

      const R = (Math.min(w, h) / 2.25) * s.zoom;
      const cx = w / 2;
      const cy = h / 2 + 10;
      projection.scale(R).translate([cx, cy]).rotate([s.rot[0], s.rot[1], 0]);
      const center: [number, number] = [-s.rot[0], -s.rot[1]];

      // Space
      ctx.clearRect(0, 0, w, h);
      for (const [x, y, b] of stars) {
        ctx.fillStyle = `rgba(255,255,255,${0.15 + b * 0.5})`;
        ctx.fillRect(x * w, y * h, b > 0.85 ? 1.5 : 1, b > 0.85 ? 1.5 : 1);
      }
      // Atmosphere
      const atm = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.18);
      atm.addColorStop(0, "rgba(77,142,255,0.35)");
      atm.addColorStop(0.4, "rgba(77,142,255,0.12)");
      atm.addColorStop(1, "rgba(77,142,255,0)");
      ctx.fillStyle = atm;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2);
      ctx.fill();
      // Ocean
      const ocean = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
      ocean.addColorStop(0, "#10305e");
      ocean.addColorStop(1, "#04101f");
      ctx.fillStyle = ocean;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fill();
      // Graticule
      ctx.strokeStyle = "rgba(120,160,220,0.12)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      path(graticule);
      ctx.stroke();
      if (geo) {
        ctx.fillStyle = "#26364f";
        ctx.beginPath();
        path(geo.land);
        ctx.fill();
        ctx.strokeStyle = "rgba(190,215,250,0.55)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        path(geo.borders);
        ctx.stroke();
      }
      // Terminator-ish shading for depth
      const shade = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.2, cx, cy, R * 1.02);
      shade.addColorStop(0, "rgba(255,255,255,0.05)");
      shade.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = shade;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fill();

      // Spikes (grow toward their target height)
      const visible = (lon: number, lat: number) => geoDistance([lon, lat], center) < Math.PI / 2 - 0.02;
      ctx.globalCompositeOperation = "lighter";
      const sorted = [...sp].sort((a, b) => a.t - b.t);
      for (const p of sorted) {
        if (!visible(p.lon, p.lat)) continue;
        const key = `${p.lon},${p.lat}`;
        const cur = s.heights.get(key) ?? 0;
        const next = reduced ? p.t : cur + (p.t - cur) * 0.08;
        s.heights.set(key, next);
        const base = projection([p.lon, p.lat]);
        projection.scale(R * (1 + 0.012 + next * 0.16));
        const top = projection([p.lon, p.lat]);
        projection.scale(R);
        if (!base || !top) continue;
        const g = ctx.createLinearGradient(base[0], base[1], top[0], top[1]);
        g.addColorStop(0, heat(0.2 + 0.5 * p.t, 0.15));
        g.addColorStop(1, heat(0.4 + 0.6 * p.t, 0.95));
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.2 + 2.2 * p.t * Math.min(s.zoom / 3, 1.5);
        ctx.beginPath();
        ctx.moveTo(base[0], base[1]);
        ctx.lineTo(top[0], top[1]);
        ctx.stroke();
        const tip = ctx.createRadialGradient(top[0], top[1], 0, top[0], top[1], 3 + 6 * p.t);
        tip.addColorStop(0, heat(0.7 + 0.3 * p.t, 0.9));
        tip.addColorStop(1, "rgba(255,120,30,0)");
        ctx.fillStyle = tip;
        ctx.beginPath();
        ctx.arc(top[0], top[1], 3 + 6 * p.t, 0, Math.PI * 2);
        ctx.fill();
      }
      // Live pulses
      const pulse = (now / 1200) % 1;
      for (const l of lv) {
        if (!visible(l.lon, l.lat)) continue;
        const pt = projection([l.lon, l.lat]);
        if (!pt) continue;
        ctx.fillStyle = l.recent ? "rgba(255,240,180,0.95)" : "rgba(255,200,120,0.55)";
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], l.recent ? 2.2 : 1.5, 0, Math.PI * 2);
        ctx.fill();
        if (l.recent && !reduced) {
          ctx.strokeStyle = `rgba(252,61,33,${1 - pulse})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], 2 + pulse * 10, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";

      // AOI outline
      ctx.strokeStyle = "rgba(77,142,255,0.9)";
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const [x0, y0, x1, y1] = data.current.bbox;
      path({ type: "Polygon", coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] });
      ctx.stroke();
      ctx.setLineDash([]);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }, []);

  return (
    <div className="absolute inset-0 bg-[#03050a]">
      <canvas ref={canvasRef} className="h-full w-full cursor-grab touch-none active:cursor-grabbing" aria-label={`3D globe of ${label}`} role="img" />
      <div className="pointer-events-none absolute left-1/2 top-[104px] -translate-x-1/2 text-center">
        <div className="eyebrow !text-[9.5px]">Orbital view · drag to rotate · scroll to zoom</div>
      </div>
    </div>
  );
}
