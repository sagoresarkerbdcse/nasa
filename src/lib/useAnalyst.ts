import { useCallback, useRef, useState } from "react";
import type { BBox } from "./types";

export type AnalystMode = "chat" | "insight" | "brief";

export interface AnalystMessage {
  id: number;
  role: "user" | "assistant";
  kind: AnalystMode;
  content: string;
  streaming?: boolean;
  source?: "claude" | "offline" | "openrouter";
  tools?: { name: string; input: Record<string, unknown> }[];
  costUsd?: number;
  focus?: { year: number; month: number };
  regionName?: string;
}

interface Request {
  mode: AnalystMode;
  question?: string;
  bbox: BBox;
  regionName: string;
  focus?: { year: number; month: number };
  /** Country or world scope (omitted for the Bangladesh high-detail record). */
  scope?: { kind: string; country: string };
}

let nextId = 1;

export interface AnalystBudget {
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
}

export function useAnalyst(onAction?: (action: Record<string, unknown>) => void) {
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const [budget, setBudget] = useState<AnalystBudget | null>(null);
  const [messages, setMessages] = useState<AnalystMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const ask = useCallback(async (req: Request, userLabel?: string): Promise<string> => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Conversation history = prior chat turns only (insights/briefs are standalone).
    const history = messagesRef.current
      .filter((m) => m.kind === "chat" && !m.streaming && m.content)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    const assistantId = nextId++;
    setMessages((prev) => [
      ...prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      ...(userLabel ? [{ id: nextId++, role: "user" as const, kind: req.mode, content: userLabel }] : []),
      { id: assistantId, role: "assistant", kind: req.mode, content: "", streaming: true, focus: req.focus, regionName: req.regionName },
    ]);
    setBusy(true);

    let text = "";
    const patch = (p: Partial<AnalystMessage>) => setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...p } : m)));
    try {
      const res = await fetch("/api/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...req, history: req.mode === "chat" ? history : [] }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = chunk.replace(/^data: ?/gm, "");
          if (!data) continue;
          const evt = JSON.parse(data);
          if (evt.type === "delta") {
            text += evt.text;
            patch({ content: text });
          } else if (evt.type === "done") {
            patch({ source: evt.source });
          } else if (evt.type === "tool") {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, tools: [...(m.tools ?? []), { name: evt.name, input: evt.input ?? {} }] } : m)));
          } else if (evt.type === "action") {
            actionRef.current?.(evt.action);
          } else if (evt.type === "usage") {
            patch({ costUsd: evt.costUsd });
            if (evt.budget) setBudget(evt.budget);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        patch({ streaming: false });
        return text;
      }
      text ||= "_Could not reach the FireCal API. Is the server running (`npm run dev`)?_";
      patch({ content: text });
    } finally {
      if (abortRef.current === ctrl) {
        setBusy(false);
        abortRef.current = null;
      }
      patch({ streaming: false });
    }
    return text;
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, busy, ask, clear, budget };
}
