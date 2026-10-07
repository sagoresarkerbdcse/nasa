import { useEffect, useRef } from "react";

export interface EmberSource {
  x: number;
  y: number;
  /** 0-1 intensity: hotter sources spawn more, brighter embers. */
  t: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  hue: number;
}

/** Lightweight canvas layer of rising thermal embers above the hottest map cells. */
export function EmberCanvas({ sources }: { sources: EmberSource[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const particles: Particle[] = [];
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const tick = (now: number) => {
      const dt = Math.min(50, now - last) / 16.67;
      last = now;
      const src = sourcesRef.current;
      // Spawn
      if (src.length && particles.length < 140) {
        for (let i = 0; i < 2; i++) {
          const s = src[Math.floor(Math.random() * src.length)];
          if (Math.random() > 0.25 + s.t * 0.75) continue;
          particles.push({
            x: s.x + (Math.random() - 0.5) * 14,
            y: s.y + (Math.random() - 0.5) * 6,
            vx: (Math.random() - 0.5) * 0.25,
            vy: -(0.35 + Math.random() * 0.6 * (0.5 + s.t)),
            life: 0,
            max: 60 + Math.random() * 70,
            r: 0.6 + Math.random() * 1.6 * (0.5 + s.t),
            hue: 18 + Math.random() * 30,
          });
        }
      }
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        p.x += (p.vx + Math.sin((p.life + p.hue) * 0.08) * 0.15) * dt;
        p.y += p.vy * dt;
        const f = 1 - p.life / p.max;
        if (f <= 0) {
          particles.splice(i, 1);
          continue;
        }
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `hsla(${p.hue + 20}, 100%, 70%, ${0.75 * f})`);
        g.addColorStop(0.4, `hsla(${p.hue}, 100%, 55%, ${0.35 * f})`);
        g.addColorStop(1, "hsla(10, 100%, 50%, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-[450] h-full w-full" aria-hidden />;
}
