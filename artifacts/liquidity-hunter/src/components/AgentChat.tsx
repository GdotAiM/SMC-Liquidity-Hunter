import { useState, useRef, useEffect } from "react";
import { Send, Loader2, MessageSquare, Wrench, ToggleLeft, ToggleRight } from "lucide-react";
import { askAgents, askAgentsMcp, type ChatMessage, type McpStreamEvent } from "@/lib/api";
import type { SmcReport } from "@workspace/api-client-react";

const SUGGESTED = [
  "Why is the draw bearish?",
  "Where is the strongest liquidity pool?",
  "Which FVG is most important?",
  "Is HTF aligned with LTF?",
  "What invalidates this setup?",
  "Where do institutions likely have orders?",
];

type ToolCallEvent = { type: "tool"; name: string; result?: string };

type Props = { report: SmcReport };

export function AgentChat({ report }: Props) {
  const [useMcp, setUseMcp] = useState(true);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolCallEvent[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, streamingText]);

  async function handleSend(q?: string) {
    const question = (q ?? input).trim();
    if (!question || streaming) return;
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: question };
    setHistory(h => [...h, userMsg]);
    setStreaming(true);
    setStreamingText("");
    setToolEvents([]);
    setActiveTool(null);

    if (useMcp) {
      // ── MCP mode: tool-calling agent ────────────────────────────────
      const localTools: ToolCallEvent[] = [];
      let accumulated = "";
      try {
        await askAgentsMcp(question, history.filter(m => m.role !== "tool"), (event: McpStreamEvent) => {
          switch (event.type) {
            case "tool_start":
              setActiveTool(event.tool);
              localTools.push({ type: "tool", name: event.tool });
              setToolEvents([...localTools]);
              break;
            case "tool_result":
              setActiveTool(null);
              // Update the last tool entry with result (first 200 chars)
              const last = localTools[localTools.length - 1];
              if (last) last.result = event.content;
              setToolEvents([...localTools]);
              break;
            case "content":
              accumulated += event.content;
              setStreamingText(accumulated);
              break;
            case "done":
              break;
            case "error":
              throw new Error(event.error);
          }
        });
        // Build tool history for context
        const toolMsgs: ChatMessage[] = localTools.map(t => ({
          role: "tool" as const,
          content: t.result ?? "",
          tool_call_id: t.name,
        }));
        setHistory(h => [...h, ...toolMsgs, { role: "assistant", content: accumulated }]);
      } catch (err) {
        setHistory(h => [...h, { role: "assistant", content: "⚠️ Unable to reach the AI agent. Please try again." }]);
      } finally {
        setStreaming(false);
        setStreamingText("");
        setActiveTool(null);
        inputRef.current?.focus();
      }
    } else {
      // ── Classic mode: full report in prompt ─────────────────────────
      let accumulated = "";
      try {
        await askAgents(question, report, history, (chunk) => {
          accumulated += chunk;
          setStreamingText(accumulated);
        });
        setHistory(h => [...h, { role: "assistant", content: accumulated }]);
      } catch (err) {
        setHistory(h => [...h, { role: "assistant", content: "⚠️ Unable to reach the AI agent. Please try again." }]);
      } finally {
        setStreaming(false);
        setStreamingText("");
        inputRef.current?.focus();
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <MessageSquare className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ask the Agents</span>
        <div className="flex-1" />
        <button
          onClick={() => setUseMcp(m => !m)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title={useMcp ? "MCP tool-calling mode (on) — click for classic mode" : "Classic prompt mode (off) — click for MCP mode"}
        >
          {useMcp ? <ToggleRight className="w-4 h-4 text-primary" /> : <ToggleLeft className="w-4 h-4" />}
          <span className={useMcp ? "text-primary font-semibold" : ""}>MCP</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {history.length === 0 && !streaming && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Ask any question about the current market context:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map(q => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-[11px] bg-muted hover:bg-accent border border-border rounded-sm px-2 py-1 text-left text-muted-foreground hover:text-foreground transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.filter(m => m.role !== "tool").map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-sm px-3 py-2 text-xs leading-relaxed ${
              msg.role === "user"
                ? "bg-primary/20 text-foreground border border-primary/30"
                : "bg-muted text-foreground border border-border"
            }`}>
              {msg.role === "assistant" && (
                <p className="text-[10px] text-primary font-semibold uppercase tracking-wider mb-1">Agent</p>
              )}
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {/* Tool call cards */}
        {useMcp && toolEvents.map((te, i) => (
          <div key={`tool-${i}`} className="flex justify-start">
            <div className="max-w-[85%] rounded-sm border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5 mb-1">
                <Wrench className="w-3 h-3 text-primary" />
                <span className="text-[10px] text-primary font-semibold uppercase tracking-wider">{te.name}</span>
                {!te.result && activeTool === te.name && (
                  <Loader2 className="w-3 h-3 animate-spin text-primary/70" />
                )}
                {te.result && (
                  <span className="text-[9px] text-emerald-400 font-medium ml-auto">done</span>
                )}
              </div>
              {te.result && (
                <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap break-all line-clamp-3">
                  {te.result.length > 200 ? te.result.slice(0, 200) + "..." : te.result}
                </p>
              )}
            </div>
          </div>
        ))}

        {/* Active tool indicator (when running but not yet in toolEvents) */}
        {useMcp && streaming && activeTool && toolEvents.length === 0 && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-sm border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Wrench className="w-3 h-3 text-primary" />
                <span className="text-[10px] text-primary font-semibold uppercase tracking-wider">{activeTool}</span>
                <Loader2 className="w-3 h-3 animate-spin text-primary/70 ml-1" />
              </div>
            </div>
          </div>
        )}

        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-sm px-3 py-2 text-xs leading-relaxed bg-muted text-foreground border border-border">
              <p className="text-[10px] text-primary font-semibold uppercase tracking-wider mb-1">Agent</p>
              {streamingText ? (
                <p className="whitespace-pre-wrap">{streamingText}<span className="inline-block w-1.5 h-3.5 bg-primary/70 animate-pulse ml-0.5 align-middle" /></p>
              ) : (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Reasoning…</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-2 flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Ask the agents…"
          disabled={streaming}
          className="flex-1 bg-muted border border-border rounded-sm px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || streaming}
          className="bg-primary text-primary-foreground rounded-sm px-3 py-1.5 disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
