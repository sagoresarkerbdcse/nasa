/**
 * Cartoon / infographic illustration kit for the Explain stories.
 * Plain SVG + framer-motion so everything is crisp, small and animatable.
 */
import { motion } from "framer-motion";
import type { ReactNode } from "react";

export const W = 800;
export const H = 450;

export function Stage({ children, bg, label }: { children: ReactNode; bg: string; label: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={label} preserveAspectRatio="xMidYMid slice">
      <rect width={W} height={H} fill={bg} />
      {children}
    </svg>
  );
}

export function Stars({ n = 40, seed = 1, color = "#fff" }: { n?: number; seed?: number; color?: string }) {
  const pts = Array.from({ length: n }, (_, i) => {
    const r = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    const r2 = Math.sin(i * 269.5 + seed * 183.3) * 43758.5453;
    return [(r - Math.floor(r)) * W, (r2 - Math.floor(r2)) * H * 0.7, (i % 3) + 1];
  });
  return (
    <g>
      {pts.map(([x, y, s], i) => (
        <motion.circle key={i} cx={x} cy={y} r={s * 0.7} fill={color} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 2 + (i % 5), delay: i * 0.13 }} />
      ))}
    </g>
  );
}

export function Planet({ cy = 640, r = 420, ocean = "#2f7dd1", land = "#58b86a", spin = true }: { cy?: number; r?: number; ocean?: string; land?: string; spin?: boolean }) {
  return (
    <g>
      <circle cx={W / 2} cy={cy} r={r + 18} fill="#7fc3ff" opacity={0.25} />
      <circle cx={W / 2} cy={cy} r={r} fill={ocean} />
      <motion.g style={{ originX: `${W / 2}px`, originY: `${cy}px` }} animate={spin ? { rotate: [0, -8, 0] } : undefined} transition={{ repeat: Infinity, duration: 18, ease: "easeInOut" }}>
        <path d={`M ${W / 2 - 250} ${cy - 330} q 60 -40 140 -10 q 50 20 90 -5 q 40 -25 70 20 q 20 40 -30 60 q -60 25 -120 5 q -70 -20 -150 -70 z`} fill={land} />
        <path d={`M ${W / 2 + 60} ${cy - 390} q 70 -20 130 15 q 40 30 10 55 q -50 30 -100 0 q -40 -25 -40 -70 z`} fill={land} />
      </motion.g>
    </g>
  );
}

/** A friendly satellite. `face` adds eyes and a smile for the kids' story. */
export function Satellite({ x, y, scale = 1, face = false, color = "#e8edf5", panel = "#2d5fd6", eyeColor = "#1d2433", label }: { x: number; y: number; scale?: number; face?: boolean; color?: string; panel?: string; eyeColor?: string; label?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x={-118} y={-16} width={70} height={32} rx={4} fill={panel} stroke="#0d1b3d" strokeWidth={3} />
      <rect x={48} y={-16} width={70} height={32} rx={4} fill={panel} stroke="#0d1b3d" strokeWidth={3} />
      {[-101, -84, -67, 65, 82, 99].map((px) => (
        <line key={px} x1={px} y1={-16} x2={px} y2={16} stroke="#0d1b3d" strokeWidth={2} opacity={0.6} />
      ))}
      <rect x={-48} y={-4} width={96} height={8} fill="#9aa7bd" />
      <rect x={-34} y={-34} width={68} height={68} rx={face ? 18 : 6} fill={color} stroke="#0d1b3d" strokeWidth={3} />
      <rect x={-12} y={34} width={24} height={14} rx={3} fill="#9aa7bd" stroke="#0d1b3d" strokeWidth={3} />
      {face ? (
        <g>
          <motion.g animate={{ scaleY: [1, 0.1, 1] }} transition={{ repeat: Infinity, duration: 3.5, times: [0, 0.05, 0.1] }} style={{ originY: "-8px" }}>
            <circle cx={-12} cy={-8} r={6} fill={eyeColor} />
            <circle cx={12} cy={-8} r={6} fill={eyeColor} />
            <circle cx={-10} cy={-10} r={2} fill="#fff" />
            <circle cx={14} cy={-10} r={2} fill="#fff" />
          </motion.g>
          <path d="M -12 10 q 12 12 24 0" stroke={eyeColor} strokeWidth={3.5} fill="none" strokeLinecap="round" />
          <circle cx={-22} cy={6} r={4} fill="#ff9aa8" opacity={0.7} />
          <circle cx={22} cy={6} r={4} fill="#ff9aa8" opacity={0.7} />
        </g>
      ) : (
        <circle cx={0} cy={0} r={10} fill="#0d1b3d" />
      )}
      <line x1={0} y1={-34} x2={0} y2={-54} stroke="#0d1b3d" strokeWidth={3} />
      <motion.circle cx={0} cy={-58} r={5} fill="#ff5a3f" animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} />
      {label && (
        <text x={0} y={78} textAnchor="middle" fontSize={20} fontWeight={700} fill="#fff" stroke="#0d1b3d" strokeWidth={5} paintOrder="stroke">
          {label}
        </text>
      )}
    </g>
  );
}

export function Flame({ x, y, s = 1, delay = 0 }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <motion.g style={{ originX: "0px", originY: "0px" }} animate={{ scaleY: [1, 1.15, 0.95, 1.1, 1], scaleX: [1, 0.95, 1.05, 0.97, 1] }} transition={{ repeat: Infinity, duration: 0.9, delay }}>
        <path d="M 0 0 C -22 0 -26 -28 -12 -46 C -10 -32 -2 -30 0 -40 C 4 -52 -2 -62 6 -72 C 12 -54 26 -44 22 -22 C 20 -8 12 0 0 0 Z" fill="#ff5a1f" />
        <path d="M 0 0 C -12 0 -14 -16 -6 -26 C -4 -18 2 -18 2 -26 C 8 -20 14 -14 12 -6 C 10 -1 6 0 0 0 Z" fill="#ffd23f" />
      </motion.g>
    </g>
  );
}

export function Smoke({ x, y, delay = 0, color = "#9aa3b0" }: { x: number; y: number; delay?: number; color?: string }) {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={x}
          cy={y}
          r={10}
          fill={color}
          initial={{ opacity: 0 }}
          animate={{ cy: [y, y - 120], cx: [x, x + 30 + i * 8], r: [8, 28], opacity: [0.7, 0] }}
          transition={{ repeat: Infinity, duration: 3.2, delay: delay + i * 1.05, ease: "easeOut" }}
        />
      ))}
    </g>
  );
}

export function Hills({ y = 300, colors = ["#3d9a52", "#2f7d43", "#246636"] }: { y?: number; colors?: string[] }) {
  return (
    <g>
      <path d={`M 0 ${y} Q 150 ${y - 110} 300 ${y - 10} T 600 ${y - 30} T 800 ${y - 60} L 800 ${H} L 0 ${H} Z`} fill={colors[0]} />
      <path d={`M 0 ${y + 50} Q 200 ${y - 40} 400 ${y + 40} T 800 ${y + 20} L 800 ${H} L 0 ${H} Z`} fill={colors[1]} />
      <path d={`M 0 ${y + 100} Q 250 ${y + 50} 500 ${y + 95} T 800 ${y + 90} L 800 ${H} L 0 ${H} Z`} fill={colors[2]} />
    </g>
  );
}

export function Tree({ x, y, s = 1, burnt = false }: { x: number; y: number; s?: number; burnt?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-5} y={-10} width={10} height={30} fill={burnt ? "#3a2a22" : "#7a4e2d"} />
      <circle cx={0} cy={-28} r={24} fill={burnt ? "#4a4a44" : "#2f9e57"} />
      <circle cx={-14} cy={-14} r={16} fill={burnt ? "#3d3d38" : "#38b263"} />
      <circle cx={14} cy={-14} r={16} fill={burnt ? "#3d3d38" : "#2b8f4f"} />
    </g>
  );
}

export function Sun({ x, y, r = 40, face = false }: { x: number; y: number; r?: number; face?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <motion.g animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 30, ease: "linear" }}>
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={-4} y={-r - 22} width={8} height={16} rx={4} fill="#ffc531" transform={`rotate(${i * 30})`} />
        ))}
      </motion.g>
      <circle r={r} fill="#ffd84d" />
      {face && (
        <g>
          <circle cx={-12} cy={-6} r={4.5} fill="#5a3b00" />
          <circle cx={12} cy={-6} r={4.5} fill="#5a3b00" />
          <path d="M -12 10 q 12 10 24 0" stroke="#5a3b00" strokeWidth={3.5} fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}

/** Firefighter / ranger character. */
export function Helper({ x, y, s = 1, wave = true, color = "#ff6a2b" }: { x: number; y: number; s?: number; wave?: boolean; color?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-18} y={-10} width={36} height={50} rx={10} fill={color} stroke="#3a1a10" strokeWidth={3} />
      <rect x={-18} y={10} width={36} height={6} fill="#ffe14d" />
      <rect x={-14} y={40} width={11} height={26} rx={4} fill="#2d3a55" />
      <rect x={3} y={40} width={11} height={26} rx={4} fill="#2d3a55" />
      <circle cx={0} cy={-30} r={20} fill="#c98b5e" stroke="#3a1a10" strokeWidth={3} />
      <path d="M -24 -34 q 24 -30 48 0 z" fill="#ffd23f" stroke="#3a1a10" strokeWidth={3} />
      <circle cx={-7} cy={-30} r={3} fill="#1d1d1d" />
      <circle cx={7} cy={-30} r={3} fill="#1d1d1d" />
      <path d="M -7 -20 q 7 6 14 0" stroke="#1d1d1d" strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <motion.g style={{ originX: "18px", originY: "0px" }} animate={wave ? { rotate: [0, -30, 0, -30, 0] } : undefined} transition={{ repeat: Infinity, duration: 2, repeatDelay: 1 }}>
        <rect x={16} y={-6} width={10} height={34} rx={5} fill={color} stroke="#3a1a10" strokeWidth={3} transform="rotate(-140 18 0)" />
      </motion.g>
      <rect x={-26} y={-4} width={10} height={32} rx={5} fill={color} stroke="#3a1a10" strokeWidth={3} />
    </g>
  );
}

/** A friendly Bengal tiger head (for the Sundarbans). */
export function Tiger({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <motion.g transform={`translate(${x} ${y}) scale(${s})`} animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
      <circle cx={-26} cy={-30} r={12} fill="#f08a24" stroke="#3a1a10" strokeWidth={3} />
      <circle cx={26} cy={-30} r={12} fill="#f08a24" stroke="#3a1a10" strokeWidth={3} />
      <ellipse cx={0} cy={0} rx={40} ry={36} fill="#f59a2c" stroke="#3a1a10" strokeWidth={3} />
      <path d="M -8 -36 l 4 12 M 8 -36 l -4 12 M -38 -6 l 12 2 M 38 -6 l -12 2 M -36 10 l 12 -2 M 36 10 l -12 -2" stroke="#3a1a10" strokeWidth={4} strokeLinecap="round" />
      <ellipse cx={0} cy={14} rx={18} ry={12} fill="#fff4e0" />
      <circle cx={-14} cy={-6} r={4.5} fill="#1d1d1d" />
      <circle cx={14} cy={-6} r={4.5} fill="#1d1d1d" />
      <path d="M -5 8 h 10 l -5 6 z" fill="#3a1a10" />
      <path d="M 0 14 q -6 8 -12 4 M 0 14 q 6 8 12 4" stroke="#3a1a10" strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </motion.g>
  );
}

export function House({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-34} y={-30} width={68} height={50} fill="#f4e3c3" stroke="#3a2a1a" strokeWidth={3} />
      <path d="M -44 -28 L 0 -66 L 44 -28 Z" fill="#c4512d" stroke="#3a2a1a" strokeWidth={3} />
      <rect x={-10} y={-4} width={20} height={24} fill="#7a4e2d" />
      <rect x={-28} y={-20} width={14} height={12} fill="#9fd3ff" stroke="#3a2a1a" strokeWidth={2} />
      <rect x={14} y={-20} width={14} height={12} fill="#9fd3ff" stroke="#3a2a1a" strokeWidth={2} />
    </g>
  );
}

/** Speech bubble with rounded tail. */
export function Bubble({ x, y, w, h, children, fill = "#fff", stroke = "#1d2433", tail = "left" }: { x: number; y: number; w: number; h: number; children: ReactNode; fill?: string; stroke?: string; tail?: "left" | "right" | "none" }) {
  return (
    <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.4 }} style={{ originX: `${x}px`, originY: `${y + h}px` }}>
      <rect x={x} y={y} width={w} height={h} rx={18} fill={fill} stroke={stroke} strokeWidth={3} />
      {tail !== "none" && <path d={tail === "left" ? `M ${x + 30} ${y + h - 2} l -14 22 l 34 -22` : `M ${x + w - 30} ${y + h - 2} l 14 22 l -34 -22`} fill={fill} stroke={stroke} strokeWidth={3} strokeLinejoin="round" />}
      {tail !== "none" && <rect x={tail === "left" ? x + 18 : x + w - 52} y={y + h - 5} width={34} height={6} fill={fill} />}
      {children}
    </motion.g>
  );
}

/** Animated line chart path that draws itself. */
export function DrawPath({ d, stroke, width = 4, delay = 0, dash }: { d: string; stroke: string; width?: number; delay?: number; dash?: string }) {
  return <motion.path d={d} stroke={stroke} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.8, delay, ease: "easeInOut" }} />;
}

/** Build an SVG path from values within a box. */
export function seriesPath(values: number[], x0: number, y0: number, w: number, h: number, max?: number) {
  const m = max ?? Math.max(...values, 1);
  return values.map((v, i) => `${i ? "L" : "M"} ${x0 + (i / Math.max(values.length - 1, 1)) * w} ${y0 + h - (v / m) * h}`).join(" ");
}

export function Pop({ children, delay = 0, x = 0, y = 0 }: { children: ReactNode; delay?: number; x?: number; y?: number }) {
  return (
    <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 16, delay }} style={{ originX: `${x}px`, originY: `${y}px` }}>
      {children}
    </motion.g>
  );
}

export function FadeUp({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.g initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay }}>
      {children}
    </motion.g>
  );
}
