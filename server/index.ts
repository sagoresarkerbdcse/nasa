/**
 * FireCal API.
 *
 *   POST /api/analyst  { mode, question, bbox, regionName, focus?, history? }  → SSE
 *        events: delta (text), tool (a tool call), action (dashboard change), done
 *   GET  /api/live      last-7-days FIRMS fires (cached 15 min, snapshot fallback)
 *   GET  /api/health
 *
 * The analyst is a tool-using agent: Claude calls data tools that compute
 * answers from the harmonized record and `update_dashboard` to move the
 * user's map. Without credentials an offline analyst uses the same tools.
 */
import type { OniFile } from "../src/lib/science";
import type { EmissionsFile } from "../pipeline/harmonization-build";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchLive } from "../pipeline/live";
import type { BBox, GridFile, LiveFile } from "../src/lib/types";
import { analyzeCountry, pseudoMeta, summarizeCountries, type CountriesFile, type Grid1File } from "../src/lib/global";
import { buildGrounding, type Focus } from "./context";
import { offlineAgent } from "./offline";
import { BudgetExceeded, OPENROUTER, budgetStatus, runOpenRouter, withinBudget } from "./openrouter";
import { TOOLS, runTool, type DashboardAction, type ToolContext } from "./tools";

if (existsSync(".env")) process.loadEnvFile(".env"); // Node 21.7+

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.FIRECAL_MODEL ?? "claude-opus-5-5";
const PROD = process.env.NODE_ENV === "production";
const root = process.cwd();
const dataDir = [join(root, "public/data"), join(root, "dist/data")].find((d) => existsSync(join(d, "grid.json")));
if (!dataDir) throw new Error("grid.json not found. Run `npm run data:ingest` or `npm run data:sample` first.");
const grid: GridFile = JSON.parse(readFileSync(join(dataDir, "grid.json"), "utf8"));
// Global per-country record (optional; built by the "Build global FIRMS dataset" workflow).
const global = (() => {
  const c = join(dataDir, "global/countries.json");
  const g = join(dataDir, "global/grid1.json");
  if (!existsSync(c) || !existsSync(g)) return null;
  const cf = JSON.parse(readFileSync(c, "utf8")) as CountriesFile;
  return { cf, g1: JSON.parse(readFileSync(g, "utf8")) as Grid1File, summaries: summarizeCountries(cf) };
})();

const oni: OniFile | null = existsSync(join(dataDir, "oni.json")) ? JSON.parse(readFileSync(join(dataDir, "oni.json"), "utf8")) : null;
const emissions: EmissionsFile | null = existsSync(join(dataDir, "global/emissions.json")) ? JSON.parse(readFileSync(join(dataDir, "global/emissions.json"), "utf8")) : null;

// Provider: OpenRouter (low-cost, budget-capped) > Anthropic > offline analyst.
const PROVIDER: "openrouter" | "anthropic" | "offline" = OPENROUTER.key
  ? "openrouter"
  : process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.FIRECAL_LLM === "1"
    ? "anthropic"
    : "offline";
const LLM = PROVIDER !== "offline";
const client = PROVIDER === "anthropic" ? new Anthropic() : null;
const MODEL_LABEL = PROVIDER === "openrouter" ? OPENROUTER.model : PROVIDER === "anthropic" ? MODEL : null;
// Which modes may spend money. Auto-insights default to the free offline analyst.
const LLM_MODES = new Set((process.env.FIRECAL_LLM_MODES ?? "chat,brief").split(",").map((m) => m.trim()));

// Replays identical questions for free (demos repeat the same chips).
const answerCache = new Map<string, { at: number; events: object[] }>();
const CACHE_MS = 6 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Live feed: fetch FIRMS directly, cache 15 min, fall back to the committed snapshot.
// ---------------------------------------------------------------------------
type LiveEntry = { at: number; data: LiveFile; origin: "firms" | "snapshot" };
let liveCache: LiveEntry | null = null;
let liveInflight: Promise<LiveEntry | null> | null = null;
async function getLive() {
  if (liveCache && Date.now() - liveCache.at < 15 * 60 * 1000) return liveCache;
  liveInflight ??= (async (): Promise<LiveEntry | null> => {
    try {
      const data = await fetchLive(12000);
      if (data.sources.some((s) => s.ok)) return (liveCache = { at: Date.now(), data, origin: "firms" as const });
    } catch {
      /* fall through to snapshot */
    }
    const snap = join(dataDir!, "live.json");
    if (existsSync(snap)) return (liveCache = { at: Date.now(), data: JSON.parse(readFileSync(snap, "utf8")) as LiveFile, origin: "snapshot" as const });
    return liveCache;
  })().finally(() => (liveInflight = null));
  return liveInflight;
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------
const SYSTEM = `You are FireCal Analyst, the AI analyst inside FireCal AI. The dashboard harmonizes NASA MODIS (1 km, 2003→) and VIIRS (375 m, 2012→) active-fire detections into one consistent burning-activity record at two scales: a high-detail record for Bangladesh and its border fire belts (0.25° cells, live 7-day feed), and a global record for every country and the world (harmonized per country, 1° map cells, 2003-2024).

Your users are fire managers, early-warning officers, disaster responders, forest officials and scientists. Many read English as a second language. Write in plain, short sentences.

How to work:
- You have tools that compute statistics from the harmonized record, the hot-spot analysis, the season-timing analysis, the outlook model and the live NASA FIRMS feed. Call the tools you need, in parallel when they are independent, before answering. Every number you state must come from a tool result or the <fire_data> block. Never invent counts, dates, places or events.
- When your answer is about a specific place, time or layer, call update_dashboard so the user's map and panels show it while they read. Do this once per answer, choosing the single most useful view.
- If the data source is synthetic demo data, do not attribute anomalies to real-world events.
- For causes, offer hypotheses (dry spells, jhum shifting cultivation, crop-residue burning, ENSO years) and name the NASA dataset that could test them (GPM IMERG rainfall, SMAP soil moisture, MODIS/VIIRS burned area, MERRA-2 weather). Do not present hypotheses as findings.
- Explain terms briefly when first used: fire-days are unique ~1 km cells × days with a confident detection; harmonized means MODIS-era values are scaled by the calibration factor k; HCI is the 0-100 harmonized confidence index; anomalies compare with the same month in the previous 10 years.
- The outlook is statistical (past years only, no weather input); say so when you use it, and quote its hindcast skill.
- Distinguish "statistically significant" from "operationally important".

Formatting: Markdown with **bold** key numbers, short bullets, at most a few short paragraphs. No tables.`;

const MODE_INSTRUCTIONS = {
  chat: "Answer the user's question in under 200 words.",
  insight:
    "Write an insight card about the FOCUS MONTH: a one-line bold headline, then exactly two short paragraphs (under 150 words total). Paragraph 1: what happened (harmonized value, baseline, % change, z-score). Paragraph 2: sensor basis (MODIS vs VIIRS counts, HCI), plausible drivers as hypotheses, and what a responder should take from it. Use get_monthly_series if you need more context; do not call update_dashboard (the UI already shows the month).",
  brief:
    "Write a responder early-warning brief. Call get_area_overview, get_outlook, get_hotspot_trends and get_live_fires first (in parallel). Then write Markdown with these sections: '# Early-Warning Brief: <area>', '## Situation', '## Live: last 7 days', '## Outlook: next 3 months' (expected range and hindcast skill), '## Hot-spot trends' (persistent/intensifying cells with coordinates), '## Recommended actions' (3-5 concrete, prioritized bullets). Under 380 words. Do not call update_dashboard.",
} as const;
type Mode = keyof typeof MODE_INSTRUCTIONS;

interface AnalystRequest {
  mode: Mode;
  question?: string;
  bbox: BBox;
  regionName?: string;
  focus?: Focus;
  history?: { role: "user" | "assistant"; content: string }[];
  scope?: { kind: string; country: string };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    llm: LLM && (PROVIDER !== "openrouter" || withinBudget()),
    provider: PROVIDER,
    model: MODEL_LABEL,
    budget: PROVIDER === "openrouter" ? budgetStatus() : null,
    llmModes: [...LLM_MODES],
    dataSource: grid.meta.source,
    global: global ? { countries: global.cf.countries.length, record: `${global.cf.meta.firstYear}-${global.cf.meta.lastYear}` } : null,
    record: `${grid.meta.firstYear}-${grid.meta.lastYear}`,
  });
});

app.get("/api/live", async (_req, res) => {
  const live = await getLive();
  if (!live) {
    res.status(503).json({ error: "Live feed unavailable" });
    return;
  }
  res.setHeader("X-Live-Origin", live.origin);
  res.json({ ...live.data, origin: live.origin });
});

app.post("/api/analyst", async (req, res) => {
  const body = req.body as AnalystRequest;
  if (!Array.isArray(body?.bbox) || body.bbox.length !== 4 || !body.bbox.every(Number.isFinite) || !(body.mode in MODE_INSTRUCTIONS)) {
    res.status(400).json({ error: "bbox [minLon,minLat,maxLon,maxLat] and mode are required" });
    return;
  }
  const regionName = String(body.regionName ?? "Custom area").slice(0, 80);
  const question = String(body.question ?? "").slice(0, 2000);
  // Country / world scope uses the global record; otherwise the Bangladesh high-detail grid.
  const scopeCountry = global && body.scope?.country ? (body.scope.country === "World" ? "World" : global.cf.countries.find((c) => c.name === body.scope!.country)?.name) : undefined;
  const groundOpts = scopeCountry
    ? { analysis: analyzeCountry(global!.cf, scopeCountry === "World" ? null : scopeCountry), meta: pseudoMeta(global!.cf, regionName), scale: "country-level harmonized series (global FIRMS all-countries archive); map cells are 1°" }
    : {};
  const grounding = buildGrounding(grid, body.bbox, regionName, groundOpts);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const cacheKey = JSON.stringify([body.mode, question.trim().toLowerCase(), body.bbox, body.focus ?? null, (body.history ?? []).length]);
  const cached = answerCache.get(cacheKey);
  const recorded: object[] = [];
  const send = (data: object) => {
    recorded.push(data);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  if (cached && Date.now() - cached.at < CACHE_MS) {
    for (const e of cached.events) {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
      await new Promise((r) => setTimeout(r, 8));
    }
    res.end();
    return;
  }
  let closed = false;
  res.on("close", () => (closed = true));

  const ctx: ToolContext = {
    grid,
    global,
    getLive: async () => (await getLive())?.data ?? null,
    oni,
    emissions,
    current: { bbox: body.bbox, name: regionName, ...(scopeCountry ? { country: scopeCountry } : {}) },
    emit: (action: DashboardAction) => send({ type: "action", action }),
  };

  const offline = async (note?: string) => {
    if (note) send({ type: "delta", text: `_${note}_\n\n` });
    await offlineAgent({ grounding, mode: body.mode, question, focus: body.focus, ctx, send, isClosed: () => closed });
    send({ type: "done", source: "offline" });
  };
  const remember = () => {
    if (!closed) answerCache.set(cacheKey, { at: Date.now(), events: recorded });
  };

  if (!LLM || !LLM_MODES.has(body.mode)) {
    await offline();
    res.end();
    return;
  }

  if (PROVIDER === "openrouter") {
    if (!withinBudget()) {
      await offline(`AI budget of $${OPENROUTER.budget} reached, so the free offline analyst is answering.`);
      res.end();
      return;
    }
    const lean = buildGrounding(grid, body.bbox, regionName, { ...groundOpts, table: false });
    const focusLineOR = body.focus ? `\nFOCUS MONTH: ${body.focus.year}-${String(body.focus.month).padStart(2, "0")}` : "";
    const taskOR = body.mode === "chat" ? question || "Give me an overview of this area." : body.mode === "insight" ? "Explain the focus month." : "Generate the early-warning brief.";
    try {
      await runOpenRouter({
        system: `${SYSTEM}\n\n${MODE_INSTRUCTIONS[body.mode]}${focusLineOR}`,
        grounding: lean.text,
        task: taskOR,
        history: (body.history ?? []).slice(-6).filter((h) => (h.role === "user" || h.role === "assistant") && h.content?.trim()).map((h) => ({ role: h.role, text: h.content.slice(0, 3000) })),
        maxTokens: body.mode === "brief" ? 1400 : 900,
        ctx,
        send,
        isClosed: () => closed,
      });
      send({ type: "done", source: "openrouter", model: OPENROUTER.model });
      remember();
    } catch (err) {
      console.error("openrouter error:", (err as Error).message);
      await offline(err instanceof BudgetExceeded ? `AI budget of $${OPENROUTER.budget} reached, so the free offline analyst is answering.` : "The AI model is unavailable right now, so the offline analyst is answering.");
    }
    res.end();
    return;
  }
  if (!client) return;

  const focusLine = body.focus ? `\nFOCUS MONTH: ${body.focus.year}-${String(body.focus.month).padStart(2, "0")}` : "";
  const task = body.mode === "chat" ? question || "Give me an overview of this area." : body.mode === "insight" ? "Explain the focus month." : "Generate the early-warning brief.";

  // Prior chat turns + this one; the grounding block leads the first user turn so it
  // stays a stable, cacheable prefix across follow-ups.
  type Msg = Anthropic.Beta.BetaMessageParam;
  const turns = [...(body.history ?? []).slice(-8), { role: "user" as const, content: task }]
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .map((t) => ({ role: t.role, text: t.content.slice(0, 6000) }));
  while (turns[0]?.role === "assistant") turns.shift();
  const messages: Msg[] = [];
  for (const t of turns) {
    const prev = messages[messages.length - 1];
    if (prev?.role === t.role) (prev.content as Anthropic.Beta.BetaTextBlockParam[]).push({ type: "text", text: t.text });
    else messages.push({ role: t.role, content: [{ type: "text", text: t.text }] });
  }
  (messages[0].content as Anthropic.Beta.BetaTextBlockParam[]).unshift({ type: "text", text: grounding.text });

  const tools = TOOLS.map((t) => ({ ...t, eager_input_streaming: true }));
  try {
    let jsonRetries = 0;
    for (let step = 0; step < 8 && !closed; step++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        system: `${SYSTEM}\n\n${MODE_INSTRUCTIONS[body.mode]}${focusLine}`,
        messages,
        tools,
        cache_control: { type: "ephemeral" },
        output_config: { effort: body.mode === "brief" ? "medium" : "low" },
        // Server-side fallback if a safety classifier declines (e.g. wildfire wording).
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      stream.on("text", (t) => !closed && send({ type: "delta", text: t }));
      let final: Anthropic.Beta.BetaMessage;
      try {
        final = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // A tool input that could not be parsed at all: re-issue the turn (bounded).
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        continue;
      }
      if (final.stop_reason === "refusal") {
        send({ type: "delta", text: "\n\n_The analyst declined this request. Try rephrasing it._" });
        break;
      }
      const uses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (final.stop_reason !== "tool_use" || !uses.length) {
        send({ type: "done", source: "claude", model: final.model });
        remember();
        res.end();
        return;
      }
      if (final.stop_reason === "tool_use" && final.content.some((b) => b.type === "text")) send({ type: "delta", text: "\n\n" });
      messages.push({ role: "assistant", content: final.content });
      const results = await Promise.all(
        uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const input = u.input && typeof u.input === "object" && !Array.isArray(u.input) ? (u.input as Record<string, unknown>) : null;
          send({ type: "tool", name: u.name, input: input ?? {} });
          if (!input) return { type: "tool_result", tool_use_id: u.id, content: "INVALID_JSON: input must be an object", is_error: true };
          try {
            const out = await runTool(u.name, input, ctx);
            return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) };
          } catch (e) {
            return { type: "tool_result", tool_use_id: u.id, content: `Tool failed: ${(e as Error).message}`, is_error: true };
          }
        }),
      );
      messages.push({ role: "user", content: results });
    }
    send({ type: "done", source: "claude" });
  } catch (err) {
    console.error("analyst error:", err);
    send({ type: "delta", text: "\n\n_Claude is unavailable right now, so this answer comes from the offline analyst._\n\n" });
    await offlineAgent({ grounding, mode: body.mode, question, focus: body.focus, ctx, send, isClosed: () => closed });
    send({ type: "done", source: "offline" });
  }
  res.end();
});

if (PROD) {
  const dist = join(root, "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

app.listen(PORT, () => {
  const b = budgetStatus();
  console.log(
    `FireCal API on http://localhost:${PORT} — analyst: ${PROVIDER === "openrouter" ? `OpenRouter ${OPENROUTER.model} (spent $${b.spentUsd.toFixed(4)} of $${b.budgetUsd})` : PROVIDER === "anthropic" ? MODEL : "offline (set OPENROUTER_API_KEY for the AI analyst)"}; data: ${grid.meta.source}`,
  );
});
