import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Atom, Flame, Minus, Moon, Waves } from "lucide-react";
import { useMemo } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { fmt } from "../lib/color";
import { mannKendall } from "../lib/harmonize";
import type { CountriesFile } from "../lib/global";
import { INTERVAL_LABELS, ensoLink, fireRegime, intensity, type EnsoRankRow, type OniFile } from "../lib/science";
import type { AoiAnalysis, BBox, GridFile, TrendResult } from "../lib/types";
import type { EmissionsFile } from "../../pipeline/harmonization-build";
import { Wind } from "lucide-react";

const axis = { fill: "#7b8494", fontSize: 10, fontFamily: "DM Mono" };
const tip = {
  contentStyle: { background: "rgba(8,11,16,0.97)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, fontSize: 11, fontFamily: "DM Mono" },
  labelStyle: { color: "#fff" },
  itemStyle: { color: "#cbd5e1" },
};

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-[4px] border border-white/[0.07] bg-white/[0.02] px-3 py-2">
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className={`mt-1 text-[17px] font-semibold leading-none tabular-nums ${tone ?? "text-white"}`}>{value}</div>
      {sub && <div className="mt-1 font-mono text-[9.5px] text-slate-500">{sub}</div>}
    </div>
  );
}

function TrendTag({ t, unit }: { t: TrendResult; unit: string }) {
  const Icon = !t.significant ? Minus : t.senSlope > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" aria-hidden />
      {t.significant ? `${t.senSlope > 0 ? "+" : ""}${t.senSlope}${unit}/yr (p=${t.pValue})` : `no trend (p=${t.pValue})`}
    </span>
  );
}

function Section({ icon, title, children, i }: { icon: React.ReactNode; title: string; children: React.ReactNode; i: number }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
        <span className="text-signal">{icon}</span>
        {title}
      </h3>
      {children}
    </motion.section>
  );
}

interface Props {
  analysis: AoiAnalysis;
  oni: OniFile | null;
  cf: CountriesFile | null;
  /** FIRMS country for intensity stats (null = world). Undefined = not available. */
  intensityFor: string | null | undefined;
  grid: GridFile | null; // Bangladesh high-detail grid when in BD scope
  bbox: BBox;
  ensoRank: EnsoRankRow[] | null;
  onCountry?: (name: string) => void;
  emissions?: EmissionsFile | null;
  /** country for emissions (null = world) */
  emissionsFor?: string | null;
}

const pv = (p: number) => (p < 0.001 ? "< 0.001" : `= ${p}`);
const tone = (t: { r: number; p: number }) => (t.p < 0.05 ? (t.r > 0 ? "text-nasa-red" : "text-signal") : undefined);

export function ScienceTab({ analysis, oni, cf, intensityFor, grid, bbox, ensoRank, onCountry, emissions, emissionsFor }: Props) {
  const em = useMemo(() => {
    if (!emissions || emissionsFor === undefined) return null;
    const rows = emissionsFor === null ? emissions.world.years : emissions.countries.find((c) => c.name === emissionsFor)?.years;
    if (!rows) return null;
    const f = emissions.fields;
    const ix = (k: string) => f.indexOf(k as never);
    const years = rows.map((r, i) => ({ year: emissions.firstYear + i, co2: r[ix("co2")], band: [r[ix("co2Lo")], r[ix("co2Hi")]] as [number, number], pm25: r[ix("pm25")], dm: r[ix("dm")] }));
    const last10 = years.slice(-10);
    const mean = (k: "co2" | "pm25" | "dm") => last10.reduce((s, y) => s + y[k], 0) / Math.max(last10.length, 1);
    const trend = mannKendall(years.filter((y) => y.year >= 2012).map((y) => y.co2));
    return { years, co2: mean("co2"), pm25: mean("pm25"), dm: mean("dm"), trend, name: emissionsFor ?? "World" };
  }, [emissions, emissionsFor]);
  const enso = useMemo(() => (oni ? ensoLink(analysis, oni) : null), [analysis, oni]);
  const inten = useMemo(() => (cf && intensityFor !== undefined ? intensity(cf, intensityFor) : null), [cf, intensityFor]);
  const regime = useMemo(() => (grid ? fireRegime(grid, bbox) : null), [grid, bbox]);
  let i = 0;

  return (
    <div className="space-y-6 pb-2">
      <p className="text-[12px] leading-relaxed text-slate-400">
        Three questions a fire scientist asks of this record: does the climate drive it, how intense are the fires, and how does the land burn over time? Every number is tested for statistical significance.
      </p>

      <Section icon={<Waves className="h-4 w-4" />} title="Climate link · El Niño / La Niña (NOAA ONI)" i={i++}>
        {!oni && <p className="text-[11.5px] text-slate-500">ONI index not loaded yet.</p>}
        {oni && !enso && <p className="text-[11.5px] text-slate-500">Too few complete fire seasons to test here.</p>}
        {enso && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={`Same season · ${enso.season}`} value={`r ${enso.concurrent.r}`} sub={`p ${pv(enso.concurrent.p)} · ${enso.concurrent.pctPerDegree > 0 ? "+" : ""}${enso.concurrent.pctPerDegree}%/°C`} tone={tone(enso.concurrent)} />
              <Stat label={`6-mo lead · ${enso.lead.window}`} value={`r ${enso.lead.r}`} sub={`p ${pv(enso.lead.p)} · ${enso.lead.pctPerDegree > 0 ? "+" : ""}${enso.lead.pctPerDegree}%/°C`} tone={tone(enso.lead)} />
              <Stat label="Verdict" value={<span className="text-[13px]">{enso.verdict}</span>} sub={enso.predictable ? "predictable months ahead" : `n = ${enso.n} seasons`} />
            </div>
            <div className="h-[170px]">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 10, left: -12, bottom: 4 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" dataKey="oni" name="ONI" tick={axis} tickLine={false} axisLine={false} domain={["dataMin - 0.2", "dataMax + 0.2"]} label={{ value: `${enso.best === "lead" ? "pre-season" : "same-season"} ONI (°C)`, fill: "#7b8494", fontSize: 10, position: "insideBottomRight", offset: -2 }} />
                  <YAxis type="number" dataKey="anomalyPct" name="Fire anomaly" unit="%" tick={axis} tickLine={false} axisLine={false} />
                  <ZAxis type="number" range={[60, 60]} />
                  <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                  <Tooltip {...tip} cursor={{ strokeDasharray: "3 3" }} formatter={(v: unknown, n?: unknown) => [String(v), String(n)]} labelFormatter={() => ""} />
                  <Scatter data={enso[enso.best].points} fill="#ff7a1a" stroke="#0c1016" strokeWidth={2} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] leading-snug text-slate-400">
              Each dot is one fire season: the Pacific's state ({enso.best === "lead" ? "in the six months before" : "during the season"}, x) against how far that season's burning departed from its long-term trend (y).{" "}
              {enso.predictable
                ? "The link already shows six months ahead, so ENSO forecasts give early warning here."
                : enso.p < 0.05
                  ? "The link is significant during the season but weak six months ahead: El Niño's arrival is the warning sign to watch."
                  : "No significant link: local factors (farming practice, local dryness) matter more here than the Pacific."}
            </p>
          </>
        )}
        {ensoRank && ensoRank.length > 0 && (
          <div>
            <div className="eyebrow mb-1.5 !text-[9px]">Countries whose fire seasons track ENSO most (p &lt; 0.05)</div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {ensoRank.slice(0, 10).map((c) => (
                <button key={c.name} onClick={() => onCountry?.(c.name)} className="flex items-center justify-between gap-2 rounded-[3px] px-2 py-1 text-left text-[11.5px] hover:bg-white/[0.05]">
                  <span className="truncate text-slate-200">{c.name}</span>
                  <span className={`shrink-0 font-mono text-[10.5px] ${c.r > 0 ? "text-orange-300" : "text-blue-300"}`}>
                    r={c.r} · {c.pctPerDegree > 0 ? "+" : ""}
                    {c.pctPerDegree}%/°C
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-1 font-mono text-[9.5px] text-slate-500">Orange: El Niño years burn more · Blue: La Niña years burn more</p>
          </div>
        )}
      </Section>

      {inten && (
        <Section icon={<Flame className="h-4 w-4" />} title={`Fire intensity & night burning · ${intensityFor ?? "World"} (VIIRS ${inten.years[0].year}–${inten.years[inten.years.length - 1].year})`} i={i++}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="FRP per fire-day" value={`${inten.meanFrp} MW`} sub={<TrendTag t={inten.frpTrend} unit=" MW" />} />
            <Stat label="Night-time detections" value={`${Math.round(inten.meanNight * 100)}%`} sub={<TrendTag t={{ ...inten.nightTrend, senSlope: Math.round(inten.nightTrend.senSlope * 1000) / 10 }} unit=" pp" />} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["frpPerFireDay", "FRP per fire-day (MW)", "#ff7a1a"],
                ["nightShare", "Night share", "#4d8eff"],
              ] as const
            ).map(([k, label, color]) => (
              <figure key={k}>
                <figcaption className="eyebrow mb-1 !text-[9px]">{label}</figcaption>
                <div className="h-[100px]">
                  <ResponsiveContainer>
                    <ComposedChart data={inten.years} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} interval={3} />
                      <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => (k === "nightShare" ? `${Math.round(v * 100)}%` : String(v))} domain={["auto", "auto"]} />
                      <Tooltip {...tip} formatter={(v: unknown) => [k === "nightShare" ? `${Math.round(Number(v) * 1000) / 10}%` : `${v} MW`, label]} />
                      <Line dataKey={k} stroke={color} strokeWidth={2} dot={false} animationDuration={500} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </figure>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-slate-400">
            Fire radiative power (FRP) is the heat a fire releases, measured by the satellite. Higher FRP per fire-day means hotter, fuel-rich fires (forests, peat). A large night share means fires that keep burning after dark, a sign of bigger or smouldering fires
            rather than quick daytime field burns.
          </p>
        </Section>
      )}

      {em && (
        <Section icon={<Wind className="h-4 w-4" />} title={`Fire emissions · ${em.name} (from fire radiative energy)`} i={i++}>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="CO₂ per year" value={`${fmt(Math.round(em.co2 * 10) / 10)} Tg`} sub="mean of the last 10 years" />
            <Stat label="PM2.5 per year" value={`${fmt(Math.round(em.pm25 * 1000))} Gg`} sub="fine smoke particles" />
            <Stat label="Biomass burned" value={`${fmt(Math.round(em.dm * 10) / 10)} Tg`} sub={<TrendTag t={{ ...em.trend, senSlope: Math.round(em.trend.senSlope * 10) / 10 }} unit=" Tg CO₂" />} />
          </div>
          <div className="h-[130px]">
            <ResponsiveContainer>
              <ComposedChart data={em.years} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} interval={3} />
                <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
                <Tooltip {...tip} formatter={(v: unknown, n?: unknown) => (Array.isArray(v) ? [`${fmt(v[0])} – ${fmt(v[1])} Tg`, "range"] : [`${fmt(Number(v))} Tg`, String(n)])} />
                <Area dataKey="band" name="range" stroke="none" fill="rgba(255,255,255,0.14)" isAnimationActive={false} />
                <Line dataKey="co2" name="CO₂" stroke="#ff7a1a" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] leading-snug text-slate-400">
            Fire radiative energy (heat released over the whole day, from the satellites' fire-power measurements and the daily fire cycle) × 0.368 kg of biomass per MJ, × emission factors. Shaded: range across biomes and harmonization uncertainty. Fires under clouds are not counted, so these
            are conservative. Method:{" "}
            <a href="/lab" className="text-signal hover:underline">
              Harmonization Lab
            </a>
            .
          </p>
        </Section>
      )}

      {regime && (
        <Section icon={<Atom className="h-4 w-4" />} title={`Fire regime · individual fires & re-burning (VIIRS ${regime.years[0]}–${regime.years[1]})`} i={i++}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Fires per year" value={fmt(regime.events.reduce((s, e) => s + e.count, 0) / Math.max(regime.events.length, 1))} sub={<TrendTag t={regime.countTrend} unit="" />} />
            <Stat label="Mean fire size" value={`${(regime.events.reduce((s, e) => s + e.meanKm2, 0) / Math.max(regime.events.length, 1)).toFixed(1)} km²`} sub={`largest ${fmt(Math.max(0, ...regime.events.map((e) => e.maxKm2)))} km²`} />
            <Stat label="Mean duration" value={`${(regime.events.reduce((s, e) => s + e.meanDays, 0) / Math.max(regime.events.length, 1)).toFixed(1)} d`} sub="first to last detection" />
            <Stat label="Burned footprint" value={`${fmt(regime.burnedKm2)} km²`} sub="~1 km cells burned at least once" />
            <Stat label="Re-burned" value={`${Math.round(regime.reburnedShare * 100)}%`} sub="of burned cells burned again" tone={regime.reburnedShare > 0.6 ? "text-nasa-red" : undefined} />
            <Stat label="Typical return" value={regime.medianInterval ? `${regime.medianInterval} yr` : "—"} sub="median years between burns" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <figure>
              <figcaption className="eyebrow mb-1 !text-[9px]">Individual fires per year</figcaption>
              <div className="h-[110px]">
                <ResponsiveContainer>
                  <ComposedChart data={regime.events} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} interval={3} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
                    <Tooltip {...tip} formatter={(v: unknown) => [fmt(Number(v)), "Fires"]} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="count" fill="#ff7a1a" radius={[4, 4, 0, 0]} animationDuration={500} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </figure>
            <figure>
              <figcaption className="eyebrow mb-1 !text-[9px]">Years between burns of the same ~1 km cell</figcaption>
              <div className="h-[110px]">
                <ResponsiveContainer>
                  <ComposedChart data={regime.intervalHist.map((v, k) => ({ label: INTERVAL_LABELS[k], v }))} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
                    <Tooltip {...tip} formatter={(v: unknown) => [fmt(Number(v)), "Re-burns"]} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="v" fill="#4d8eff" radius={[4, 4, 0, 0]} animationDuration={500} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </figure>
          </div>
          <p className="text-[11px] leading-snug text-slate-400">
            Fires are rebuilt by linking VIIRS fire-days that touch in space (~1 km) and time (±1 day), in the spirit of NASA's Global Fire Atlas. In the hills, most land re-burns within 1–2 years. That points to very short shifting-cultivation (jhum) fallow
            cycles, which leave soils little time to recover and raise erosion and landslide risk. Measured on ~1 km cells; VIIRS geolocation (~375 m) limits precision.
          </p>
        </Section>
      )}
      {!regime && grid === null && (
        <p className="text-[11px] text-slate-500">
          <Moon className="mr-1 inline h-3 w-3" />
          Individual-fire and re-burn analysis needs raw detections; it is computed for the Bangladesh high-detail record.
        </p>
      )}
    </div>
  );
}
