/**
 * OpenRouter provider for the FireCal Analyst, built for a tiny budget.
 *
 *  - Streams an OpenAI-compatible chat completion with tool calls, runs the
 *    same FireCal tools as the other analysts, and loops (max 4 rounds).
 *  - Tracks real spend from OpenRouter's usage accounting (usage.cost) in
 *    .firecal/spend.json and refuses to call the API once FIRECAL_BUDGET_USD
 *    is reached; the server then falls back to the free offline analyst.
 *
 * Env: OPENROUTER_API_KEY, OPENROUTER_MODEL, FIRECAL_BUDGET_USD,
 *      OPENROUTER_PRICE_IN / OPENROUTER_PRICE_OUT ($ per 1M tokens, used only
 *      if a response carries no cost), OPENROUTER_BASE_URL (tests).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { TOOLS, runTool, type ToolContext } from "./tools";

export const OPENROUTER = {
  key: process.env.OPENROUTER_API_KEY ?? "",
  model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5",
  base: (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, ""),
  budget: Number(process.env.FIRECAL_BUDGET_USD ?? 1.5),
  priceIn: Number(process.env.OPENROUTER_PRICE_IN ?? 1),
  priceOut: Number(process.env.OPENROUTER_PRICE_OUT ?? 5),
};

// ---------------------------------------------------------------------------
// Budget ledger
// ---------------------------------------------------------------------------
const LEDGER = process.env.FIRECAL_SPEND_FILE ?? ".firecal/spend.json";
interface Ledger {
  totalUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  since: string;
}
function readLedger(): Ledger {
  try {
    if (existsSync(LEDGER)) return JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch {
    /* corrupt ledger: start fresh rather than crash */
  }
  return { totalUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0, since: new Date().toISOString() };
}
let ledger = readLedger();
function recordUsage(u: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined) {
  const inTok = u?.prompt_tokens ?? 0;
  const outTok = u?.completion_tokens ?? 0;
  const cost = typeof u?.cost === "number" ? u.cost : (inTok * OPENROUTER.priceIn + outTok * OPENROUTER.priceOut) / 1e6;
  ledger = { ...ledger, totalUsd: ledger.totalUsd + cost, calls: ledger.calls + 1, inputTokens: ledger.inputTokens + inTok, outputTokens: ledger.outputTokens + outTok };
  try {
    mkdirSync(dirname(LEDGER), { recursive: true });
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  } catch (e) {
    console.warn("could not write spend ledger:", (e as Error).message);
  }
  return cost;
}
export function budgetStatus() {
  return { spentUsd: Math.round(ledger.totalUsd * 10000) / 10000, budgetUsd: OPENROUTER.budget, calls: ledger.calls, remainingUsd: Math.max(0, OPENROUTER.budget - ledger.totalUsd) };
}
export const withinBudget = () => ledger.totalUsd < OPENROUTER.budget;

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------
type ORMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

const ORTOOLS = TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.input_schema } }));

export class BudgetExceeded extends Error {}

interface RunArgs {
  system: string;
  grounding: string;
  task: string;
  history: { role: "user" | "assistant"; text: string }[];
  maxTokens: number;
  ctx: ToolContext;
  send: (d: object) => void;
  isClosed: () => boolean;
}

export async function runOpenRouter({ system, grounding, task, history, maxTokens, ctx, send, isClosed }: RunArgs) {
  const turns = [...history, { role: "user" as const, text: task }];
  while (turns[0]?.role === "assistant") turns.shift();
  const messages: ORMessage[] = [{ role: "system", content: system }];
  turns.forEach((t, i) => messages.push({ role: t.role, content: i === 0 ? `${grounding}\n\n${t.text}` : t.text } as ORMessage));

  let spent = 0;
  for (let round = 0; round < 4; round++) {
    if (isClosed()) return;
    if (!withinBudget()) throw new BudgetExceeded("budget reached");
    const res = await fetch(`${OPENROUTER.base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/sagoresarkerbdcse/nasa",
        "X-Title": "FireCal AI",
      },
      body: JSON.stringify({
        model: OPENROUTER.model,
        messages,
        tools: ORTOOLS,
        tool_choice: round === 3 ? "none" : "auto", // last round must answer
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.2,
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok || !res.body) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);

    let text = "";
    const calls: { id: string; name: string; args: string }[] = [];
    let usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // ": OPENROUTER PROCESSING" keep-alives
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk: {
          error?: { message?: string };
          usage?: typeof usage;
          choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(`OpenRouter: ${chunk.error.message ?? "stream error"}`);
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          if (!isClosed()) send({ type: "delta", text: delta.content });
        }
        for (const tc of delta?.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
        }
      }
    }
    spent += recordUsage(usage);

    const valid = calls.filter((c) => c && c.name);
    if (!valid.length) {
      send({ type: "usage", costUsd: Math.round(spent * 10000) / 10000, budget: budgetStatus() });
      return;
    }
    if (text) send({ type: "delta", text: "\n\n" });
    messages.push({ role: "assistant", content: text || null, tool_calls: valid.map((c, i) => ({ id: c.id || `call_${round}_${i}`, type: "function", function: { name: c.name, arguments: c.args || "{}" } })) });
    const results = await Promise.all(
      valid.map(async (c, i) => {
        let input: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(c.args || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed;
        } catch {
          /* handled below */
        }
        send({ type: "tool", name: c.name, input: input ?? {} });
        let content: string;
        if (!input) content = "INVALID_JSON: arguments must be a JSON object";
        else {
          try {
            content = JSON.stringify(await runTool(c.name, input, ctx));
          } catch (e) {
            content = `Tool failed: ${(e as Error).message}`;
          }
        }
        return { role: "tool" as const, tool_call_id: c.id || `call_${round}_${i}`, content };
      }),
    );
    messages.push(...results);
  }
  send({ type: "usage", costUsd: Math.round(spent * 10000) / 10000, budget: budgetStatus() });
}
