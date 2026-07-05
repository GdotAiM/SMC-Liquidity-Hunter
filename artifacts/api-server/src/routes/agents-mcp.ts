/**
 * MCP-Aware AI Agent Endpoint
 *
 * POST /api/agents/ask-mcp
 *
 * Instead of injecting a 3K-token system prompt with pre-computed SmcReport data,
 * this endpoint gives the AI a minimal system prompt (~200 tokens) and a list of
 * MCP tools. The AI decides which tools to call, gets live data on demand, and
 * can chain multiple tool calls for iterative reasoning.
 *
 * Token savings: ~15× for simple queries, ~5× for complex analyses.
 */

import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { toolRegistry } from "../lib/mcp/tool-registry.js";
import { logger } from "../lib/logger.js";
import { resolveLlmConfig } from "../lib/llm/provider.js";

const router: IRouter = Router();

// ── System prompt builder (includes dashboard context when available) ────────

function buildMcpSystemPrompt(context?: { symbol?: string; timeframe?: string; currentPrice?: number }): string {
  let prompt = `You are an expert SMC (Smart Money Concepts) and ICT analyst with access to live market analysis tools.

CRITICAL RULES:
1. CALL TOOLS FIRST — do not explain what you're planning to do, just do it. Call the tools immediately, then synthesize the results into your response.
2. If a tool returns insufficient data (e.g. not enough candles), immediately try another timeframe or tool without narrating the fallback plan.
3. When you need multiple data points (bias + liquidity + targets), call all needed tools in a single parallel batch.
4. Only describe your approach AFTER you have the data, as part of your final synthesis.

Available tools:
- analyze_structure: Market structure (pivots, BOS/CHoCH, bias, phase)
- analyze_liquidity: Liquidity pools (BSL/SSL with sweep probability)
- analyze_order_blocks: Order blocks and breaker blocks
- analyze_fvg: Fair value gaps (unfilled gaps, inversions)
- analyze_pd_array: Premium/discount/equilibrium zones
- get_daily_bias: Higher-timeframe daily bias
- detect_smt: SMT divergence between correlated symbols
- get_draw_targets: Ranked draw-on-liquidity targets
- build_full_report: Complete SMC report (all 8 dimensions)
- get_live_candles: Raw OHLCV candles from real-time feed
- scan_all_timeframes: Multi-timeframe cascade (M1→W1)`;

  if (context?.symbol) {
    const parts = [`\n\nDASHBOARD CONTEXT (the user is currently viewing this market):`];
    parts.push(`- Symbol: ${context.symbol}`);
    if (context.timeframe) parts.push(`- Timeframe: ${context.timeframe}`);
    if (context.currentPrice != null) parts.push(`- Current Price: ${context.currentPrice}`);
    parts.push(`\nIf the user asks a question without specifying a symbol or timeframe, DEFAULT to the dashboard context above. For example, if they ask "where are institutions likely sitting?", they mean ${context.symbol} on the ${context.timeframe ?? "current"} timeframe.`);
    prompt += parts.join("\n");
  }

  prompt += `\n\nAlways cite specific price levels from tool results. Do not give financial advice or buy/sell signals. Synthesize in 3-6 sentences — don't list every number from every tool, highlight only the most actionable findings.`;
  return prompt;
}

// ── Tool definitions (OpenAI function-calling format) ─────────────────────────

const MCP_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "analyze_structure",
      description: "Analyze ICT market structure: pivots, BOS/CHoCH breaks, trend, bias, confidence, market phase.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol, e.g. BTCUSDT or EURUSD=X" },
          timeframe: { type: "string", enum: ["1m","5m","15m","1h","4h","1d","1w"] },
        },
        required: ["symbol", "timeframe"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "analyze_liquidity",
      description: "Scan liquidity pools: BSL, SSL, EQH, EQL with sweep probability.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol" },
          timeframe: { type: "string", enum: ["1m","5m","15m","1h","4h","1d","1w"] },
        },
        required: ["symbol", "timeframe"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "analyze_order_blocks",
      description: "Detect order blocks and breaker blocks with confidence scoring.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol" },
          timeframe: { type: "string", enum: ["1m","5m","15m","1h","4h","1d","1w"] },
        },
        required: ["symbol", "timeframe"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "analyze_fvg",
      description: "Detect fair value gaps with fill fraction and inversion tracking.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol" },
          timeframe: { type: "string", enum: ["1m","5m","15m","1h","4h","1d","1w"] },
        },
        required: ["symbol", "timeframe"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "analyze_pd_array",
      description: "Analyze premium/discount array: dealing range, equilibrium, PD zones.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol" },
          timeframe: { type: "string", enum: ["1m","5m","15m","1h","4h","1d","1w"] },
        },
        required: ["symbol", "timeframe"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_daily_bias",
      description: "Compute higher-timeframe (1D) bias with strength and evidence.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol" },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "detect_smt",
      description: "Detect SMT divergence between two correlated symbols.",
      parameters: {
        type: "object",
        properties: {
          primarySymbol: { type: "string", description: "Primary symbol, e.g. BTCUSDT" },
          correlatedSymbol: { type: "string", description: "Correlated symbol, e.g. ETHUSDT" },
          timeframe: { type: "string", enum: ["1m","5m","15m","1h","4h","1d","1w"] },
        },
        required: ["primarySymbol", "correlatedSymbol", "timeframe"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_draw_targets",
      description: "Get ranked draw-on-liquidity targets with confluence scores.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol" },
          timeframe: { type: "string", enum: ["1m","5m","15m","1h","4h","1d","1w"] },
        },
        required: ["symbol", "timeframe"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "build_full_report",
      description: "Build complete SMC report across all 8 analysis dimensions.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol" },
          timeframe: { type: "string", enum: ["1m","5m","15m","1h","4h","1d","1w"] },
        },
        required: ["symbol", "timeframe"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_live_candles",
      description: "Get raw OHLCV candles from the real-time WebSocket pipeline.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol" },
          timeframe: { type: "string", enum: ["1m","5m","15m","1h","4h","1d","1w"] },
          limit: { type: "number", description: "Number of recent candles (1-300, default 20)" },
        },
        required: ["symbol", "timeframe"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "scan_all_timeframes",
      description: "Run SMC analysis across all 7 timeframes (M1→W1) for a symbol.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading symbol" },
        },
        required: ["symbol"],
      },
    },
  },
];

// ── Tool executor — routes tool calls to the tool registry ──────────────────

async function executeToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  const fn = toolRegistry.get(name);
  if (!fn) {
    return JSON.stringify({ error: `Tool "${name}" not found. Available: ${[...toolRegistry.keys()].join(", ")}` });
  }
  try {
    return await fn(args);
  } catch (err) {
    logger.error({ err, tool: name }, "MCP tool execution failed");
    return JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

// ── POST /api/agents/ask-mcp ──────────────────────────────────────────────────

router.post("/agents/ask-mcp", async (req: Request, res: Response): Promise<void> => {
  const { question, history = [], context } = req.body as {
    question: string;
    history?: Array<{ role: "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }>;
    context?: { symbol?: string; timeframe?: string; currentPrice?: number };
  };

  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const llmConfig = resolveLlmConfig();
  if (!llmConfig.apiKey && llmConfig.provider !== "amd") {
    res.status(500).json({ error: "AI not configured — set FIREWORKS_API_KEY or LLM_API_KEY" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: buildMcpSystemPrompt(context) },
    ...history.slice(-8),
    { role: "user", content: question },
  ];

  try {
    // ── Agent loop: AI can make multiple tool call rounds ──────────────────
    let maxRounds = 3; // prevent infinite loops
    let streamedContent = "";

    while (maxRounds-- > 0) {
      const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(llmConfig.apiKey && llmConfig.apiKey !== "not-needed"
            ? { Authorization: `Bearer ${llmConfig.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: llmConfig.model,
          stream: true,
          max_tokens: 4096,
          messages: messages as Array<{ role: string; content: string }>,
          tools: MCP_TOOLS,
          tool_choice: "auto",
        }),
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        res.write(`data: ${JSON.stringify({ error: `AI error: ${response.status} ${text}` })}\n\n`);
        res.end();
        return;
      }

      // Parse the SSE stream, collecting content and tool calls
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";
      const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
      let currentToolCall: { id: string; name: string; arguments: string } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta;

            if (delta?.content) {
              assistantContent += delta.content;
              res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
              streamedContent += delta.content;
            }

            if (delta?.tool_calls) {
              for (const raw of delta.tool_calls) {
                const tc = raw as { id?: string; function?: { name?: string; arguments?: string } };
                if (tc.id) {
                  if (currentToolCall && currentToolCall.id !== tc.id) {
                    toolCalls.push({ ...currentToolCall });
                  }
                  const fn = tc.function;
                  currentToolCall = {
                    id: tc.id,
                    name: fn?.name ?? currentToolCall?.name ?? "",
                    arguments: fn?.arguments ?? "",
                  };
                } else if (tc.function?.arguments && currentToolCall) {
                  currentToolCall.arguments += tc.function.arguments;
                }
              }
            }
          } catch { /* skip malformed */ }
        }
      }
      // Push final tool call
      if (currentToolCall) {
        toolCalls.push(currentToolCall);
      }

      // If the model made tool calls, execute them and feed results back
      if (toolCalls.length > 0) {
        // Add assistant message with tool calls
        messages.push({
          role: "assistant",
          content: assistantContent || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        // Execute each tool and add results
        for (const tc of toolCalls) {
          res.write(`data: ${JSON.stringify({ tool_start: tc.name })}\n\n`);

          let parsedArgs: Record<string, unknown> = {};
          try { parsedArgs = JSON.parse(tc.arguments); } catch { /* use empty */ }

          const result = await executeToolCall(tc.name, parsedArgs);

          res.write(`data: ${JSON.stringify({ tool_result: tc.name, content: result.slice(0, 200) + (result.length > 200 ? "..." : "") })}\n\n`);

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });

        }

        // Continue loop — AI will process tool results and respond
        continue;
      }

      // No tool calls — final response sent, done
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // Max rounds exceeded
    res.write(`data: ${JSON.stringify({ done: true, note: "max tool-call rounds reached" })}\n\n`);
    res.end();
  } catch (err) {
    logger.error({ err }, "MCP agent ask failed");
    res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
    res.end();
  }
});

export default router;
