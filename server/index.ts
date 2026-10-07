/**
 * FireCal API: serves the grounded "FireCal Analyst" over Server-Sent Events
 * and, in production, the built frontend.
 *
 *   POST /api/analyst  { mode, question, bbox, regionName, focus?, history? }
 *   GET  /api/health
 */
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BBox, GridFile } from "../src/lib/types";
import { buildGrounding, type Focus } from "./context";
import { offlineAnswer } from "./offline";

if (existsSync(".env")) process.loadEnvFile(".env"); // Node 21.7+

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.FIRECAL_MODEL ?? "claude-opus-5-5";
const PROD = process.env.NODE_ENV === "production";
const root = process.cwd();
const gridPath = [join(root, "public/data/grid.json"), join(root, "dist/data/grid.json")].find(existsSync);
if (!gridPath) throw new Error("grid.json not found. Run `npm run data:sample` first.");
const grid: GridFile = JSON.parse(readFileSync(gridPath, "utf8"));

const LLM = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.FIRECAL_LLM === "1");
const client = LLM ? new Anthropic() : null;

const SYSTEM = `You are FireCal Analyst, the AI assistant inside FireCal AI, a dashboard that harmonizes NASA MODIS (1 km, 2000→) and VIIRS (375 m, 2012→) active-fire hotspots into one consistent burning-activity calendar for Bangladesh and its border regions.

Your users are fire managers, early-warning officers, disaster responders, forest officials and scientists. Many read English as a second language. Write in plain, short sentences.

Grounding rules:
- Each request includes a <fire_data> block with the statistics for the user's selected area. Base every number you state on that block. Never invent counts, dates, places or events.
- If the data source is synthetic demo data, do not attribute anomalies to real-world events. You may suggest the kinds of drivers that typically cause such patterns (dry spells, jhum or crop-residue burning, El Niño years), framed as hypotheses to check.
- If the block cannot answer the question, say what is missing and suggest which NASA dataset would help (e.g. GPM IMERG rainfall, SMAP soil moisture, MODIS/VIIRS burned area, ERA5 or MERRA-2 weather).
- Explain technical terms briefly: "fire-days" are unique ~1 km grid cells × days with a confident detection; "harmonized" means MODIS-era values are scaled by the calibration factor k so all years are comparable; "HCI" is the Harmonized Confidence Index (0-100) built from detection confidence, MODIS/VIIRS agreement and sample size; z-scores and % compare with the same month over the previous 10 years.
- Distinguish "significant" (statistical) from "important" (operational).

Formatting: use Markdown with **bold** key numbers, short bullet lists and at most a few short paragraphs. Do not use tables.`;

const MODE_INSTRUCTIONS = {
  chat: "Answer the user's question in under 180 words.",
  insight:
    "Write an insight card about the focus month: exactly two short paragraphs (under 140 words total). Paragraph 1: what happened, with the harmonized value, baseline, % change, z-score and how unusual it is. Paragraph 2: the sensor basis (MODIS vs VIIRS counts, HCI), plausible drivers as hypotheses, and what a responder should take from it. Start with a one-line bold headline.",
  brief:
    "Write a responder early-warning brief in Markdown with these sections: '# Early-Warning Brief: <area>', '## Situation', '## Outlook: next 60 days' (use the OUTLOOK MONTHS and climatology), '## Recent anomalies' (last 3 years), '## Watch locations' (use RECURRING HOT CELLS with coordinates), '## Recommended actions' (3-5 concrete, prioritized bullets). Under 350 words.",
} as const;

type Mode = keyof typeof MODE_INSTRUCTIONS;

interface AnalystRequest {
  mode: Mode;
  question?: string;
  bbox: BBox;
  regionName?: string;
  focus?: Focus;
  history?: { role: "user" | "assistant"; content: string }[];
}

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ llm: LLM, model: LLM ? MODEL : null, dataSource: grid.meta.source, record: `${grid.meta.firstYear}-${grid.meta.lastYear}` });
});

app.post("/api/analyst", async (req, res) => {
  const body = req.body as AnalystRequest;
  if (!Array.isArray(body?.bbox) || body.bbox.length !== 4 || !body.bbox.every(Number.isFinite) || !(body.mode in MODE_INSTRUCTIONS)) {
    res.status(400).json({ error: "bbox [minLon,minLat,maxLon,maxLat] and mode are required" });
    return;
  }
  const regionName = String(body.regionName ?? "Custom area").slice(0, 80);
  const question = String(body.question ?? "").slice(0, 2000);
  const grounding = buildGrounding(grid, body.bbox, regionName);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  let closed = false;
  res.on("close", () => (closed = true));

  if (!client) {
    await streamOffline(offlineAnswer(grounding, body.mode, question, body.focus), send, () => closed);
    send({ type: "done", source: "offline" });
    res.end();
    return;
  }

  const focusLine = body.focus ? `\nFOCUS MONTH: ${body.focus.year}-${String(body.focus.month).padStart(2, "0")}` : "";
  const task =
    body.mode === "chat" ? question || "Give me an overview of this area." : body.mode === "insight" ? "Explain the focus month." : "Generate the early-warning brief.";
  // Prior turns + this one; the grounding block leads the first user turn so it
  // stays a stable, cacheable prefix across follow-ups.
  type Msg = Anthropic.Beta.BetaMessageParam;
  const turns = [...(body.history ?? []).slice(-8), { role: "user" as const, content: task }]
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .map((t) => ({ role: t.role, text: t.content.slice(0, 6000) }));
  while (turns[0]?.role === "assistant") turns.shift();
  const merged: Msg[] = [];
  for (const t of turns) {
    const prev = merged[merged.length - 1];
    if (prev?.role === t.role) (prev.content as Anthropic.Beta.BetaTextBlockParam[]).push({ type: "text", text: t.text });
    else merged.push({ role: t.role, content: [{ type: "text", text: t.text }] });
  }
  (merged[0].content as Anthropic.Beta.BetaTextBlockParam[]).unshift({ type: "text", text: grounding.text });

  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: `${SYSTEM}\n\n${MODE_INSTRUCTIONS[body.mode]}${focusLine}`,
      messages: merged,
      cache_control: { type: "ephemeral" },
      output_config: { effort: body.mode === "brief" ? "medium" : "low" },
      // Server-side fallback if a safety classifier declines (e.g. on wildfire wording).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    for await (const event of stream) {
      if (closed) {
        stream.abort();
        return;
      }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") send({ type: "delta", text: event.delta.text });
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") send({ type: "delta", text: "\n\n_The analyst declined this request. Try rephrasing it._" });
    send({ type: "done", source: "claude", model: final.model, usage: final.usage });
  } catch (err) {
    console.error("analyst error:", err);
    // Degrade gracefully so the demo never dead-ends.
    send({ type: "delta", text: "_Claude is unavailable right now, so this answer comes from the offline analyst._\n\n" });
    await streamOffline(offlineAnswer(grounding, body.mode, question, body.focus), send, () => closed);
    send({ type: "done", source: "offline" });
  }
  res.end();
});

async function streamOffline(text: string, send: (d: object) => void, isClosed: () => boolean) {
  const parts = text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < parts.length; i += 3) {
    if (isClosed()) return;
    send({ type: "delta", text: parts.slice(i, i + 3).join("") });
    await new Promise((r) => setTimeout(r, 18));
  }
}

if (PROD) {
  const dist = join(root, "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`FireCal API on http://localhost:${PORT} — analyst: ${LLM ? MODEL : "offline (set ANTHROPIC_API_KEY for Claude)"}; data: ${grid.meta.source}`);
});
