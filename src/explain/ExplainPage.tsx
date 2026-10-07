import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridFile } from "../lib/types";
import { Flame, Satellite, Stage, Stars, Tiger } from "./art";
import { computeFacts, type Facts } from "./facts";
import { QUIZ, STORIES, type Audience } from "./stories";

interface Theme {
  label: string;
  ages: string;
  tagline: string;
  page: string;
  card: string;
  text: string;
  sub: string;
  accent: string;
  font: string;
  caption: string;
  autoplay: boolean;
  rate: number;
  pitch: number;
}

const THEMES: Record<Audience, Theme> = {
  kids: {
    label: "Little Explorers",
    ages: "Ages 3–5",
    tagline: "A cartoon story about Sunny the satellite",
    page: "bg-[#fff4df]",
    card: "bg-white border-[#ffcf8f]",
    text: "text-[#3b2a1a]",
    sub: "text-[#8a5a2a]",
    accent: "#ff7a1a",
    font: "'Fredoka', 'Inter', sans-serif",
    caption: "text-[24px] sm:text-[30px] leading-snug font-semibold",
    autoplay: true,
    rate: 0.9,
    pitch: 1.25,
  },
  teens: {
    label: "Students",
    ages: "Ages 15–20",
    tagline: "Orbits, pixels, a fake trend and the hack that fixes it",
    page: "bg-[#070915]",
    card: "bg-[#0d1130] border-[#2b2f66]",
    text: "text-white",
    sub: "text-[#a5adcf]",
    accent: "#ff3d7f",
    font: "'Inter', sans-serif",
    caption: "text-[18px] sm:text-[21px] leading-relaxed font-medium",
    autoplay: true,
    rate: 1.05,
    pitch: 1,
  },
  seniors: {
    label: "Senior Citizens",
    ages: "Clear and calm",
    tagline: "Large text, gentle pace, everyday examples",
    page: "bg-[#fbf6ec]",
    card: "bg-white border-[#e7dcc6]",
    text: "text-[#1f2937]",
    sub: "text-[#57534e]",
    accent: "#b45309",
    font: "'Inter', sans-serif",
    caption: "text-[22px] sm:text-[27px] leading-relaxed font-medium",
    autoplay: false,
    rate: 0.85,
    pitch: 1,
  },
  why: {
    label: "Why It Matters",
    ages: "For everyone",
    tagline: "What fires do to people and places, and why consistent data is the key",
    page: "bg-[#05070a]",
    card: "bg-[#0c1016] border-white/10",
    text: "text-white",
    sub: "text-slate-400",
    accent: "#4d8eff",
    font: "'Inter', sans-serif",
    caption: "text-[18px] sm:text-[21px] leading-relaxed font-medium",
    autoplay: true,
    rate: 1,
    pitch: 1,
  },
};

export default function ExplainPage() {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [aud, setAud] = useState<Audience | null>(() => {
    const h = window.location.hash.slice(1);
    return h in THEMES ? (h as Audience) : null;
  });
  useEffect(() => {
    fetch("/data/grid.json")
      .then((r) => r.json())
      .then((g: GridFile) => setFacts(computeFacts(g)))
      .catch(() => setFacts(null));
  }, []);
  useEffect(() => {
    window.history.replaceState(null, "", aud ? `#${aud}` : window.location.pathname);
    window.speechSynthesis?.cancel();
  }, [aud]);

  if (!facts) return <div className="grid h-full place-items-center bg-[#05070a] text-sm text-slate-400">Loading real NASA data for the stories…</div>;
  if (!aud) return <Picker onPick={setAud} facts={facts} />;
  return <Player key={aud} aud={aud} facts={facts} onBack={() => setAud(null)} />;
}

function Picker({ onPick, facts }: { onPick: (a: Audience) => void; facts: Facts }) {
  const cards: { id: Audience; art: React.ReactNode }[] = [
    {
      id: "kids",
      art: (
        <Stage bg="#24307a" label="">
          <Stars n={25} />
          <Satellite x={400} y={210} scale={1.6} face />
        </Stage>
      ),
    },
    {
      id: "teens",
      art: (
        <Stage bg="#0a0d1f" label="">
          {Array.from({ length: 16 }, (_, i) => (
            <rect key={i} x={250 + (i % 4) * 75} y={70 + Math.floor(i / 4) * 75} width={70} height={70} fill={[5, 6, 9, 10].includes(i) ? "#ff3d7f" : "none"} fillOpacity={0.4} stroke="#ff3d7f" strokeWidth={2} />
          ))}
          <circle cx={400} cy={220} r={60} fill="#ff5a1f" opacity={0.8} />
        </Stage>
      ),
    },
    {
      id: "seniors",
      art: (
        <Stage bg="#fbf6ec" label="">
          <circle cx={330} cy={220} r={70} fill="#fff" stroke="#1f2937" strokeWidth={12} />
          <circle cx={470} cy={220} r={70} fill="#fff" stroke="#1f2937" strokeWidth={12} />
          <path d="M 392 214 q 8 -14 16 0" stroke="#1f2937" strokeWidth={12} fill="none" />
          <Flame x={470} y={250} s={1.3} />
        </Stage>
      ),
    },
    {
      id: "why",
      art: (
        <Stage bg="#070b14" label="">
          <Flame x={400} y={280} s={2.4} />
          <Tiger x={600} y={300} s={1.2} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <circle key={i} cx={400 + Math.cos(i) * 220} cy={220 + Math.sin(i) * 150} r={12} fill={["#94a3b8", "#f87171", "#22c55e", "#f59e0b", "#38bdf8", "#a78bfa"][i]} />
          ))}
        </Stage>
      ),
    },
  ];
  return (
    <div className="space-bg min-h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <a href="/" className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-slate-400 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </a>
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          FireCal, <span className="text-heat">explained for everyone</span>
        </motion.h1>
        <p className="mt-3 max-w-3xl text-[17px] leading-relaxed text-slate-300">
          Same science, four ways to tell it. Every number in these stories comes from {facts.years} years of real NASA satellite fire data ({facts.firstYear}–{facts.lastYear}, {facts.detections.toLocaleString()} detections).
        </p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {cards.map((c, i) => {
            const t = THEMES[c.id];
            return (
              <motion.button
                key={c.id}
                onClick={() => onPick(c.id)}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.1 }}
                whileHover={{ y: -4 }}
                className={`group overflow-hidden rounded-2xl border-2 text-left shadow-xl ${t.card}`}
                style={{ fontFamily: t.font }}
              >
                <div className="aspect-[16/8] overflow-hidden">{c.art}</div>
                <div className="p-5">
                  <div className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: t.accent }}>
                    {t.ages}
                  </div>
                  <div className={`mt-1 text-2xl font-bold ${t.text}`}>{t.label}</div>
                  <div className={`mt-1 text-[15px] ${t.sub}`}>{t.tagline}</div>
                  <div className="mt-3 inline-flex items-center gap-2 text-[14px] font-semibold" style={{ color: t.accent }}>
                    Start the story <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
        <p className="mt-8 text-center font-mono text-[10.5px] uppercase tracking-wider text-slate-500">Independent NASA Space Apps Challenge 2026 project · not affiliated with or endorsed by NASA</p>
      </div>
    </div>
  );
}

function Player({ aud, facts, onBack }: { aud: Audience; facts: Facts; onBack: () => void }) {
  const t = THEMES[aud];
  const scenes = STORIES[aud].scenes;
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(t.autoplay);
  const [voice, setVoice] = useState(false);
  const scene = scenes[i];
  const text = scene.text(facts);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const speaking = useRef(false);

  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(scenes.length - 1, x + d))), [scenes.length]);
  const ms = useMemo(() => Math.max(7000, text.split(/\s+/).length * (aud === "kids" ? 520 : aud === "seniors" ? 560 : 400)), [text, aud]);

  // Narration
  useEffect(() => {
    if (!voice || !canSpeak) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${scene.title}. ${text}`);
    u.rate = t.rate;
    u.pitch = t.pitch;
    u.lang = "en-US";
    speaking.current = true;
    u.onend = () => {
      speaking.current = false;
      if (auto && !scene.quiz) setTimeout(() => go(1), 900);
    };
    window.speechSynthesis.speak(u);
    return () => window.speechSynthesis.cancel();
  }, [voice, i]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timed autoplay when not narrating
  useEffect(() => {
    if (!auto || voice || scene.quiz || i === scenes.length - 1) return;
    const id = setTimeout(() => go(1), ms);
    return () => clearTimeout(id);
  }, [auto, voice, i, ms, go, scene.quiz, scenes.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setAuto((a) => !a);
      } else if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onBack]);

  const dark = aud === "teens" || aud === "why";
  const btn = dark ? "border-white/15 text-white hover:bg-white/10" : "border-black/15 text-[#1f2937] hover:bg-black/5";
  const big = aud === "seniors" ? "h-14 min-w-14 px-4 text-lg" : "h-11 min-w-11 px-3";

  return (
    <div className={`flex min-h-full flex-col ${t.page}`} style={{ fontFamily: t.font }}>
      <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <button onClick={onBack} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[14px] font-semibold ${btn}`}>
          <ArrowLeft className="h-4 w-4" /> All stories
        </button>
        <div className={`ml-1 truncate text-[15px] font-bold ${t.text}`}>
          {t.label} <span className={`font-medium ${t.sub}`}>· {t.ages}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canSpeak && (
            <button onClick={() => setVoice((v) => !v)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[14px] font-semibold ${btn}`} aria-pressed={voice}>
              {voice ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              {aud === "kids" ? "Read to me" : "Narrate"}
            </button>
          )}
          <a href="/" className={`hidden rounded-full border px-3 py-1.5 text-[14px] font-semibold sm:inline-flex ${btn}`}>
            Open dashboard
          </a>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-6 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl shadow-2xl" style={{ aspectRatio: "16 / 9" }}>
          <AnimatePresence mode="wait">
            <motion.div key={i} className="absolute inset-0" initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.5 }}>
              {scene.art(facts)}
            </motion.div>
          </AnimatePresence>
          <div className="absolute left-3 top-3 rounded-full bg-black/45 px-3 py-1 text-[13px] font-semibold text-white backdrop-blur">
            {i + 1} / {scenes.length}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.section key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="mt-5" aria-live="polite">
            <h2 className="text-[15px] font-bold uppercase tracking-widest" style={{ color: t.accent }}>
              {scene.title}
            </h2>
            {scene.quiz ? <Quiz facts={facts} dark={dark} accent={t.accent} /> : <p className={`mt-2 ${t.caption} ${t.text}`}>{text}</p>}
          </motion.section>
        </AnimatePresence>

        <nav className="mt-auto flex items-center gap-3 pt-6" aria-label="Story controls">
          <button onClick={() => go(-1)} disabled={i === 0} className={`grid place-items-center rounded-full border font-semibold disabled:opacity-30 ${btn} ${big}`} aria-label="Previous">
            <ChevronLeft className="h-5 w-5" />
            {aud === "seniors" && <span className="sr-only">Back</span>}
          </button>
          <button onClick={() => setAuto((a) => !a)} className={`grid place-items-center rounded-full text-white ${big}`} style={{ background: t.accent }} aria-label={auto ? "Pause" : "Play"}>
            {auto ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button onClick={() => go(1)} disabled={i === scenes.length - 1} className={`flex items-center justify-center gap-2 rounded-full border font-semibold disabled:opacity-30 ${btn} ${big}`} aria-label="Next">
            {aud === "seniors" && <span>Next</span>}
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="flex flex-1 gap-1.5">
            {scenes.map((_, k) => (
              <button key={k} onClick={() => setI(k)} className={`h-2 flex-1 rounded-full ${dark ? "bg-white/15" : "bg-black/10"}`} aria-label={`Scene ${k + 1}`}>
                <span className="block h-full rounded-full transition-all" style={{ width: k <= i ? "100%" : "0%", background: t.accent }} />
              </button>
            ))}
          </div>
        </nav>
        {i === scenes.length - 1 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-4 flex flex-wrap gap-3">
            <button onClick={onBack} className={`rounded-full border px-4 py-2 font-semibold ${btn}`}>
              Choose another story
            </button>
            <a href="/" className="rounded-full px-4 py-2 font-semibold text-white" style={{ background: t.accent }}>
              Explore the real data →
            </a>
          </motion.div>
        )}
      </main>
    </div>
  );
}

function Quiz({ facts, dark, accent }: { facts: Facts; dark: boolean; accent: string }) {
  const qs = QUIZ(facts);
  const [picked, setPicked] = useState<(number | null)[]>(qs.map(() => null));
  const score = picked.filter((p, i) => p === qs[i].answer).length;
  const done = picked.every((p) => p !== null);
  return (
    <div className="mt-3 space-y-4">
      {qs.map((q, qi) => (
        <div key={qi}>
          <div className={`text-[17px] font-semibold ${dark ? "text-white" : "text-[#1f2937]"}`}>
            {qi + 1}. {q.q}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {q.options.map((o, oi) => {
              const chosen = picked[qi] === oi;
              const right = picked[qi] !== null && oi === q.answer;
              return (
                <motion.button
                  key={oi}
                  whileTap={{ scale: 0.96 }}
                  disabled={picked[qi] !== null}
                  onClick={() => setPicked((p) => p.map((x, k) => (k === qi ? oi : x)))}
                  className={`rounded-xl border-2 px-3 py-2 text-[15px] font-medium transition-colors ${
                    right ? "border-emerald-400 bg-emerald-400/20 text-emerald-200" : chosen ? "border-rose-400 bg-rose-400/20 text-rose-200" : dark ? "border-white/15 text-slate-200 hover:border-white/40" : "border-black/15"
                  }`}
                >
                  {right ? "✓ " : chosen ? "✗ " : ""}
                  {o}
                </motion.button>
              );
            })}
          </div>
          {picked[qi] !== null && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-1.5 text-[14px] text-slate-400">
              {q.why}
            </motion.div>
          )}
        </div>
      ))}
      {done && (
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-2xl font-extrabold" style={{ color: accent }}>
          {score === qs.length ? "🏆 Perfect! You think like a NASA data scientist." : `You got ${score}/${qs.length}. Try another story!`}
        </motion.div>
      )}
    </div>
  );
}
