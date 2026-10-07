/* Scene scripts for the four Explain stories. Numbers come from Facts (real data). */
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Bubble, DrawPath, FadeUp, Flame, H, Helper, Hills, House, Planet, Pop, Satellite, Smoke, Stage, Stars, Sun, Tiger, Tree, W, seriesPath } from "./art";
import type { Facts } from "./facts";

export interface Scene {
  title: string;
  text: (f: Facts) => string;
  art: (f: Facts) => ReactNode;
  quiz?: boolean;
}

export type Audience = "kids" | "teens" | "seniors" | "why";

const txt = (x: number, y: number, s: string, size = 22, fill = "#fff", weight = 700, anchor: "start" | "middle" | "end" = "middle") => (
  <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={fill}>
    {s}
  </text>
);

// ===========================================================================
// Little explorers (3-5)
// ===========================================================================
export const KIDS: Scene[] = [
  {
    title: "Meet Sunny!",
    text: () => "This is Sunny the satellite. Sunny flies all the way around the Earth, every single day!",
    art: () => (
      <Stage bg="#24307a" label="A smiling satellite flying above the Earth">
        <Stars n={45} />
        <Planet cy={700} r={460} />
        <motion.g animate={{ x: [-260, 260, -260], y: [0, -30, 0] }} transition={{ repeat: Infinity, duration: 9, ease: "easeInOut" }}>
          <Satellite x={W / 2} y={170} scale={1.15} face />
        </motion.g>
      </Stage>
    ),
  },
  {
    title: "Sunny's warm eyes",
    text: () => "Sunny has special eyes that can feel heat. When something is burning, Sunny sees it glow!",
    art: () => (
      <Stage bg="#8fd3ff" label="A satellite seeing glowing fires on green hills">
        <Sun x={690} y={80} face />
        <Hills y={290} />
        <Tree x={120} y={330} />
        <Tree x={600} y={320} s={1.1} />
        <motion.polygon points={`${W / 2 - 30},140 ${W / 2 + 30},140 ${W / 2 + 150},330 ${W / 2 - 150},330`} fill="#fff3a0" animate={{ opacity: [0.15, 0.45, 0.15] }} transition={{ repeat: Infinity, duration: 1.6 }} />
        <Satellite x={W / 2} y={95} scale={0.85} face />
        <Flame x={330} y={330} s={1.2} />
        <Flame x={430} y={318} s={1.5} delay={0.3} />
        <Smoke x={430} y={270} />
        {[300, 470].map((x, i) => (
          <motion.text key={x} x={x} y={250} fontSize={34} fill="#ff7a1a" fontWeight={800} animate={{ y: [250, 236, 250], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.4 }}>
            ✦
          </motion.text>
        ))}
      </Stage>
    ),
  },
  {
    title: "Two friends count",
    text: () => "Sunny has two friends, Moe and Vee. Vee has sharper eyes, so Vee counts more little sparkles from the same fire!",
    art: () => (
      <Stage bg="#9ad8ff" label="Two satellite friends counting the same fire differently">
        <Hills y={330} colors={["#62c46f", "#4aa95a", "#3a8f4a"]} />
        <motion.g animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 3 }}>
          <Satellite x={200} y={120} scale={0.8} face panel="#2d5fd6" label="Moe" />
        </motion.g>
        <motion.g animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 3, delay: 0.6 }}>
          <Satellite x={600} y={120} scale={0.8} face panel="#1f9e6a" label="Vee" />
        </motion.g>
        <Flame x={400} y={380} s={1.7} />
        <Bubble x={95} y={210} w={190} h={64} tail="none">
          {txt(190, 252, "I see 1 fire!", 24, "#1d2433")}
        </Bubble>
        <Bubble x={500} y={210} w={210} h={64} tail="none">
          {txt(605, 252, "I see 3 sparkles!", 24, "#1d2433")}
        </Bubble>
        {[370, 400, 430].map((x, i) => (
          <Pop key={x} delay={1.2 + i * 0.3} x={x} y={300}>
            <circle cx={x} cy={300} r={9} fill="#ffe14d" stroke="#ff7a1a" strokeWidth={3} />
          </Pop>
        ))}
      </Stage>
    ),
  },
  {
    title: "Fair counting with boxes",
    text: () => "So we put every fire into a box and count the boxes. Now Moe and Vee count the same. Fair and square!",
    art: () => (
      <Stage bg="#fff3d6" label="Sparkles flying into one box so both friends agree">
        {Array.from({ length: 9 }, (_, i) => {
          const x = 280 + (i % 3) * 82;
          const y = 120 + Math.floor(i / 3) * 82;
          return <rect key={i} x={x} y={y} width={76} height={76} rx={12} fill={i === 4 ? "#ffd7b0" : "#fff"} stroke="#e0b98a" strokeWidth={4} />;
        })}
        {[0, 1, 2].map((i) => (
          <motion.circle key={i} r={10} fill="#ffe14d" stroke="#ff7a1a" strokeWidth={3} initial={{ cx: 120 + i * 60, cy: 90 }} animate={{ cx: 400 + (i - 1) * 16, cy: 240 }} transition={{ duration: 1.4, delay: 0.5 + i * 0.25, type: "spring" }} />
        ))}
        <Pop delay={2} x={400} y={240}>
          <Flame x={400} y={262} s={0.9} />
        </Pop>
        <Satellite x={110} y={330} scale={0.6} face panel="#2d5fd6" label="Moe" />
        <Satellite x={690} y={330} scale={0.6} face panel="#1f9e6a" label="Vee" />
        <Pop delay={2.4} x={110} y={240}>
          <Bubble x={60} y={210} w={100} h={56} tail="none">
            {txt(110, 248, "1!", 28, "#1d2433")}
          </Bubble>
        </Pop>
        <Pop delay={2.6} x={690} y={240}>
          <Bubble x={640} y={210} w={100} h={56} tail="none">
            {txt(690, 248, "1!", 28, "#1d2433")}
          </Bubble>
        </Pop>
        <Pop delay={3} x={400} y={410}>
          {txt(400, 420, "✔ Same count!", 30, "#1f9e6a", 800)}
        </Pop>
      </Stage>
    ),
  },
  {
    title: "The fire calendar",
    text: (f) => `Fires happen most in ${f.peakMonths[0]} and ${f.peakMonths[1]}, when the hills are hot and dry.`,
    art: (f) => {
      const labels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
      const big = new Set(f.peakMonths.map((m) => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(m)));
      return (
        <Stage bg="#ffe9c7" label="A calendar where two spring months have big flames">
          <Sun x={720} y={70} r={34} face />
          {labels.map((l, i) => {
            const x = 80 + i * 58;
            const hot = big.has(i);
            return (
              <g key={i}>
                <motion.circle cx={x} cy={240} r={hot ? 26 : 20} fill={hot ? "#ff7a1a" : "#fff"} stroke="#d68a3a" strokeWidth={4} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.08, type: "spring" }} style={{ originX: `${x}px`, originY: "240px" }} />
                {txt(x, 249, l, 24, hot ? "#fff" : "#a05a1a", 800)}
                {hot && <Flame x={x} y={205} s={1.1} delay={i * 0.1} />}
              </g>
            );
          })}
          {txt(400, 360, `${f.peakMonths[0]} & ${f.peakMonths[1]}`, 40, "#d0451b", 800)}
        </Stage>
      );
    },
  },
  {
    title: "Helpers get ready",
    text: () => "Now the helpers know when and where to get ready. The forest, the tigers and the families stay safe!",
    art: () => (
      <Stage bg="#a9e4ff" label="A firefighter waving next to a tiger, a house and green trees">
        <Sun x={100} y={80} face />
        <Hills y={300} colors={["#6fd07b", "#55b865", "#45a055"]} />
        <Tree x={620} y={330} s={1.2} />
        <Tree x={700} y={345} />
        <House x={530} y={360} s={1.1} />
        <Helper x={260} y={330} s={1.4} />
        <Tiger x={400} y={360} s={1.1} />
        <Satellite x={640} y={90} scale={0.55} face />
        {[0, 1, 2].map((i) => (
          <motion.text key={i} x={330 + i * 70} y={200} fontSize={36} fill="#ff5c8a" animate={{ y: [210, 150], opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 2.4, delay: i * 0.8 }}>
            ♥
          </motion.text>
        ))}
      </Stage>
    ),
  },
];

// ===========================================================================
// Students (15-20)
// ===========================================================================
const NEON = "#0a0d1f";
export const TEENS: Scene[] = [
  {
    title: "Space has a fire alarm",
    text: () =>
      "Polar-orbiting satellites like Terra, Aqua and Suomi NPP pass over every place on Earth about twice a day. Their thermal-infrared sensors spot the extra heat of a fire, even one much smaller than a pixel.",
    art: () => (
      <Stage bg={NEON} label="A satellite orbiting the Earth scanning a swath of land">
        <Stars n={60} color="#9ecbff" />
        <circle cx={400} cy={250} r={120} fill="#1d4f9a" />
        <path d="M 320 200 q 40 -30 90 -10 q 40 20 60 0 q 20 30 -20 50 q -60 20 -130 -40 z" fill="#2f8f5b" />
        <ellipse cx={400} cy={250} rx={260} ry={90} fill="none" stroke="#38d3f0" strokeWidth={2} strokeDasharray="6 8" transform="rotate(-20 400 250)" />
        <g>
          <g>
            <rect x={-14} y={-8} width={28} height={16} rx={3} fill="#e8edf5" />
            <rect x={-40} y={-5} width={22} height={10} fill="#4d8eff" />
            <rect x={18} y={-5} width={22} height={10} fill="#4d8eff" />
            <polygon points="-8,8 8,8 40,90 -40,90" fill="#ff3d7f" opacity={0.25} />
            <animateMotion dur="7s" repeatCount="indefinite" path="M 660 250 A 260 90 0 1 1 140 250 A 260 90 0 1 1 660 250" rotate="0" />
          </g>
        </g>
        <FadeUp delay={0.4}>{txt(620, 70, "~700–830 km up", 20, "#38d3f0", 700)}</FadeUp>
        <FadeUp delay={0.8}>{txt(170, 410, "2 passes / day", 20, "#ff3d7f", 700)}</FadeUp>
        <FadeUp delay={1.2}>{txt(630, 410, "thermal infrared", 20, "#ffd23f", 700)}</FadeUp>
      </Stage>
    ),
  },
  {
    title: "The pixel problem",
    text: () => "VIIRS pixels are 375 m wide, MODIS pixels are 1 km. The same fire can light up several VIIRS pixels but only one MODIS pixel, so VIIRS counts more.",
    art: () => {
      const vx = [0, 1, 2];
      return (
        <Stage bg={NEON} label="One large MODIS pixel and several small VIIRS pixels over the same fire">
          <g transform="translate(110 90)">
            <rect width={240} height={240} fill="none" stroke="#4d8eff" strokeWidth={4} />
            <circle cx={120} cy={120} r={46} fill="#ff5a1f" opacity={0.85} />
            <motion.rect width={240} height={240} fill="#4d8eff" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.35, 0.2] }} transition={{ delay: 0.8, duration: 1.2 }} />
            {txt(120, 290, "MODIS · 1 km", 22, "#4d8eff")}
            <Pop delay={1.4} x={120} y={330}>
              {txt(120, 336, "1 detection", 30, "#fff", 800)}
            </Pop>
          </g>
          <g transform="translate(450 90)">
            <circle cx={120} cy={120} r={46} fill="#ff5a1f" opacity={0.85} />
            {vx.flatMap((i) =>
              vx.map((j) => {
                const hit = Math.hypot(i * 80 + 40 - 120, j * 80 + 40 - 120) < 80;
                return (
                  <motion.rect
                    key={`${i}${j}`}
                    x={i * 80}
                    y={j * 80}
                    width={80}
                    height={80}
                    fill={hit ? "#ff3d7f" : "transparent"}
                    stroke="#ff3d7f"
                    strokeWidth={2}
                    initial={{ fillOpacity: 0 }}
                    animate={{ fillOpacity: hit ? 0.35 : 0 }}
                    transition={{ delay: 1 + (i + j) * 0.15 }}
                  />
                );
              }),
            )}
            {txt(120, 290, "VIIRS · 375 m", 22, "#ff3d7f")}
            <Pop delay={2} x={120} y={330}>
              {txt(120, 336, "5 detections", 30, "#fff", 800)}
            </Pop>
          </g>
        </Stage>
      );
    },
  },
  {
    title: "Fake trend alert 🚨",
    text: (f) => `Glue the two records together and burning seems to jump about ×${f.naiveJump} in 2012. Not real: the sensor changed, not the fires.`,
    art: (f) => {
      const d = seriesPath(f.naiveAnnual, 80, 90, 640, 270);
      const idx = Math.max(0, 2012 - f.firstYear);
      const x = 80 + (idx / Math.max(f.naiveAnnual.length - 1, 1)) * 640;
      return (
        <Stage bg={NEON} label="A line chart that suddenly jumps when the new satellite starts">
          <line x1={80} y1={360} x2={720} y2={360} stroke="#2a3150" strokeWidth={2} />
          <DrawPath d={d} stroke="#ff3d7f" width={5} />
          <line x1={x} y1={70} x2={x} y2={360} stroke="#ffd23f" strokeDasharray="6 6" strokeWidth={2} />
          {txt(80, 395, String(f.firstYear), 18, "#7c86a8", 600, "start")}
          {txt(720, 395, String(f.lastYear), 18, "#7c86a8", 600, "end")}
          <Pop delay={1.9} x={x} y={60}>
            <rect x={x - 120} y={28} width={240} height={46} rx={10} fill="#ffd23f" />
            {txt(x, 60, `🚨 ×${f.naiveJump} jump: NOT REAL`, 20, "#0a0d1f", 800)}
          </Pop>
          {txt(x + 8, 352, "VIIRS joins", 16, "#ffd23f", 700, "start")}
        </Stage>
      );
    },
  },
  {
    title: "Hack the bias",
    text: (f) => `Three steps fix it: drop weak detections, count fire-days on one shared 1 km grid, then calibrate MODIS against VIIRS where both fly (k = ${f.k}). The fake jump disappears.`,
    art: (f) => {
      const d = seriesPath(f.annual, 80, 190, 640, 170, Math.max(...f.naiveAnnual));
      return (
        <Stage bg={NEON} label="Three steps and a now-smooth line">
          {["1 · filter", "2 · same grid", `3 · × k = ${f.k}`].map((s, i) => (
            <Pop key={s} delay={0.3 + i * 0.4} x={170 + i * 230} y={80}>
              <rect x={70 + i * 230} y={52} width={200} height={54} rx={12} fill="#141a3a" stroke={["#38d3f0", "#ff3d7f", "#ffd23f"][i]} strokeWidth={3} />
              {txt(170 + i * 230, 87, s, 22, "#fff")}
            </Pop>
          ))}
          <line x1={80} y1={360} x2={720} y2={360} stroke="#2a3150" strokeWidth={2} />
          <DrawPath d={seriesPath(f.naiveAnnual, 80, 190, 640, 170)} stroke="#ff3d7f" width={2} dash="4 6" delay={0.4} />
          <DrawPath d={d} stroke="#38d3f0" width={6} delay={1.4} />
          <Pop delay={3} x={600} y={160}>
            {txt(600, 170, "✔ harmonized", 24, "#38d3f0", 800)}
          </Pop>
        </Stage>
      );
    },
  },
  {
    title: "What the data really says",
    text: (f) =>
      `In ${f.years} years of real NASA data: burning fell about ${Math.abs(f.declinePct)}%, ${f.onsetDaysPerDecade !== null ? `the season now starts ~${Math.abs(f.onsetDaysPerDecade)} days ${f.onsetDaysPerDecade < 0 ? "earlier" : "later"} per decade, ` : ""}and ${f.persistentCells} cells are persistent hot spots.`,
    art: (f) => {
      const cards: [string, string, string][] = [
        [`${f.declinePct > 0 ? "+" : ""}${f.declinePct}%`, "burning, last 6 yrs vs first 6", "#38d3f0"],
        [f.onsetDaysPerDecade !== null ? `${f.onsetDaysPerDecade > 0 ? "+" : ""}${f.onsetDaysPerDecade} d` : "—", "season onset per decade", "#ffd23f"],
        [String(f.persistentCells), "persistent hot-spot cells", "#ff3d7f"],
        [`${f.chtShare}%`, "of burning in the CHT box", "#a78bfa"],
      ];
      return (
        <Stage bg={NEON} label="Four statistic cards">
          {cards.map(([v, l, c], i) => {
            const x = 70 + (i % 2) * 340;
            const y = 50 + Math.floor(i / 2) * 190;
            return (
              <Pop key={l} delay={0.2 + i * 0.3} x={x + 160} y={y + 80}>
                <rect x={x} y={y} width={320} height={160} rx={16} fill="#141a3a" stroke={c} strokeWidth={3} />
                {txt(x + 160, y + 85, v, 54, c, 800)}
                {txt(x + 160, y + 128, l, 18, "#c8cee6", 600)}
              </Pop>
            );
          })}
        </Stage>
      );
    },
  },
  {
    title: "Quick quiz",
    text: () => "Test yourself: three quick questions.",
    quiz: true,
    art: () => (
      <Stage bg={NEON} label="A trophy">
        <Stars n={30} color="#ffd23f" />
        <Pop delay={0.2} x={400} y={230}>
          <path d="M 330 120 h 140 v 60 a 70 70 0 0 1 -140 0 z" fill="#ffd23f" />
          <rect x={385} y={250} width={30} height={50} fill="#ffd23f" />
          <rect x={340} y={300} width={120} height={24} rx={6} fill="#ffb020" />
          {txt(400, 190, "?", 60, "#0a0d1f", 900)}
        </Pop>
      </Stage>
    ),
  },
];

export const QUIZ = (f: Facts) => [
  { q: "Why does raw fire data jump in 2012?", options: ["Fires doubled", "A sharper satellite (VIIRS) joined", "Rainfall stopped"], answer: 1, why: "VIIRS sees more small fires. The jump comes from the ruler, not the fires." },
  { q: "Which months burn most here?", options: [`${f.peakMonths[0]}–${f.peakMonths[1]}`, "July–August", "October–November"], answer: 0, why: "That is the dry season, when hill farmers clear land with fire." },
  { q: "What is a fire-day?", options: ["A day with any fire in the country", "A ~1 km square that had a confident fire detection on one day", "One satellite pass"], answer: 1, why: "Counting squares × days on one grid makes both satellites comparable." },
];

// ===========================================================================
// Seniors
// ===========================================================================
const CREAM = "#fbf6ec";
export const SENIORS: Scene[] = [
  {
    title: "A watchman in the sky",
    text: () => "Several NASA satellites circle the Earth. Like a watchman on a tall tower, they look down twice a day and notice where the land is unusually hot. That is how they find fires.",
    art: () => (
      <Stage bg={CREAM} label="A satellite watching over a quiet village and hills">
        <Hills y={300} colors={["#9cc79a", "#86b684", "#6fa36d"]} />
        <House x={250} y={360} />
        <House x={340} y={370} s={0.8} />
        <Tree x={480} y={350} />
        <motion.g animate={{ x: [-40, 40, -40] }} transition={{ repeat: Infinity, duration: 14, ease: "easeInOut" }}>
          <Satellite x={420} y={110} scale={0.9} />
        </motion.g>
        <Flame x={610} y={330} s={1.1} />
        <motion.circle cx={610} cy={305} r={40} fill="none" stroke="#c2410c" strokeWidth={4} animate={{ r: [30, 52, 30], opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 2.4 }} />
      </Stage>
    ),
  },
  {
    title: "Two pairs of glasses",
    text: () => "In 2012 a newer satellite with sharper vision joined. It sees more small fires, like putting on stronger glasses. If we simply added the counts together, it would look as if fires suddenly increased. They did not.",
    art: () => (
      <Stage bg={CREAM} label="Two pairs of glasses, one with stronger lenses">
        {[
          [260, "Older satellite", 0.5],
          [540, "Newer, sharper", 1],
        ].map(([x, label, s]) => (
          <g key={label as string}>
            <circle cx={(x as number) - 50} cy={200} r={44} fill="#fff" stroke="#1f2937" strokeWidth={8} />
            <circle cx={(x as number) + 50} cy={200} r={44} fill="#fff" stroke="#1f2937" strokeWidth={8} />
            <path d={`M ${(x as number) - 6} 196 q 6 -10 12 0`} stroke="#1f2937" strokeWidth={8} fill="none" />
            {[-50, 50].map((dx) =>
              Array.from({ length: (s as number) === 1 ? 5 : 1 }, (_, k) => (
                <Pop key={`${dx}${k}`} delay={0.6 + k * 0.2} x={(x as number) + dx} y={200}>
                  <circle cx={(x as number) + dx + ((k % 3) - 1) * 16} cy={200 + (Math.floor(k / 3) - 0.5) * 18} r={7} fill="#c2410c" />
                </Pop>
              )),
            )}
            {txt(x as number, 300, label as string, 28, "#1f2937", 700)}
          </g>
        ))}
      </Stage>
    ),
  },
  {
    title: "One fair ruler",
    text: () => "We fixed this by counting fires the same way for every year: on one common map of 1-kilometre squares. We also adjust the older counts to match the newer satellite. Now every year can be compared fairly.",
    art: () => (
      <Stage bg={CREAM} label="A ruler measuring two bars to the same height">
        <rect x={150} y={330} width={500} height={14} fill="#1f2937" />
        <motion.rect x={250} width={110} fill="#94a3b8" initial={{ y: 330, height: 0 }} animate={{ y: 190, height: 140 }} transition={{ duration: 1.2 }} />
        <motion.rect x={440} width={110} fill="#c2410c" initial={{ y: 330, height: 0 }} animate={{ y: 190, height: 140 }} transition={{ duration: 1.2, delay: 0.3 }} />
        <rect x={600} y={110} width={40} height={220} fill="#fde68a" stroke="#1f2937" strokeWidth={3} />
        {Array.from({ length: 10 }, (_, i) => (
          <line key={i} x1={600} x2={i % 2 ? 615 : 625} y1={120 + i * 21} y2={120 + i * 21} stroke="#1f2937" strokeWidth={3} />
        ))}
        <motion.line x1={230} x2={600} y1={190} y2={190} stroke="#15803d" strokeWidth={4} strokeDasharray="10 8" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1.6, duration: 1 }} />
        {txt(305, 380, "Before 2012", 24, "#1f2937", 600)}
        {txt(495, 380, "After 2012", 24, "#1f2937", 600)}
        <Pop delay={2.4} x={400} y={150}>
          {txt(400, 150, "✓ Same measure", 30, "#15803d", 800)}
        </Pop>
      </Stage>
    ),
  },
  {
    title: "What we found",
    text: (f) =>
      `Over ${f.years} years, burning in this region has gone down by about ${Math.abs(f.declinePct)}%. ${f.onsetDaysPerDecade !== null && f.onsetDaysPerDecade < 0 ? `But the fire season now starts earlier (on average around ${f.meanOnset}) and lasts longer.` : `The season usually starts around ${f.meanOnset}.`}`,
    art: (f) => {
      const first = f.annual.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
      const last = f.annual.slice(-6).reduce((a, b) => a + b, 0) / 6;
      const h1 = 220;
      const h2 = (last / first) * h1;
      return (
        <Stage bg={CREAM} label="Two bars: burning in early years and in recent years">
          <rect x={150} y={360} width={500} height={4} fill="#1f2937" />
          <motion.rect x={240} width={130} fill="#94a3b8" initial={{ y: 360, height: 0 }} animate={{ y: 360 - h1, height: h1 }} transition={{ duration: 1.2 }} />
          <motion.rect x={430} width={130} fill="#c2410c" initial={{ y: 360, height: 0 }} animate={{ y: 360 - h2, height: h2 }} transition={{ duration: 1.2, delay: 0.4 }} />
          {txt(305, 400, `${f.firstYear}–${f.firstYear + 5}`, 24, "#1f2937", 600)}
          {txt(495, 400, `${f.lastYear - 5}–${f.lastYear}`, 24, "#1f2937", 600)}
          <Pop delay={1.8} x={495} y={330 - h2}>
            {txt(495, 345 - h2, `${f.declinePct}%`, 36, "#c2410c", 800)}
          </Pop>
        </Stage>
      );
    },
  },
  {
    title: "What it means for you",
    text: () =>
      "Smoke from these fires can make breathing harder, especially for older people. On smoky days keep windows closed and rest indoors. Avoid burning leaves on dry, windy days. If you see a fire spreading, call the national emergency number 999.",
    art: () => (
      <Stage bg={CREAM} label="A house with closed windows, smoke outside, and a phone showing 999">
        <Hills y={320} colors={["#9cc79a", "#86b684", "#6fa36d"]} />
        <Flame x={660} y={320} s={1.2} />
        <Smoke x={660} y={280} color="#a8a29e" />
        <Smoke x={620} y={290} delay={1} color="#a8a29e" />
        <House x={300} y={350} s={1.6} />
        <Pop delay={0.8} x={520} y={180}>
          <rect x={470} y={90} width={100} height={170} rx={16} fill="#1f2937" />
          <rect x={482} y={110} width={76} height={110} rx={6} fill="#dbeafe" />
          {txt(520, 180, "999", 34, "#b91c1c", 900)}
        </Pop>
      </Stage>
    ),
  },
];

// ===========================================================================
// Why it matters (real-world importance)
// ===========================================================================
const NIGHT = "#070b14";
const IMPACTS: [string, string, number, number][] = [
  ["Smoke & air", "#94a3b8", 140, 110],
  ["Health", "#f87171", 400, 60],
  ["Forests", "#22c55e", 660, 110],
  ["Wildlife", "#f59e0b", 700, 290],
  ["Soil & landslides", "#a16207", 520, 400],
  ["Climate (CO₂)", "#38bdf8", 280, 400],
  ["Farm livelihoods", "#a78bfa", 100, 290],
];

export const WHY: Scene[] = [
  {
    title: "One fire, many consequences",
    text: () => "A single season of fires touches the air we breathe, our health, forests, wildlife, hillside soil, the climate and the income of farming families.",
    art: () => (
      <Stage bg={NIGHT} label="A fire at the centre connected to seven impacts">
        <Stars n={30} color="#334155" />
        {IMPACTS.map(([label, color, x, y], i) => (
          <g key={label}>
            <motion.line x1={400} y1={240} x2={x} y2={y} stroke={color} strokeWidth={2} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.7 }} transition={{ delay: 0.4 + i * 0.25, duration: 0.8 }} />
            <Pop delay={0.9 + i * 0.25} x={x} y={y}>
              <circle cx={x} cy={y} r={14} fill={color} />
              <motion.circle cx={x} cy={y} r={14} fill="none" stroke={color} strokeWidth={2} animate={{ r: [14, 30], opacity: [0.8, 0] }} transition={{ repeat: Infinity, duration: 2, delay: i * 0.3 }} />
              {txt(x, y + (y > 240 ? 42 : -26), label, 19, "#e5e7eb", 700)}
            </Pop>
          </g>
        ))}
        <Flame x={400} y={268} s={1.6} />
      </Stage>
    ),
  },
  {
    title: "Smoke travels",
    text: () => "Fine smoke particles (PM2.5) drift far from the fire into towns and cities. They reach deep into the lungs and are linked to asthma attacks and heart and lung disease.",
    art: () => (
      <Stage bg="#1a1410" label="Smoke drifting from burning hills toward a city">
        <Hills y={330} colors={["#3f3a2a", "#332f22", "#29261b"]} />
        <Flame x={120} y={330} s={1.3} />
        <Flame x={180} y={320} s={1} delay={0.4} />
        {Array.from({ length: 26 }, (_, i) => (
          <motion.circle key={i} r={2 + (i % 4)} fill="#a8a29e" initial={{ cx: 140, cy: 280, opacity: 0 }} animate={{ cx: [140, 760], cy: [280, 140 + (i % 7) * 18], opacity: [0, 0.8, 0] }} transition={{ repeat: Infinity, duration: 6, delay: i * 0.23 }} />
        ))}
        {[560, 600, 640, 680, 720].map((x, i) => (
          <rect key={x} x={x} y={260 - (i % 3) * 40} width={34} height={140 + (i % 3) * 40} fill="#1f2937" stroke="#334155" />
        ))}
        {txt(650, 80, "PM2.5", 34, "#e7e5e4", 800)}
      </Stage>
    ),
  },
  {
    title: "Hills lose their protection",
    text: () => "When hillsides are burned too often, fewer roots hold the soil. Heavy monsoon rain can then wash it away, which raises the risk of landslides in hill districts.",
    art: () => (
      <Stage bg="#0f172a" label="Rain falling on a bare hill and soil sliding down">
        <path d="M 0 380 L 330 140 L 800 380 L 800 450 L 0 450 Z" fill="#6b4f2a" />
        <Tree x={240} y={240} s={0.8} burnt />
        <Tree x={420} y={240} s={0.8} burnt />
        <Tree x={600} y={330} s={0.9} />
        {Array.from({ length: 40 }, (_, i) => (
          <motion.line key={i} x1={(i * 53) % 800} x2={((i * 53) % 800) - 8} y1={0} y2={20} stroke="#60a5fa" strokeWidth={2} animate={{ y: [0, 400] }} transition={{ repeat: Infinity, duration: 1.2, delay: (i % 10) * 0.12, ease: "linear" }} />
        ))}
        <motion.path d="M 250 230 q 40 40 20 90 q -20 40 -80 70" stroke="#a16207" strokeWidth={26} fill="none" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1 }} />
      </Stage>
    ),
  },
  {
    title: "Forests and wildlife",
    text: () => "Fires damage forests that shelter wildlife, from the hill forests to the Sundarbans, home of the Bengal tiger. Burning also releases carbon dioxide stored in trees and soil.",
    art: () => (
      <Stage bg="#06281f" label="A tiger among mangrove trees, with carbon dioxide rising from a fire">
        {[80, 180, 300, 520, 640, 740].map((x, i) => (
          <Tree key={x} x={x} y={340 + (i % 2) * 20} s={1.3} />
        ))}
        <Tiger x={400} y={330} s={1.4} />
        <Flame x={690} y={250} s={0.9} />
        {[0, 1, 2].map((i) => (
          <motion.text key={i} x={680} y={220} fontSize={26} fontWeight={800} fill="#7dd3fc" animate={{ y: [220, 80], opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 3, delay: i }}>
            CO₂
          </motion.text>
        ))}
      </Stage>
    ),
  },
  {
    title: "Consistent data is the keystone",
    text: (f) => `Decisions stand on data. If the record shows a fake ×${f.naiveJump} jump, money and patrols go to the wrong place at the wrong time. Harmonized data is the keystone that holds the decisions up.`,
    art: (f) => {
      // Seven positions on a semicircle; the crown (index 3) is the keystone.
      const stones = ["Budgets", "Patrols", "Early warning", null, "Health alerts", "Climate reports", "Research"];
      return (
        <Stage bg={NIGHT} label="An arch of decision stones held up by a keystone labelled harmonized data">
          {stones.map((s, j) => {
            if (!s) return null;
            const angle = Math.PI - (j * Math.PI) / 6;
            const x = 400 + Math.cos(angle) * 270;
            const y = 380 - Math.sin(angle) * 270;
            return (
              <motion.g key={s} initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 + j * 0.2, type: "spring" }}>
                <rect x={x - 64} y={y - 24} width={128} height={48} rx={8} fill="#1e293b" stroke="#64748b" strokeWidth={2} />
                {txt(x, y + 6, s, 15, "#e2e8f0", 700)}
              </motion.g>
            );
          })}
          <motion.g initial={{ y: -200 }} animate={{ y: 0 }} transition={{ delay: 1.8, type: "spring", stiffness: 120 }}>
            <rect x={325} y={78} width={150} height={64} rx={8} fill="#0b3d91" stroke="#4d8eff" strokeWidth={3} />
            {txt(400, 105, "Harmonized", 18, "#fff", 800)}
            {txt(400, 128, "data", 18, "#fff", 800)}
          </motion.g>
          <Pop delay={2.6} x={400} y={300}>
            {txt(400, 300, `k = ${f.k} · one ruler for ${f.years} years`, 20, "#93c5fd", 700)}
          </Pop>
        </Stage>
      );
    },
  },
  {
    title: "From pixels to protection",
    text: (f) => `FireCal turns ${f.detections.toLocaleString()} real NASA detections into a fire calendar, a hot-spot map and an outlook that beats the 10-year average by ${f.outlookSkill}%, so teams can act before the season starts.`,
    art: () => {
      const steps = ["Satellites", "Harmonized record", "Insights", "Early warning", "Teams act"];
      return (
        <Stage bg={NIGHT} label="A pipeline from satellites to teams in the field">
          {steps.map((s, i) => {
            const x = 90 + i * 155;
            return (
              <Pop key={s} delay={0.3 + i * 0.3} x={x} y={220}>
                <circle cx={x} cy={220} r={46} fill="#0f172a" stroke={["#38d3f0", "#4d8eff", "#a78bfa", "#ff7a1a", "#22c55e"][i]} strokeWidth={4} />
                {txt(x, 228, String(i + 1), 26, "#fff", 800)}
                {txt(x, 300, s, 17, "#e2e8f0", 700)}
              </Pop>
            );
          })}
          <line x1={136} x2={664} y1={220} y2={220} stroke="#334155" strokeWidth={3} strokeDasharray="4 8" />
          {[0, 1, 2, 3].map((i) => (
            <motion.circle key={i} r={7} cy={220} fill="#ffd23f" animate={{ cx: [90, 710] }} transition={{ repeat: Infinity, duration: 3.2, delay: i * 0.8, ease: "linear" }} />
          ))}
        </Stage>
      );
    },
  },
];

export const STORIES: Record<Audience, { scenes: Scene[] }> = { kids: { scenes: KIDS }, teens: { scenes: TEENS }, seniors: { scenes: SENIORS }, why: { scenes: WHY } };
export const SCENE_H = H;
