import { motion } from "framer-motion";
import { ArrowLeft, BookOpen, Download, ExternalLink, FlaskConical, Orbit, Radar, Scale, Sigma, Wind } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { EmissionsFile, HarmonizationFile } from "../../pipeline/harmonization-build";
import { LogoMark } from "../components/Header";
import { fmt } from "../lib/color";

const REPO = "https://github.com/sagoresarkerbdcse/nasa";
const RAW = "https://raw.githubusercontent.com/sagoresarkerbdcse/nasa/main";
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

// Validated categorical slots (dark surface): orange, blue, aqua. Baselines stay neutral gray.
const C = { ours: "#d95926", blue: "#3987e5", aqua: "#199e70", base: "#6b7383", base2: "#8a93a3" };
const axis = { fill: "#7b8494", fontSize: 10, fontFamily: "DM Mono" };
const tip = {
  contentStyle: { background: "rgba(8,11,16,0.97)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, fontSize: 11, fontFamily: "DM Mono" },
  labelStyle: { color: "#fff" },
  itemStyle: { color: "#cbd5e1" },
};
const METHOD_LABEL: Record<string, string> = {
  "v1-global": "One global ratio",
  "v1-unit": "One ratio per country (FireCal v1)",
  "v2-season": "Ratio per country × season",
  v2: "FireCal v2 (season ratio + small-fire floor)",
};

function Card({ icon, kicker, title, children, i = 0 }: { icon: React.ReactNode; kicker: string; title: string; children: React.ReactNode; i?: number }) {
  return (
    <motion.section initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45, delay: i * 0.05 }} className="panel hud p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-signal">{icon}</span>
        <span className="eyebrow !text-signal">{kicker}</span>
      </div>
      <h2 className="mb-3 text-[19px] font-bold tracking-tight text-white">{title}</h2>
      {children}
    </motion.section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-[4px] border border-white/[0.08] bg-white/[0.02] px-3.5 py-3">
      <div className="eyebrow !text-[9.5px]">{label}</div>
      <div className={`mt-1.5 text-[24px] font-semibold leading-none tabular-nums ${tone ?? "text-white"}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] leading-snug text-slate-400">{sub}</div>}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; dot?: boolean }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.dot ? <span className="h-2 w-2 rounded-full" style={{ background: it.color }} /> : <span className="h-0 w-4 border-t-2" style={{ borderColor: it.color, borderStyle: it.dashed ? "dashed" : "solid" }} />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

const P = ({ children }: { children: React.ReactNode }) => <p className="mt-3 text-[12.5px] leading-relaxed text-slate-400">{children}</p>;

export default function LabPage() {
  const [h, setH] = useState<HarmonizationFile | null>(null);
  const [em, setEm] = useState<EmissionsFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [country, setCountry] = useState<string>("");

  useEffect(() => {
    document.title = "Harmonization Lab · FireCal AI";
    fetch("/data/global/harmonization.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("harmonization.json not built yet"))))
      .then((d: HarmonizationFile) => {
        setH(d);
        setCountry(d.countries[0]?.name ?? "");
      })
      .catch((e) => setErr(String(e.message ?? e)));
    fetch("/data/global/emissions.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEm(d))
      .catch(() => {});
  }, []);

  const v2 = h?.validation.map((f) => f.scores.find((s) => s.method === "v2")!);
  const g1 = h?.validation.map((f) => f.scores.find((s) => s.method === "v1-global")!);
  const c = h?.countries.find((x) => x.name === country);
  const det = h?.detection;
  const drift = h?.drift;

  const emWorld = useMemo(() => {
    if (!em) return [];
    const f = em.fields;
    return em.world.years.map((row, i) => ({
      year: em.firstYear + i,
      co2: row[f.indexOf("co2")],
      co2Band: [row[f.indexOf("co2Lo")], row[f.indexOf("co2Hi")]] as [number, number],
      pm25: row[f.indexOf("pm25")],
      pm25Band: [row[f.indexOf("pm25Lo")], row[f.indexOf("pm25Hi")]] as [number, number],
      viirs: row[f.length - 1] === 1,
    }));
  }, [em]);
  const emTop = useMemo(() => {
    if (!em) return [];
    const f = em.fields;
    const recent = (rows: number[][]) => {
      const r = rows.slice(-10);
      return r.reduce((s, x) => s + x[f.indexOf("co2")], 0) / Math.max(r.length, 1);
    };
    const pm = (rows: number[][]) => {
      const r = rows.slice(-10);
      return r.reduce((s, x) => s + x[f.indexOf("pm25")], 0) / Math.max(r.length, 1);
    };
    return em.countries
      .map((x) => ({ name: x.name, co2: recent(x.years), pm25: pm(x.years) }))
      .sort((a, b) => b.co2 - a.co2)
      .slice(0, 12);
  }, [em]);

  return (
    <div className="space-bg min-h-full">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#070a0f]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <a href="/" className="flex items-center gap-2 rounded-[4px] px-2 py-1 text-[12px] text-slate-300 hover:bg-white/5">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </a>
          <LogoMark size={28} spin={false} />
          <div className="min-w-0">
            <div className="eyebrow !text-[9.5px]">FireCal AI</div>
            <h1 className="truncate text-[15px] font-bold">Harmonization Lab</h1>
          </div>
          <a href={`${REPO}/releases`} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1.5 rounded-[4px] bg-nasa-blue px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-white hover:bg-[#1450b8]">
            <Download className="h-3.5 w-3.5" /> Dataset
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
          <div className="eyebrow !text-signal">Method and evidence</div>
          <h2 className="mt-2 text-[30px] font-extrabold leading-tight tracking-tight sm:text-[36px]">One fire record from two satellite eras, with honest error bars</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-slate-300">
            MODIS (2000→) and VIIRS (2012→) see fire differently. VIIRS's smaller pixels catch fires MODIS misses, and MODIS's orbits have drifted. Here is how FireCal turns them into one consistent record, and how well that works when tested on years the model never saw.
          </p>
        </motion.div>

        {err && <div className="panel p-5 text-[13px] text-amber-200">{err}. Run the “Build global FIRMS dataset” workflow.</div>}

        {h && v2 && g1 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Monthly error, blind test" value={`${v2[0].monthlyMedianPct}%`} sub={<>median, held-out years ({h.validation[0].test[0]}–{h.validation[0].test.at(-1)}); one global ratio: {g1[0].monthlyMedianPct}%</>} tone="text-orange-300" />
            <Tile label="Annual error, blind test" value={`${v2[0].annualMedianPct}%`} sub="median per country-year" />
            <Tile label="90% interval coverage" value={`${Math.round((v2[0].coverage90 ?? 0) * 100)}%`} sub={`monthly; annual ${Math.round((v2[0].coverage90Annual ?? 0) * 100)}% (target 90%)`} />
            {det ? <Tile label="MODIS sees half of fires at" value={`${det.frp50[0].mw} MW`} sub={`daytime, nadir; ${det.frp50[1].mw} MW at the swath edge`} tone="text-sky-300" /> : <Tile label="Training years" value={`${h.trainYears[0]}–${h.trainYears.at(-1)}`} />}
          </div>
        )}

        {h && (
          <Card icon={<Scale className="h-4 w-4" />} kicker="1 · Blind validation" title="Tested on years the model never saw">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="py-2 pr-3 font-normal">Method</th>
                    {h.validation.map((f) => (
                      <th key={f.test.join()} className="px-2 py-2 font-mono text-[10.5px] font-normal">
                        train {f.train[0]}–{String(f.train.at(-1)).slice(2)} → test {f.test[0]}–{String(f.test.at(-1)).slice(2)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(METHOD_LABEL).map((m) => (
                    <tr key={m} className={`border-b border-white/[0.05] ${m === "v2" ? "bg-orange-500/[0.07]" : ""}`}>
                      <td className={`py-2 pr-3 ${m === "v2" ? "font-semibold text-white" : "text-slate-300"}`}>{METHOD_LABEL[m]}</td>
                      {h.validation.map((f) => {
                        const s = f.scores.find((x) => x.method === m)!;
                        return (
                          <td key={f.test.join()} className="px-2 py-2 font-mono tabular-nums text-slate-200">
                            {s.monthlyMedianPct}% <span className="text-slate-500">· yr {s.annualMedianPct}%</span>
                            {s.coverage90 !== undefined && <div className="text-[10px] text-slate-500">90% band holds {Math.round(s.coverage90 * 100)}% / {Math.round((s.coverage90Annual ?? 0) * 100)}%</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <P>
              We pretend VIIRS does not exist in the test years, harmonize their MODIS data, and compare with what VIIRS actually saw: median absolute error of monthly and annual country totals (months with ≥100 VIIRS fire-days, country-years with ≥1000). The last fold (2022→) is
              where Terra and Aqua have drifted most.
            </P>
          </Card>
        )}

        {h && c && (
          <Card icon={<Sigma className="h-4 w-4" />} kicker="2 · The transfer" title="How many VIIRS fire-days one MODIS fire-day is worth, by season">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor="lab-country" className="text-[12px] text-slate-400">
                Country
              </label>
              <select id="lab-country" value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-[4px] border border-white/15 bg-black/40 px-2 py-1 text-[12.5px] text-white">
                {h.countries.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name}
                  </option>
                ))}
              </select>
              <span className="font-mono text-[11px] text-slate-500">
                annual k {c.kAnnual} · prediction scatter ±{Math.round((Math.exp(1.645 * c.sigma) - 1) * 100)}% (90%) · world k {h.world.kAnnual}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <figure>
                <figcaption className="eyebrow mb-1 !text-[9.5px]">Ratio k by month (VIIRS ÷ MODIS fire-days)</figcaption>
                <div className="h-[190px]">
                  <ResponsiveContainer>
                    <ComposedChart data={c.k.map((k, m) => ({ m: MONTHS[m], k, world: h.world.k[m] }))} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="m" tick={axis} tickLine={false} axisLine={false} />
                      <YAxis tick={axis} tickLine={false} axisLine={false} domain={[0, "auto"]} />
                      <Tooltip {...tip} />
                      <Line dataKey="world" name="World" stroke={C.base} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
                      <Line dataKey="k" name={country} stroke={C.ours} strokeWidth={2.4} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <Legend
                  items={[
                    { label: country, color: C.ours },
                    { label: "World", color: C.base, dashed: true },
                  ]}
                />
              </figure>
              <figure>
                <figcaption className="eyebrow mb-1 !text-[9.5px]">Small-fire floor (VIIRS fire-days MODIS cannot see)</figcaption>
                <div className="h-[190px]">
                  <ResponsiveContainer>
                    <BarChart data={c.floor.map((f, m) => ({ m: MONTHS[m], f }))} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="m" tick={axis} tickLine={false} axisLine={false} />
                      <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
                      <Tooltip {...tip} formatter={(v: unknown) => [fmt(Number(v)), "fire-days / month"]} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                      <Bar dataKey="f" fill={C.blue} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </figure>
            </div>
            <P>
              VIIRS-equivalent fire-days = k(month) × MODIS fire-days + floor(month). k comes from the overlap years ({h.trainYears[0]}–{h.trainYears.at(-1)}), month ±1 at quarter weight, shrunk toward the world value where a country has little evidence. Small, cool fires (crop
              residue, grass) raise k and the floor; big forest fires lower them.
            </P>
          </Card>
        )}

        {det && (
          <Card icon={<Radar className="h-4 w-4" />} kicker="3 · Physics from matchups" title="How often MODIS detects the fires VIIRS sees">
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {det.frp50.map((f) => (
                <Tile key={`${f.night}${f.pix}`} label={`${f.night ? "Night" : "Day"} · ${f.pix.split(" (")[0].includes("<") ? "nadir" : "swath edge"}`} value={`${f.mw} MW`} sub="fire power for a 50% chance" />
              ))}
            </div>
            <Legend
              items={[
                { label: "Day, nadir pixels", color: C.ours },
                { label: "Day, swath edge", color: C.ours, dashed: true },
                { label: "Night, nadir pixels", color: C.blue },
                { label: "Night, swath edge", color: C.blue, dashed: true },
                { label: "observed (dots)", color: "#cbd5e1", dot: true },
              ]}
            />
            <div className="h-[260px]">
              <ResponsiveContainer>
                <ComposedChart margin={{ top: 6, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" dataKey="lx" domain={[-1, 12]} ticks={[0, 2, 4, 6, 8, 10, 12]} tickFormatter={(v) => fmt(2 ** v)} tick={axis} tickLine={false} axisLine={false} label={{ value: "VIIRS fire radiative power (MW, log scale)", fill: "#7b8494", fontSize: 10, position: "insideBottom", offset: -2 }} allowDuplicatedCategory={false} />
                  <YAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={axis} tickLine={false} axisLine={false} />
                  <Tooltip {...tip} formatter={(v: unknown, n?: unknown) => [typeof v === "number" && v <= 1 ? `${Math.round(v * 100)}%` : String(v), String(n)]} labelFormatter={(v) => `${fmt(2 ** Number(v))} MW`} />
                  {det.curves.map((cv) => {
                    const color = cv.night ? C.blue : C.ours;
                    const data = cv.points.map((p) => ({ lx: Math.log2(p.frp), p: p.p, fit: p.fit }));
                    return [
                      <Line key={`${cv.label}-f`} data={data} dataKey="fit" name={`${cv.label} (model)`} stroke={color} strokeDasharray={cv.pix === 0 ? undefined : "5 4"} strokeWidth={2} dot={false} isAnimationActive={false} />,
                      <Scatter key={`${cv.label}-o`} data={data} dataKey="p" name={`${cv.label} (observed)`} fill={color} stroke="#0c1016" strokeWidth={1.5} isAnimationActive={false} />,
                    ];
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <P>
              {fmt(det.nObjects)} VIIRS fire objects (~1 km cells, {det.byYear[0]?.year}–{det.byYear.at(-1)?.year}) fell inside an Aqua MODIS overpass within 25 minutes; MODIS detected {Math.round(det.overall * 100)}% of them. A logistic model (pseudo-R²{" "}
              {det.pseudoR2}) explains detection by fire power, MODIS pixel size (which grows ~10× toward the swath edge), day/night and latitude. This is why one MODIS fire-day is worth several VIIRS fire-days, and why the ratio depends on how big the fires are.
            </P>
          </Card>
        )}

        {drift && (
          <Card icon={<Orbit className="h-4 w-4" />} kicker="4 · Orbit drift" title="Terra and Aqua have drifted, and MODIS fire counts drift with them">
            <div className="grid gap-4 md:grid-cols-2">
              <figure>
                <figcaption className="eyebrow mb-1 !text-[9.5px]">Day overpass time vs reference (minutes)</figcaption>
                <Legend
                  items={[
                    { label: "Terra (~10:30)", color: C.aqua },
                    { label: "Aqua (~13:30)", color: C.ours },
                    { label: "S-NPP VIIRS (reference)", color: C.base, dashed: true },
                  ]}
                />
                <div className="h-[200px]">
                  <ResponsiveContainer>
                    <ComposedChart
                      data={drift.passes
                        .find((p) => p.sat === "terra" && p.pass === "day")!
                        .points.map((p, i) => {
                          const aqua = drift.passes.find((x) => x.sat === "aqua" && x.pass === "day")!.points[i];
                          const sn = drift.snpp.find((s) => s.year === p.year);
                          const snRef = drift.snpp.filter((s) => s.year >= drift.referenceYears[0] && s.year <= drift.referenceYears[1]);
                          const snMean = snRef.length ? snRef.reduce((a, s) => a + s.day, 0) / snRef.length : null;
                          return { year: p.year, terra: p.shiftMin, aqua: aqua?.shiftMin, snpp: sn && snMean !== null ? Math.round((sn.day - snMean) * 600) / 10 : null };
                        })}
                      margin={{ top: 6, right: 8, left: -14, bottom: 0 }}
                    >
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} interval={3} />
                      <YAxis tick={axis} tickLine={false} axisLine={false} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                      <Tooltip {...tip} formatter={(v: unknown, n?: unknown) => [`${v} min`, String(n)]} />
                      <Line dataKey="terra" name="Terra" stroke={C.aqua} strokeWidth={2} dot={false} />
                      <Line dataKey="aqua" name="Aqua" stroke={C.ours} strokeWidth={2} dot={false} />
                      <Line dataKey="snpp" name="S-NPP" stroke={C.base} strokeDasharray="4 3" strokeWidth={1.5} dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </figure>
              <figure>
                <figcaption className="eyebrow mb-1 !text-[9.5px]">MODIS fire-days lost or gained to drift alone (%)</figcaption>
                <div className="h-[226px]">
                  <ResponsiveContainer>
                    <BarChart data={drift.bias.filter((b) => b.year >= 2012)} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} interval={2} />
                      <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                      <Tooltip {...tip} formatter={(v: unknown) => [`${v}%`, "drift effect"]} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                      <Bar dataKey="pct" fill={C.blue} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </figure>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {drift.passes.map((ps) => (
                <Tile key={ps.sat + ps.pass} label={`${ps.sat === "terra" ? "Terra" : "Aqua"} ${ps.pass}`} value={`${ps.slope > 0 ? "+" : ""}${Math.round(ps.slope * 1000) / 10}%/h`} sub={`detections vs VIIRS per hour of drift · p=${ps.p}`} />
              ))}
            </div>
            <P>
              Overpass times come from the detections themselves (local solar time, |lat| ≤ 40°). Comparing each MODIS pass with VIIRS (whose orbit is maintained) shows how the share of fires MODIS catches changes as its overpass slides along the daily fire cycle. A MODIS-only
              world trend reads {drift.modisTrend.raw}%/decade (p={drift.modisTrend.rawP}); removing the drift effect gives {drift.modisTrend.corrected}%/decade (p={drift.modisTrend.correctedP}). FireCal uses VIIRS from 2012 and trains the transfer on {h?.trainYears[0]}–
              {h?.trainYears.at(-1)}, so its record is not affected.
            </P>
          </Card>
        )}

        {h?.sensorGaps && (h.sensorGaps.viirs.length > 0 || h.sensorGaps.modis.length > 0) && (
          <Card icon={<Radar className="h-4 w-4" />} kicker="5 · Sensor outages" title="Gaps in the satellite record, found and corrected">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="eyebrow mb-1.5 !text-[9.5px]">VIIRS months that are incomplete (corrected)</div>
                <table className="w-full text-left text-[12px]">
                  <tbody>
                    {h.sensorGaps.viirs.map((g) => (
                      <tr key={`${g.year}-${g.month}`} className="border-b border-white/[0.05]">
                        <td className="py-1.5 font-mono text-slate-200">
                          {g.year}-{String(g.month).padStart(2, "0")}
                        </td>
                        <td className="py-1.5 text-slate-300">{Math.round(g.completeness * 100)}% of normal</td>
                        <td className="py-1.5 text-right font-mono text-[11px] text-slate-500">×{(1 / g.completeness).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="eyebrow mb-1.5 !text-[9.5px]">MODIS months that are incomplete (reported)</div>
                <table className="w-full text-left text-[12px]">
                  <tbody>
                    {h.sensorGaps.modis.map((g) => (
                      <tr key={`${g.year}-${g.month}`} className="border-b border-white/[0.05]">
                        <td className="py-1.5 font-mono text-slate-200">
                          {g.year}-{String(g.month).padStart(2, "0")}
                        </td>
                        <td className="py-1.5 text-slate-300">VIIRS/MODIS ratio {g.ratioVsNormal.toFixed(2)}× normal</td>
                      </tr>
                    ))}
                    {!h.sensorGaps.modis.length && (
                      <tr>
                        <td className="py-1.5 text-slate-500">none detected</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <P>
              A satellite safe mode or data gap removes detections everywhere at once, so it shows up as a world VIIRS/MODIS ratio far from that calendar month's normal (below {Math.round(0.85 * 100)}% or above 135%). Incomplete VIIRS months are scaled up by their completeness, which keeps
              VIIRS's spatial detail, and carry a wider interval. A raw record would show them as sudden fire declines. January 2012 is a check: VIIRS fire data start on 20 January, so about 12 of 31 days (39%) are expected.
            </P>
          </Card>
        )}

        {em && (
          <Card icon={<Wind className="h-4 w-4" />} kicker="6 · Fire energy and emissions" title="From fire radiative power to CO₂ and smoke">
            <div className="grid gap-4 md:grid-cols-2">
              {(
                [
                  ["co2", "co2Band", "World CO₂ from active fires (Tg per year)", C.ours],
                  ["pm25", "pm25Band", "World PM2.5 from active fires (Tg per year)", C.blue],
                ] as const
              ).map(([k, band, label, color]) => (
                <figure key={k}>
                  <figcaption className="eyebrow mb-1 !text-[9.5px]">{label}</figcaption>
                  <div className="h-[200px]">
                    <ResponsiveContainer>
                      <ComposedChart data={emWorld} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} interval={3} />
                        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
                        <Tooltip {...tip} formatter={(v: unknown, n?: unknown) => (Array.isArray(v) ? [`${fmt(v[0])} – ${fmt(v[1])}`, "range"] : [fmt(Number(v)), String(n)])} />
                        <Area dataKey={band} name="range" stroke="none" fill="rgba(255,255,255,0.14)" isAnimationActive={false} />
                        <Line dataKey={k} name={k === "co2" ? "CO₂" : "PM2.5"} stroke={color} strokeWidth={2.2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </figure>
              ))}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="py-1.5 pr-3 font-normal">Country (last 10 years, mean per year)</th>
                    <th className="px-2 py-1.5 font-normal">CO₂ (Tg)</th>
                    <th className="px-2 py-1.5 font-normal">PM2.5 (Gg)</th>
                  </tr>
                </thead>
                <tbody>
                  {emTop.map((r) => (
                    <tr key={r.name} className="border-b border-white/[0.05]">
                      <td className="py-1.5 pr-3 text-slate-200">{r.name}</td>
                      <td className="px-2 py-1.5 font-mono tabular-nums text-slate-200">{fmt(Math.round(r.co2))}</td>
                      <td className="px-2 py-1.5 font-mono tabular-nums text-slate-200">{fmt(Math.round(r.pm25 * 1000))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <P>
              Terra and Aqua sample fire power four times a day; a Gaussian-plus-baseline daily cycle fitted to them turns the ~13:30 VIIRS (or harmonized MODIS) fire power into fire radiative energy. Energy × 0.368 kg/MJ gives dry matter burned (Wooster et al., 2005);
              emission factors after Andreae (2019) give CO₂, CO and PM2.5, with the range across biomes. Fires under cloud or too small for VIIRS are not counted, so these are conservative (low) estimates.
            </P>
          </Card>
        )}

        <Card icon={<FlaskConical className="h-4 w-4" />} kicker="7 · Open data" title="Use it, cite it">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { href: `${REPO}/releases`, title: "Full dataset", body: "NetCDF (monthly 1°, with 90% intervals), Cloud-Optimized GeoTIFFs, STAC catalog, CSV tables, notebook" },
              { href: `${RAW}/public/data/global/harmonization.json`, title: "Model and validation (JSON)", body: "Seasonal transfer for every country, blind-test scores, detection model, drift analysis" },
              { href: `${REPO}/blob/main/docs/ATBD.md`, title: "Methods (ATBD)", body: "Algorithm description, assumptions, limitations and how to reproduce every number" },
            ].map((x) => (
              <a key={x.title} href={x.href} target="_blank" rel="noreferrer" className="group rounded-[4px] border border-white/10 p-3 transition-colors hover:border-signal/60">
                <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-white">
                  {x.title} <ExternalLink className="h-3.5 w-3.5 text-slate-500 group-hover:text-signal" />
                </div>
                <div className="mt-1 text-[12px] leading-snug text-slate-400">{x.body}</div>
              </a>
            ))}
          </div>
          <div className="mt-3 rounded-[4px] border border-white/[0.08] bg-white/[0.02] p-3 text-[11.5px] leading-relaxed text-slate-400">
            <BookOpen className="mr-1.5 inline h-3.5 w-3.5 text-signal" />
            Cite as: FireCal AI team (2026). <em>FireCal Harmonized Active Fire Record (MODIS→VIIRS)</em>, version 1.0.0 [dataset]. CC BY 4.0. Derived from NASA FIRMS (ESDIS). The DOI appears here once the dataset is archived on Zenodo.
          </div>
        </Card>

        <footer className="pb-6 text-center text-[11px] text-slate-500">Independent project for the NASA Space Apps Challenge 2026 · not affiliated with or endorsed by NASA</footer>
      </main>
    </div>
  );
}
