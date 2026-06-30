# MCP Implementation Report — SMC Pulse Predict (Liquidity Hunter)

> **Date:** 2026-06-30  
> **Scope:** Full-project analysis and MCP integration roadmap  
> **Goal:** Make the platform more reliable, agentic, and action-capable via the Model Context Protocol

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Assessment](#2-current-architecture-assessment)
3. [What MCP Brings to This Project](#3-what-mcp-brings-to-this-project)
4. [MCP Server Design — Three-Layer Architecture](#4-mcp-server-design--three-layer-architecture)
5. [Layer 1: SMC Analysis Tools (High Priority)](#5-layer-1-smc-analysis-tools)
6. [Layer 2: Market Data Resources (Medium Priority)](#6-layer-2-market-data-resources)
7. [Layer 3: Action & Alert Tools (Lower Priority)](#7-layer-3-action--alert-tools)
8. [Reliability Engineering via MCP](#8-reliability-engineering-via-mcp)
9. [Implementation Plan — Phased Rollout](#9-implementation-plan--phased-rollout)
10. [Integration with Existing Systems](#10-integration-with-existing-systems)
11. [Testing Strategy](#11-testing-strategy)
12. [Security Considerations](#12-security-considerations)
13. [Migration Path from Current AI to MCP-Aware AI](#13-migration-path-from-current-ai-to-mcp-aware-ai)
14. [Appendix: File-Level Changes Required](#14-appendix-file-level-changes-required)

---

## 1. Executive Summary

SMC Pulse Predict currently has a **monolithic AI integration**: a single system prompt is built from a pre-computed `SmcReport`, injected into every LLM call, and the model responds with text only. The AI cannot take actions, call tools, fetch fresh data, or reason iteratively. Every AI call is stateless and isolated.

**MCP (Model Context Protocol)** transforms this from a passive Q&A system into an **agentic analysis platform** where:

- The LLM can **call individual SMC analysis modules as tools** — getting exactly the data it needs, when it needs it, rather than receiving a 50-field pre-computed report
- The LLM can **fetch live market data on demand** — no more stale cached reports
- The LLM can **perform multi-step reasoning** — run structure analysis, then conditionally run liquidity analysis based on structure results, then drill into specific OBs or FVGs
- The LLM can **take actions** — set price alerts, compare correlated pairs, scan all timeframes
- Every tool call is **logged, traced, and auditable** — dramatically improving reliability
- The system **degrades gracefully** — if one tool fails, others continue working

The net effect: the AI goes from being a text summarizer that reads a pre-digested report to being an **autonomous analyst** that can investigate, cross-reference, and reason about markets with the same tools a human SMC trader uses.

---

## 2. Current Architecture Assessment

### 2.1 What Works Well

| Aspect | Current State |
|---|---|
| SMC Engine | 8 well-factored, deterministic modules with clean interfaces |
| Type System | Comprehensive TypeScript interfaces in `types.ts` — single source of truth |
| API Design | Clean REST + SSE endpoints with consistent error handling |
| Caching | In-memory TTL cache at 60s — simple and effective for current scale |
| AI Grounding | System prompt injection of exact prices eliminates hallucination |
| Streaming | SSE proxy pattern cleanly separates client from AI provider |

### 2.2 What's Missing (MCP-Relevant Gaps)

| Gap | Impact | MCP Fix |
|---|---|---|
| **No tool use** | AI can only generate text, not call functions | MCP Tools expose SMC modules |
| **No iterative reasoning** | AI gets one shot with pre-computed data | MCP enables multi-turn tool calls |
| **Monolithic data injection** | Full report sent every call (~3K tokens wasted if user asks one question) | MCP Resources serve data on demand |
| **No action capability** | AI can't fetch data, set alerts, or scan symbols | MCP Tools for actions |
| **No observability** | Tool calls aren't logged or traced | MCP server provides structured logging |
| **No graceful degradation** | If Yahoo Finance fails, entire analysis fails | MCP tools can fail independently |
| **Fireworks-only AI** | Locked to one provider | MCP is provider-agnostic — works with Claude, GPT, etc. |
| **No test infrastructure** | Zero automated tests | MCP tools are independently testable |

### 2.3 Current AI Flow (For Reference)

```
Browser                    Express Server                  Fireworks AI
  │                             │                              │
  │ POST /agents/ask            │                              │
  │ {question, report, history} │                              │
  │────────────────────────────►│                              │
  │                             │ buildSystemPrompt(report)    │
  │                             │ POST /chat/completions       │
  │                             │──────────────────────────────►
  │                             │ SSE token stream             │
  │                             │◄─────────────────────────────│
  │ SSE token stream            │                              │
  │◄────────────────────────────│                              │
```

**Key problem:** The `report` is fully computed BEFORE the AI sees it. The AI has no agency — it can't decide which data it needs or run additional analysis.

---

## 3. What MCP Brings to This Project

### 3.1 Conceptual Shift

```
BEFORE (Current):                    AFTER (MCP):
┌──────────────┐                    ┌──────────────────────┐
│  SMC Engine  │                    │   MCP Server         │
│  (8 modules) │                    │   ┌────────────────┐ │
│      │       │                    │   │ Tools (12+)    │ │
│      ▼       │                    │   │ - structure    │ │
│  SmcReport   │──► System Prompt   │   │ - liquidity    │ │
│  (all data)  │    (all data)      │   │ - orderBlocks  │ │
│      │       │                    │   │ - fvg          │ │
│      ▼       │                    │   │ - pdArray      │ │
│  AI responds │                    │   │ - dailyBias    │ │
│  (text only) │                    │   │ - smt          │ │
└──────────────┘                    │   │ - fetchData    │ │
                                    │   │ - setAlert     │ │
                                    │   │ - scanAll      │ │
                                    │   └───────┬────────┘ │
                                    │           │           │
                                    │   ┌───────▼────────┐ │
                                    │   │ Resources (4+) │ │
                                    │   │ - live prices  │ │
                                    │   │ - reports      │ │
                                    │   │ - symbol lists │ │
                                    │   └───────┬────────┘ │
                                    │           │           │
                                    │   ┌───────▼────────┐ │
                                    │   │ Logging/Trace  │ │
                                    │   └────────────────┘ │
                                    └──────────┬───────────┘
                                               │
                                    ┌──────────▼───────────┐
                                    │  AI (any provider)   │
                                    │  Calls tools as      │
                                    │  needed, reasons     │
                                    │  iteratively         │
                                    └──────────────────────┘
```

### 3.2 Concrete Benefits

1. **Token Efficiency:** Instead of sending a 3,000-token system prompt for every question, the AI gets a minimal system prompt + calls tools for specific data when needed. A question like "Where is BSL?" costs ~200 tokens instead of 3,000.

2. **Iterative Reasoning:** The AI can run structure analysis, discover a bearish bias, then specifically fetch bearish OBs and nearby SSL pools — rather than receiving all data pre-flattened.

3. **Cross-Symbol Analysis:** The AI can fetch data for BTCUSDT, then conditionally fetch ETHUSDT for SMT divergence, then compare — all autonomously.

4. **Provider Agnostic:** MCP tools work with any AI provider that supports tool calling (Anthropic, OpenAI, Fireworks). The existing `claude-code-proxy` already handles Claude API format — MCP would be the next logical layer.

5. **Observability:** Every tool call is logged with input, output, timing, and errors. This makes the system debuggable and auditable.

6. **Testability:** Each MCP tool is an independent function with a clear contract — trivial to unit test with fixture data.

---

## 4. MCP Server Design — Three-Layer Architecture

### 4.1 Package Location

```
artifacts/mcp-server/          # New monorepo package
├── package.json               # @smc/mcp-server
├── tsconfig.json
├── build.mjs                  # esbuild bundler (matches api-server pattern)
├── src/
│   ├── index.ts               # Entry point — starts stdio server
│   ├── server.ts              # McpServer setup, tool registration
│   ├── tools/                 # Layer 1: SMC analysis tools
│   │   ├── index.ts           # Re-exports all tools
│   │   ├── structure.tool.ts  # analyze_structure
│   │   ├── liquidity.tool.ts  # analyze_liquidity
│   │   ├── order-blocks.tool.ts
│   │   ├── fvg.tool.ts
│   │   ├── pd-array.tool.ts
│   │   ├── daily-bias.tool.ts
│   │   ├── smt.tool.ts
│   │   ├── draw-targets.tool.ts
│   │   └── fetch-market-data.tool.ts  # Layer 3
│   ├── resources/             # Layer 2: Market data resources
│   │   ├── index.ts
│   │   ├── candles.resource.ts
│   │   ├── report.resource.ts
│   │   └── symbols.resource.ts
│   ├── actions/               # Layer 3: Action tools
│   │   ├── index.ts
│   │   ├── scan-all-timeframes.action.ts
│   │   ├── compare-symbols.action.ts
│   │   ├── set-alert.action.ts
│   │   └── backtest-pattern.action.ts
│   ├── lib/                   # Shared utilities
│   │   ├── cache.ts           # TTL cache (ported from routes/analysis.ts)
│   │   ├── logger.ts          # Structured tool-call logger
│   │   ├── errors.ts          # Tool error types
│   │   ├── validation.ts      # Zod schemas for tool inputs
│   │   └── metrics.ts         # Tool call latency/error metrics
│   └── fetchers/              # Market data fetching (shared with api-server)
│       ├── binance.ts         # Symlinked from api-server
│       └── yahoo.ts           # Symlinked from api-server
└── tests/
    ├── tools/
    │   ├── structure.test.ts
    │   ├── liquidity.test.ts
    │   ├── order-blocks.test.ts
    │   ├── fvg.test.ts
    │   └── ...
    ├── fixtures/
    │   ├── btc-4h-candles.json
    │   ├── eur-usd-1h-candles.json
    │   └── expected-reports.json
    └── integration/
        └── mcp-server.test.ts
```

### 4.2 Transport

The MCP server uses **stdio transport** (standard for MCP servers). The server reads JSON-RPC messages from stdin and writes responses to stdout. This is the simplest and most widely supported transport.

```typescript
// src/index.ts
import { StdioServerTransport } from "@anthropic-ai/mcp-sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server fatal:", err);
  process.exit(1);
});
```

### 4.3 Tool Registration Pattern

Each tool follows a consistent factory pattern:

```typescript
// src/tools/structure.tool.ts
import { z } from "zod";
import type { McpServer } from "@anthropic-ai/mcp-sdk/server/mcp.js";
import { analyzeStructure } from "../../../api-server/src/lib/smc/structure.js";
import { toolLogger } from "../lib/logger.js";
import { ToolError } from "../lib/errors.js";

export const StructureInput = z.object({
  symbol: z.string().describe("Trading symbol, e.g. BTCUSDT"),
  timeframe: z.enum(["1m","5m","15m","1h","4h","1d","1w"]),
  candles: z.array(z.object({
    time: z.number(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
  })),
});

export function registerStructureTool(server: McpServer) {
  server.tool(
    "analyze_structure",
    "Analyze market structure for a symbol: detect swing pivots (HH/HL/LH/LL), " +
    "BOS/CHoCH breaks, trend direction, bias, confidence score, and ICT market phase " +
    "(accumulation/manipulation/expansion/distribution/continuation).",
    StructureInput.shape,
    async (input) => {
      const start = Date.now();
      try {
        const result = analyzeStructure(input.candles, input.timeframe);
        toolLogger.info("analyze_structure", {
          symbol: input.symbol,
          timeframe: input.timeframe,
          bias: result.bias,
          confidence: result.confidence,
          breaks: result.breaks.length,
          durationMs: Date.now() - start,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        toolLogger.error("analyze_structure", {
          symbol: input.symbol,
          timeframe: input.timeframe,
          error: String(err),
          durationMs: Date.now() - start,
        });
        throw new ToolError(
          `Structure analysis failed for ${input.symbol}: ${err instanceof Error ? err.message : "Unknown error"}`,
          "ANALYSIS_FAILED",
        );
      }
    },
  );
}
```

---

## 5. Layer 1: SMC Analysis Tools (High Priority)

These are the **highest-value, lowest-risk** MCP tools. Each one wraps an existing SMC engine module with a clean Zod-validated interface and structured logging.

### 5.1 Tool Catalog

| Tool Name | Wraps | Input | Output | Token Savings |
|---|---|---|---|---|
| `analyze_structure` | `structure.ts::analyzeStructure()` | symbol, timeframe, candles | StructureResult | ~800 tokens vs full report |
| `analyze_liquidity` | `liquidity.ts::analyzeLiquidity()` | symbol, timeframe, market, candles | LiquidityResult | ~600 tokens |
| `analyze_order_blocks` | `order-blocks.ts::analyzeOrderBlocks()` | symbol, candles, fvg[] | OrderBlock[] | ~500 tokens |
| `analyze_fvg` | `fvg.ts::analyzeFVG()` | symbol, market, candles | FairValueGap[] | ~400 tokens |
| `analyze_pd_array` | `pd-array.ts::analyzePdArray()` | symbol, timeframe, candles | PdArrayResult | ~350 tokens |
| `analyze_daily_bias` | `daily-bias.ts::analyzeDailyBias()` | symbol, dailyCandles | DailyBiasResult | ~300 tokens |
| `analyze_smt` | `smt.ts::analyzeSMT()` | primarySymbol, corrSymbol, primaryCandles, corrCandles | SmtDivergence | ~300 tokens |
| `score_draw_targets` | `report.ts` draw scoring logic | liquidity, orderBlocks, fvg, pdArray, bias, smt | DrawTarget[] | ~400 tokens |

**Total tools:** 8  
**Total new code per tool:** ~60-80 lines (wrapper + validation + logging)  
**Core logic reuse:** 100% — no changes to existing SMC modules

### 5.2 Why Individual Tools Beat a Monolithic `build_report` Tool

The current architecture always runs ALL 8 modules and injects everything into the prompt. With individual tools:

1. **The AI decides what to analyze.** If the user asks "What's the structure look like?", only `analyze_structure` runs — not liquidity, not FVGs.

2. **Conditional analysis chains.** The AI can run `analyze_structure`, discover a bearish bias, then decide to run `analyze_liquidity` looking specifically for SSL, then `analyze_order_blocks` filtered to bearish OBs.

3. **Cross-symbol reasoning.** The AI can run `analyze_structure` on BTCUSDT, discover SMT conditions might exist, then `analyze_smt` with ETHUSDT.

4. **Retry on failure.** If `analyze_liquidity` fails (e.g., not enough candles), the AI can still deliver useful structure and FVG analysis — the other tools remain available.

### 5.3 Also Consider: `build_full_report` Composite Tool

Additionally, provide a convenience tool that wraps the full pipeline. This is useful for the current dashboard's use case (which always needs the full report) and gives the AI a one-call option when it genuinely needs everything:

```typescript
server.tool(
  "build_full_report",
  "Build a complete SMC report for a symbol across all 8 analysis dimensions. " +
  "Use this when you need the full picture, or use individual analysis tools for targeted queries.",
  {
    symbol: z.string(),
    market: z.enum(["crypto", "forex"]),
    timeframe: z.enum(["1m","5m","15m","1h","4h","1d","1w"]),
    includeSMT: z.boolean().default(false),
    correlatedSymbol: z.string().optional(),
  },
  async (input) => {
    // fetches candles → runs all 8 modules → returns SmcReport
    // Includes timing breakdown per module for observability
  },
);
```

---

## 6. Layer 2: Market Data Resources (Medium Priority)

MCP Resources provide **read-only data access** using URI templates. These are ideal for exposing market data that the AI can reference without needing to call a tool.

### 6.1 Resource Catalog

| URI Pattern | Description | Returns |
|---|---|---|
| `market://{market}/{symbol}/{timeframe}/candles` | OHLCV candle array | Candle[] (last 300) |
| `market://{market}/{symbol}/{timeframe}/report` | Full SMC report | SmcReport JSON |
| `market://{market}/{symbol}/{timeframe}/summary` | Human-readable summary | Markdown text |
| `market://symbols/{market}` | Available symbol list | Symbol[] array |

### 6.2 Resource Registration

```typescript
server.resource(
  "market-candles",
  new ResourceTemplate("market://{market}/{symbol}/{timeframe}/candles", {
    list: async () => ({
      resources: [{ uri: "market://crypto/BTCUSDT/4h/candles", name: "BTCUSDT 4h Candles" }],
    }),
  }),
  {
    description: "OHLCV candle data for a symbol and timeframe. Returns up to 300 candles.",
  },
  async (uri, variables) => {
    const { market, symbol, timeframe } = variables;
    const candles = await fetchCandles(symbol, market as Market, timeframe);
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(candles),
      }],
    };
  },
);
```

### 6.3 Resource vs Tool — When to Use Which

| Use a **Resource** when... | Use a **Tool** when... |
|---|---|
| Data is read-only and idempotent | Data requires computation or parameters |
| The AI just needs to reference existing data | The AI needs to trigger an analysis |
| URI-based addressing makes sense | Input validation is complex |
| Example: "What's the current price of BTC?" | Example: "Analyze BTC's market structure" |

Resources are lighter-weight than tools — they have no input validation overhead and are purely retrieval. They're ideal for the dashboard's auto-refresh pattern.

---

## 7. Layer 3: Action & Alert Tools (Lower Priority)

These tools enable the AI to **do things** beyond analysis — fetching fresh data, comparing symbols, setting alerts, and scanning across timeframes.

### 7.1 Action Tool Catalog

| Tool Name | Description | Input | Output |
|---|---|---|---|
| `fetch_market_data` | Fetch fresh OHLCV from Binance/Yahoo | symbol, market, timeframe, limit | Candle[] |
| `scan_all_timeframes` | Run full report on all 7 timeframes | symbol, market | Record\<Timeframe, SmcReport\> |
| `compare_symbols` | Side-by-side SMT/divergence analysis | symbol1, symbol2, timeframe | ComparisonReport |
| `get_correlated_pairs` | Return known correlated pairs for a symbol | symbol, market | CorrelatedPair[] |
| `search_historical_pattern` | Search candles for a specific pattern | symbol, market, pattern, lookback | PatternMatch[] |
| `set_price_alert` | Register a price alert (in-memory) | symbol, price, condition, label | AlertConfirmation |
| `list_alerts` | List active alerts | (none) | Alert[] |
| `cancel_alert` | Remove a price alert | alertId | SuccessConfirmation |

### 7.2 Price Alert Implementation (In-Memory)

```typescript
// src/actions/set-alert.action.ts
interface Alert {
  id: string;
  symbol: string;
  price: number;
  condition: "above" | "below" | "crosses";
  label: string;
  createdAt: number;
  triggered: boolean;
  triggeredAt: number | null;
}

const alerts = new Map<string, Alert>();

// An alert checker runs on a 10-second interval in the MCP server
// When triggered, it emits a notification via server.sendLoggingMessage()
```

### 7.3 Scan All Timeframes

This is a high-value tool for the dashboard. Currently, the frontend makes 7 separate API calls (one per timeframe). With MCP, the AI can call `scan_all_timeframes` once and get a complete cascade:

```typescript
server.tool(
  "scan_all_timeframes",
  "Run full SMC analysis on all 7 timeframes for a symbol. " +
  "Returns the complete multi-timeframe cascade with bias alignment.",
  {
    symbol: z.string(),
    market: z.enum(["crypto", "forex"]),
  },
  async (input) => {
    const timeframes = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;
    const results: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const tf of timeframes) {
      try {
        const candles = await fetchCandles(input.symbol, input.market, tf);
        const report = buildReport(candles, input.symbol, input.market, tf);
        results[tf] = report;
      } catch (err) {
        errors.push(`${tf}: ${err instanceof Error ? err.message : "Unknown"}`);
        results[tf] = { error: String(err) };
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          symbol: input.symbol,
          market: input.market,
          timeframes: results,
          errors: errors.length > 0 ? errors : undefined,
        }, null, 2),
      }],
    };
  },
);
```

---

## 8. Reliability Engineering via MCP

This is where MCP provides the biggest improvement over the current architecture.

### 8.1 Structured Tool-Call Logging

Every tool call is logged with:

```typescript
interface ToolCallLog {
  toolName: string;
  callId: string;           // UUID v4
  timestamp: number;        // Unix ms
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  durationMs: number;
  success: boolean;
  retryCount?: number;
}
```

Logs are written as Pino structured JSON (same format as the API server). This enables:
- **Debugging:** Trace exactly which tool calls the AI made and what data it received
- **Performance monitoring:** Track which tools are slow and why
- **Auditing:** Every AI action is recorded — essential for a financial application
- **Cost tracking:** Count tool calls per session to estimate token usage

### 8.2 Graceful Degradation

Each tool handles failures independently. The MCP server wraps every tool call with:

```typescript
function withErrorBoundary<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    // Log the error
    logger.error({ tool: toolName, err }, "Tool execution failed");

    // Return a structured error that the AI can understand and respond to
    throw new ToolError(
      `${toolName} failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      classifyError(err),  // "DATA_UNAVAILABLE" | "INVALID_INPUT" | "TIMEOUT" | "INTERNAL"
    );
  });
}
```

The AI receives the error code and can decide how to respond:
- `DATA_UNAVAILABLE` → "The market data source is temporarily unavailable. I can analyze cached data or try again later."
- `INVALID_INPUT` → "That symbol isn't recognized. Did you mean BTCUSDT?"
- `TIMEOUT` → "The analysis timed out. Would you like me to try with a shorter lookback period?"
- `INTERNAL` → "Something went wrong on my end. Let me try a different approach."

### 8.3 Retry with Backoff

Data-fetching tools automatically retry on transient failures:

```typescript
async function fetchWithRetry(
  fn: () => Promise<Candle[]>,
  maxRetries = 3,
): Promise<Candle[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      logger.warn({ attempt, delay, err }, "Retrying fetch");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}
```

### 8.4 Circuit Breaker

For external API calls (Binance, Yahoo), a circuit breaker prevents cascading failures:

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  async call<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > 30_000) {
        this.state = "half-open";
      } else {
        throw new ToolError(`Circuit open for ${name}`, "CIRCUIT_OPEN");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= 5) this.state = "open";
  }
}

const circuits = {
  binance: new CircuitBreaker(),
  yahoo: new CircuitBreaker(),
};
```

### 8.5 Input Validation (Zod)

Every tool input is validated before execution. This catches errors early and gives the AI clear feedback:

```typescript
// If the AI passes an invalid timeframe:
// ❌ Old way: runtime crash in analyzeStructure() with cryptic error
// ✅ New way: Zod validation returns structured error:
//   "Invalid input: timeframe must be one of 1m,5m,15m,1h,4h,1d,1w"
```

The Zod schemas in `lib/api-zod` (already generated from the OpenAPI spec) can be reused directly.

### 8.6 Metrics Collection

```typescript
interface ToolMetrics {
  calls: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  lastError?: string;
  lastErrorTime?: number;
}

// Collected per tool, reported every 5 minutes via server.sendLoggingMessage()
```

---

## 9. Implementation Plan — Phased Rollout

### Phase 1: Foundation (Week 1)

**Goal:** MCP server scaffolding + 2 core tools working + test infrastructure

**Deliverables:**
1. Create `artifacts/mcp-server/` package with esbuild build pipeline
2. Set up `@anthropic-ai/mcp-sdk` dependency
3. Implement `server.ts` with tool registration pattern
4. Port `toolLogger` from existing Pino pattern
5. Port `lib/cache.ts` from `routes/analysis.ts`
6. Implement `analyze_structure` tool (proof of concept)
7. Implement `analyze_liquidity` tool
8. Write unit tests with BTC 4h fixture data
9. Write integration test showing AI → MCP → engine → AI flow

**Files created:** ~15  
**Files modified:** `pnpm-workspace.yaml` (add package)

### Phase 2: SMC Tool Suite (Week 2)

**Goal:** All 8 SMC analysis tools + `build_full_report` composite tool

**Deliverables:**
1. Implement remaining 6 SMC analysis tools
2. Implement `build_full_report` composite tool
3. Implement `fetch_market_data` action tool
4. Add circuit breaker to data fetchers
5. Add retry with exponential backoff
6. Full test coverage for all tools with fixture data
7. Performance benchmarks (compare tool latency vs monolithic report)

**Files created:** ~10  
**Files modified:** None (new package only)

### Phase 3: Resources & Actions (Week 3)

**Goal:** MCP resources + action tools + observability dashboard

**Deliverables:**
1. Implement 4 market data resources
2. Implement `scan_all_timeframes` action
3. Implement `compare_symbols` action
4. Implement `set_price_alert` / `list_alerts` / `cancel_alert`
5. Implement `get_correlated_pairs`
6. Metrics collection and structured logging to file
7. Tool call trace viewer (simple HTML page served by Express)

**Files created:** ~12  

### Phase 4: AI Integration & Migration (Week 4)

**Goal:** Wire MCP server to the existing API + add MCP-aware AI endpoint

**Deliverables:**
1. New Express route: `POST /api/agents/mcp` — passes user question through MCP-aware AI
2. SSE streaming adapter for MCP tool calls (show tool invocation in UI)
3. Update `AgentChat.tsx` to display tool calls
4. Update `AgentPipeline.tsx` to use MCP tools instead of static prompts
5. Add `mcp://` URI support to the dashboard
6. Migration guide for existing users
7. Performance comparison: MCP-aware AI vs current monolithic prompt

**Files modified:** `routes/agents.ts`, `AgentChat.tsx`, `AgentPipeline.tsx`, `api.ts`

---

## 10. Integration with Existing Systems

### 10.1 Code Sharing with API Server

The MCP server reuses the SMC engine modules directly. Since both packages are in the same pnpm workspace:

```json
// artifacts/mcp-server/package.json
{
  "dependencies": {
    "@smc/api-server": "workspace:*"  // Re-exports SMC engine modules
  }
}
```

Alternatively, extract the SMC engine into `lib/smc-engine/` as a shared package:

```
lib/smc-engine/               # New shared package
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Re-exports all modules
│   ├── types.ts
│   ├── config.ts
│   ├── structure.ts
│   ├── liquidity.ts
│   ├── order-blocks.ts
│   ├── fvg.ts
│   ├── pd-array.ts
│   ├── daily-bias.ts
│   ├── smt.ts
│   └── report.ts
```

Then both `api-server` and `mcp-server` depend on `@smc/engine`. This is cleaner but requires refactoring the existing imports.

### 10.2 Integration with claude-code-proxy

The existing `claude-code-proxy/` already converts Claude API → OpenAI. It could be extended to:

1. Accept Claude API requests with `tools` definitions
2. Route MCP tool calls to the local MCP server
3. Return `tool_use` content blocks in Claude format

This would let users connect Claude Desktop directly to the SMC Pulse Predict MCP server through the proxy.

### 10.3 Integration with Express API Server

The MCP server runs as a separate process. The Express server communicates with it in two ways:

**Option A: Direct import (simplest for Replit single-process)**
```typescript
// routes/agents.ts — new MCP-aware endpoint
import { createServer } from "../../mcp-server/src/server.js";

router.post("/agents/mcp", async (req, res) => {
  const mcpServer = createServer();
  // Handle the MCP-aware agent loop
  // The Express server calls the same tool functions the MCP server exposes
});
```

**Option B: Subprocess (proper separation)**
```typescript
// The Express server spawns the MCP server as a child process
// Communication over stdio JSON-RPC
import { spawn } from "child_process";

const mcpProcess = spawn("node", ["artifacts/mcp-server/dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
});
```

**Recommendation:** Option A for Replit (single process, simpler), Option B for production (process isolation, independent scaling).

### 10.4 Frontend Integration

The frontend needs to display tool calls. A new SSE event type:

```
data: {"type": "tool_start", "tool": "analyze_structure", "input": {"symbol": "BTCUSDT"}}
data: {"type": "tool_progress", "tool": "analyze_structure", "message": "Computing pivots..."}
data: {"type": "tool_result", "tool": "analyze_structure", "output": {...}}
data: {"type": "delta", "content": "BTCUSDT shows a bearish structure..."}
```

The `AgentChat.tsx` component renders tool calls as expandable cards between messages:

```tsx
function ToolCallCard({ tool, input, output, status }: ToolCallProps) {
  return (
    <div className="tool-call-card">
      <div className="tool-header">
        <WrenchIcon />
        <span>{tool}</span>
        <StatusBadge status={status} />
      </div>
      <Collapsible>
        <div>Input: {JSON.stringify(input)}</div>
        <div>Output: {truncate(JSON.stringify(output), 200)}</div>
      </Collapsible>
    </div>
  );
}
```

---

## 11. Testing Strategy

### 11.1 Test Infrastructure

```json
// artifacts/mcp-server/package.json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "@anthropic-ai/mcp-sdk": "^1.0.0"
  }
}
```

### 11.2 Unit Tests — SMC Tools

Each tool gets a test file with known-good fixture data:

```typescript
// tests/tools/structure.test.ts
import { describe, it, expect } from "vitest";
import { analyzeStructure } from "../../src/tools/structure.tool";
import btc4hCandles from "../fixtures/btc-4h-candles.json";

describe("analyze_structure tool", () => {
  it("detects bearish BOS from known BTC 4h data", async () => {
    const result = await analyzeStructure({
      symbol: "BTCUSDT",
      timeframe: "4h",
      candles: btc4hCandles,
    });

    expect(result.bias).toBe("bearish");
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.breaks.length).toBeGreaterThan(0);
    expect(result.breaks.some((b) => b.type === "BOS")).toBe(true);
  });

  it("returns valid StructureResult shape", async () => {
    const result = await analyzeStructure({
      symbol: "BTCUSDT",
      timeframe: "4h",
      candles: btc4hCandles,
    });

    expect(result).toMatchObject({
      trend: expect.any(String),
      bias: expect.any(String),
      confidence: expect.any(Number),
      pivots: expect.any(Array),
      breaks: expect.any(Array),
      phase: expect.any(String),
      narrative: expect.any(String),
      evidence: expect.any(Array),
    });
  });

  it("errors on empty candles", async () => {
    await expect(
      analyzeStructure({ symbol: "BTCUSDT", timeframe: "4h", candles: [] }),
    ).rejects.toThrow();
  });
});
```

### 11.3 Integration Tests — Full MCP Flow

```typescript
// tests/integration/mcp-server.test.ts
import { Client } from "@anthropic-ai/mcp-sdk/client/index.js";
import { StdioClientTransport } from "@anthropic-ai/mcp-sdk/client/stdio.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("MCP server integration", () => {
  let client: Client;

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
    });
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("lists all tools", async () => {
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(8);
    expect(tools.tools.map((t) => t.name)).toContain("analyze_structure");
  });

  it("analyze_structure returns valid data", async () => {
    const result = await client.callTool({
      name: "analyze_structure",
      arguments: {
        symbol: "BTCUSDT",
        timeframe: "4h",
        candles: btc4hCandles,
      },
    });

    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.bias).toBeDefined();
  });
});
```

### 11.4 Fixture Generation

Create a script to capture real market data for testing:

```bash
# scripts/capture-fixtures.sh
# Fetches real candle data and saves as test fixtures
curl "http://localhost:8080/api/analysis/crypto?symbol=BTCUSDT&timeframe=4h" \
  | jq '.candles' > artifacts/mcp-server/tests/fixtures/btc-4h-candles.json
```

---

## 12. Security Considerations

### 12.1 Tool Call Authorization

Since the MCP server can fetch external data and (in the future) execute trades, tool calls should be authorized:

```typescript
// Simple API key check for sensitive tools
const SENSITIVE_TOOLS = ["set_price_alert", "execute_trade", "place_order"];

function authorizeTool(toolName: string, headers: Record<string, string>): boolean {
  if (!SENSITIVE_TOOLS.includes(toolName)) return true;
  const apiKey = headers["x-api-key"];
  return apiKey === process.env.MCP_API_KEY;
}
```

For the current read-only scope, all tools are safe without authorization.

### 12.2 Input Sanitization

All tool inputs are validated by Zod schemas. Additionally:

```typescript
// Prevent prompt injection through symbol names
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}(?:[-\/][A-Z0-9]{2,20})?$/;

function sanitizeSymbol(symbol: string): string {
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new ToolError(`Invalid symbol format: ${symbol}`, "INVALID_INPUT");
  }
  return symbol.toUpperCase();
}
```

### 12.3 Rate Limiting

Per-tool rate limiting prevents abuse:

```typescript
const rateLimits: Record<string, { windowMs: number; maxCalls: number }> = {
  fetch_market_data: { windowMs: 60_000, maxCalls: 10 },   // 10/min
  scan_all_timeframes: { windowMs: 60_000, maxCalls: 5 },   // 5/min
  build_full_report: { windowMs: 60_000, maxCalls: 20 },    // 20/min
};
```

---

## 13. Migration Path from Current AI to MCP-Aware AI

### 13.1 Backward Compatibility

The existing `/api/agents/ask` and `/api/agents/pipeline` endpoints remain unchanged. The new MCP endpoint is additive:

```
Current endpoints (unchanged):
  POST /api/agents/ask         → Fireworks AI with full SmcReport prompt
  POST /api/agents/pipeline    → Sequential 4-agent pipeline

New endpoints:
  POST /api/agents/mcp/ask     → MCP-aware AI (tools available)
  POST /api/agents/mcp/pipeline → MCP-aware pipeline (tools per agent)
```

### 13.2 New System Prompt

The MCP-aware system prompt is minimalist — it tells the AI it has tools available and lets it decide what to call:

```
You are an expert SMC/ICT analyst with access to market analysis tools.

When a user asks about a market, use the available tools to fetch and analyze
the relevant data. Don't guess — always call the appropriate tool to get real data.

Available tools:
- analyze_structure: Market structure analysis (pivots, BOS/CHoCH, bias)
- analyze_liquidity: Liquidity pool scanning (BSL/SSL)
- analyze_order_blocks: Order block detection
- analyze_fvg: Fair value gap detection
- analyze_pd_array: Premium/discount zone analysis
- analyze_daily_bias: Daily timeframe bias
- analyze_smt: SMT divergence detection
- build_full_report: Complete SMC report (all modules)
- fetch_market_data: Fetch fresh OHLCV data
- scan_all_timeframes: Multi-timeframe cascade analysis

Always cite specific price levels from tool results.
Do not give financial advice or buy/sell signals.
```

This is ~200 tokens vs the current ~3,000-token system prompt — a **15× reduction in fixed cost per request**.

### 13.3 Feature Flags

```typescript
// Server config
const USE_MCP = process.env.ENABLE_MCP === "true";

// Frontend can toggle between modes
const AgentModeToggle = () => (
  <Toggle
    on="MCP (Tool-Enabled)"
    off="Classic (Prompt-Only)"
    value={useMCP}
    onChange={setUseMCP}
  />
);
```

---

## 14. Appendix: File-Level Changes Required

### 14.1 New Files (35+)

```
artifacts/mcp-server/
├── package.json
├── tsconfig.json
├── build.mjs
├── README.md
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── tools/
│   │   ├── index.ts
│   │   ├── structure.tool.ts
│   │   ├── liquidity.tool.ts
│   │   ├── order-blocks.tool.ts
│   │   ├── fvg.tool.ts
│   │   ├── pd-array.tool.ts
│   │   ├── daily-bias.tool.ts
│   │   ├── smt.tool.ts
│   │   ├── draw-targets.tool.ts
│   │   ├── full-report.tool.ts
│   │   ├── fetch-market-data.tool.ts
│   │   ├── scan-all-timeframes.tool.ts
│   │   ├── compare-symbols.tool.ts
│   │   └── set-alert.tool.ts
│   ├── resources/
│   │   ├── index.ts
│   │   ├── candles.resource.ts
│   │   ├── report.resource.ts
│   │   └── symbols.resource.ts
│   ├── lib/
│   │   ├── cache.ts
│   │   ├── logger.ts
│   │   ├── errors.ts
│   │   ├── validation.ts
│   │   ├── metrics.ts
│   │   └── circuit-breaker.ts
│   └── fetchers/
│       ├── binance.ts
│       └── yahoo.ts
└── tests/
    ├── tools/
    │   ├── structure.test.ts
    │   ├── liquidity.test.ts
    │   ├── order-blocks.test.ts
    │   ├── fvg.test.ts
    │   ├── pd-array.test.ts
    │   ├── daily-bias.test.ts
    │   ├── smt.test.ts
    │   └── full-report.test.ts
    ├── fixtures/
    │   ├── btc-4h-candles.json
    │   ├── eth-4h-candles.json
    │   ├── eur-usd-1h-candles.json
    │   └── expected-reports.json
    └── integration/
        └── mcp-server.test.ts
```

### 14.2 Modified Files (8)

| File | Change |
|---|---|
| `pnpm-workspace.yaml` | Add `artifacts/mcp-server` to packages |
| `package.json` | Add `mcp:dev`, `mcp:build`, `mcp:test` scripts |
| `artifacts/api-server/src/routes/agents.ts` | Add `POST /agents/mcp/ask` and `/agents/mcp/pipeline` endpoints |
| `artifacts/api-server/src/app.ts` | Mount new MCP routes |
| `artifacts/liquidity-hunter/src/components/AgentChat.tsx` | Add tool call card rendering, MCP mode toggle |
| `artifacts/liquidity-hunter/src/components/AgentPipeline.tsx` | Add MCP-aware pipeline mode |
| `artifacts/liquidity-hunter/src/lib/api.ts` | Add MCP SSE stream parsing |
| `.replit` | Add MCP server run command |

### 14.3 Optional Refactors

| Refactor | Effort | Benefit |
|---|---|---|
| Extract SMC engine to `lib/smc-engine/` | Medium (2-3 hours) | Clean separation, avoids symlinks |
| Port `lib/api-zod` schemas to tool inputs | Low (1 hour) | Reuses existing Zod schemas |
| Add Redis cache to MCP server | Medium (3-4 hours) | Shared cache across processes |
| Add WebSocket live price feed | High (1-2 days) | Sub-second price updates |

---

## Summary of Impact

| Dimension | Current | With MCP | Improvement |
|---|---|---|---|
| **AI token cost per query** | ~3,000 tokens fixed | ~200 tokens + on-demand tools | **15× reduction** for simple queries |
| **AI agency** | Text-only, stateless | Tool-calling, iterative reasoning | **New capability** |
| **Error handling** | Monolithic: one failure = all fail | Per-tool: independent failure | **Graceful degradation** |
| **Observability** | Request-level logs only | Per-tool logs + traces + metrics | **Full audit trail** |
| **Testability** | No tests, hard to isolate | Each tool independently testable | **From 0% to 80%+ coverage** |
| **Provider flexibility** | Fireworks AI only | Any tool-calling LLM | **No vendor lock-in** |
| **New actions** | None | Set alerts, scan all TFs, compare symbols | **8 new capabilities** |
| **Code reuse** | N/A (new package) | 100% reuse of SMC engine modules | **Zero logic duplication** |

---

## Recommended First Step

**Start with Phase 1, but only `analyze_structure` + `analyze_liquidity` as a proof of concept.** This gives you:

1. A working MCP server with proper tool registration
2. Two independently callable SMC tools
3. Structured logging and error handling
4. A test suite with fixture data
5. A measurable baseline: compare token usage and response quality vs the current monolithic prompt

This PoC can be built in **2-3 days** and will validate the architecture before committing to all 8 tools.
