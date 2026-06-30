const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${BASE}/api${path}`;
}

export type ChatMessage = { role: "user" | "assistant" | "tool"; content: string; tool_call_id?: string };

// ── Classic endpoint ──────────────────────────────────────────────────────────

export async function askAgents(
  question: string,
  report: unknown,
  history: ChatMessage[],
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch(apiUrl("/agents/ask"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, report, history }),
  });

  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(t.slice(6));
        if (json.content) onChunk(json.content);
        if (json.done) return;
        if (json.error) throw new Error(json.error);
      } catch {
        // skip
      }
    }
  }
}

// ── MCP-aware endpoint ───────────────────────────────────────────────────────

export type McpStreamEvent =
  | { type: "content"; content: string }
  | { type: "tool_start"; tool: string }
  | { type: "tool_result"; tool: string; content: string }
  | { type: "done" }
  | { type: "error"; error: string };

export async function askAgentsMcp(
  question: string,
  history: ChatMessage[],
  onEvent: (event: McpStreamEvent) => void,
): Promise<void> {
  const res = await fetch(apiUrl("/agents/ask-mcp"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
  });

  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(t.slice(6));
        if (json.tool_start) onEvent({ type: "tool_start", tool: json.tool_start });
        else if (json.tool_result) onEvent({ type: "tool_result", tool: json.tool_result, content: json.content });
        else if (json.content) onEvent({ type: "content", content: json.content });
        else if (json.done) onEvent({ type: "done" });
        else if (json.error) onEvent({ type: "error", error: json.error });
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}

// ── Pipeline endpoint ────────────────────────────────────────────────────────

export type PipelineEvent =
  | { agent: string; type: "start" }
  | { agent: string; type: "delta"; content: string }
  | { agent: string; type: "done" }
  | { agent: string; type: "error"; content: string }
  | { type: "pipeline_done" };

export async function runAgentPipeline(
  report: unknown,
  onEvent: (event: PipelineEvent) => void,
): Promise<void> {
  const res = await fetch(apiUrl("/agents/pipeline"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report }),
  });

  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(t.slice(6));
        onEvent(json as PipelineEvent);
      } catch {
        // skip
      }
    }
  }
}
