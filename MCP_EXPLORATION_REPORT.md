# MCP Exploration Report — SMC Pulse Predict

> **Date:** 2026-06-30  
> **Goal:** Identify MCP (Model Context Protocol) options that integrate seamlessly with the existing real-time WebSocket infrastructure, SMC engine, and AI analyst to make the platform more reliable, agentic, and action-capable.
>
> **📌 Implementation:** This exploration led to the Tier 3 MCP implementation — see [`MCP_TIER3_IMPLEMENTATION.md`](./MCP_TIER3_IMPLEMENTATION.md) for the build report and [`docs/MCP_CHAT_CAPABILITIES.md`](./docs/MCP_CHAT_CAPABILITIES.md) for a complete capabilities reference (FastMCP v4.3.2, 11 tools, 2 resources, 1 prompt, frontend UX).

---

## Table of Contents

1. [Current Project State](#1-current-project-state)
2. [What MCP Can Add](#2-what-mcp-can-add)
3. [MCP Framework Selection](#3-mcp-framework-selection)
4. [Plug-and-Play MCP Servers](#4-plug-and-play-mcp-servers)
5. [Custom SMC MCP Server Design](#5-custom-smc-mcp-server-design)
6. [Integration Architecture](#6-integration-architecture)
7. [Phase 1: Proof of Concept](#7-phase-1-proof-of-concept)
8. [Phase 2: Full SMC Tool Suite](#8-phase-2-full-smc-tool-suite)
9. [Phase 3: Multi-Provider AI + Actions](#9-phase-3-multi-provider-ai--actions)
10. [Recommendation & Next Steps](#10-recommendation--next-steps)

---

## 1. Current Project State

### What We Have (Post-WebSocket Implementation)

```
┌────────────────────────────────────────────────────────────┐
│                     CURRENT ARCHITECTURE                    │
│                                                            │
│  Browser ──REST──► Express 5 ──► SMC Engine ──► JSON      │
│  Browser ──SSE───► /api/stream ──► candle-store ──► SSE   │
│  Browser ──SSE───► /api/agents ──► Fireworks AI ──► SSE    │
│                                                            │
│  Binance US WS ──► candle-store ──► analysis-bridge        │
│  Finnhub/Yahoo ──► candle-store ──► (rebuild on close)    │
│                                                            │
│  Strengths:                                                │
│  ✅ Real-time crypto + forex data via WebSocket/SSE        │
│  ✅ Server-side SMC rebuild on candle close (<100ms)       │
│  ✅ SSE push to browser (no polling needed)                │
│  ✅ Live price badge + chart updates                       │
│  ✅ Graceful degradation (geo-fallback, no-key fallback)   │
│  ✅ Structured Pino logging throughout                     │
│                                                            │
│  Gaps:                                                     │
│  ❌ AI agent has no tool-calling capability                │
│  ❌ No way for AI to fetch fresh data or run analysis      │
│  ❌ Monolithic system prompt (3K tokens every call)        │
│  ❌ Single AI provider (Fireworks only)                    │
│  ❌ No action capability (alerts, scanning, comparison)    │
│  ❌ No structured observability per AI tool call           │
│  ❌ No way to expose SMC engine to external AI clients     │
└────────────────────────────────────────────────────────────┘
```

### Key Insight

The real-time pipeline we built (WebSocket → candle-store → analysis-bridge → SSE) is **already an MCP-shaped architecture**. The candle store is an event-driven data source, the analysis bridge is a tool that computes on demand, and SSE is the transport. MCP formalizes this pattern with a standard protocol that any AI client can consume.

---

## 2. What MCP Can Add

### 2.1 Token Efficiency (15× Reduction)

| Scenario | Current | With MCP |
|---|---|---|
| User asks "What's the BTC structure?" | 3K-token system prompt with full SmcReport | ~200-token system prompt + AI calls `analyze_structure` tool |
| User asks "Where's the nearest BSL?" | Another 3K tokens (full report re-sent) | AI calls `get_liquidity_map` tool (~500 tokens) |
| 5-turn conversation | 15K tokens (5 × 3K) | ~1K tokens + 5 tool calls (~3K total) |

### 2.2 AI Agency

Current: AI receives a static dump of pre-computed data. It can't investigate, drill down, or cross-reference.

With MCP: AI becomes an autonomous analyst that can:
- Run `analyze_structure` → discover bearish bias → then specifically call `analyze_liquidity` for SSL pools
- Fetch data for ETHUSDT after discovering SMT conditions on BTCUSDT
- Compare multiple timeframes to validate a setup
- Set price alerts when specific conditions are met

### 2.3 Multi-Provider Support

MCP is provider-agnostic. The same tools work with:
- Claude (Anthropic)
- GPT (OpenAI)
- Llama (Fireworks, Groq, Together)
- Local models (Ollama)

### 2.4 Observability & Reliability

Every MCP tool call is:
- **Logged** with input, output, timing, and error codes
- **Retryable** on transient failures
- **Independently fallible** — if `analyze_liquidity` fails, `analyze_structure` still works
- **Auditable** — full trace of what the AI did and why

---

## 3. MCP Framework Selection

### 3.1 Comparison

| Framework | Language | Transports | Bundle Size | Best For |
|---|---|---|---|---|
| **FastMCP** (`fastmcp`) | TypeScript | stdio, SSE, HTTP Stream | ~40KB | Production servers, sessions, streaming |
| **mcp-lite** (Fiberplane) | TypeScript | HTTP + SSE | Zero deps | Minimal, composable, edge runtimes |
| **@modelcontextprotocol/sdk** (official) | TypeScript | stdio, Streamable HTTP | ~80KB | Raw control, spec compliance |
| **@context-pods/server** | TypeScript | WebSocket, stdio | ~30KB | Dedicated WebSocket transport |

### 3.2 Recommendation: FastMCP

**Why FastMCP is the best fit for this project:**

1. **HTTP Streaming transport** — matches our existing SSE pattern. Can run on the same Express server as our REST API (port 8080). No separate process needed in development.

2. **Session support** — enables per-user conversation state, which our AI Q&A already tracks manually. FastMCP formalizes this.

3. **Streaming tool output** (`streamingHint: true`) — enables the AI to stream tool results token-by-token, matching our existing SSE UX.

4. **Authentication** — built-in `authenticate` callback. We can reuse the existing `FIREWORKS_API_KEY` pattern or add scoped API keys.

5. **Zod integration** — we already use Zod throughout the project (API validation). Tool parameters use the same Zod schemas.

6. **Stateless mode** — works on Replit's serverless-like environment. Each request creates a temporary session.

7. **Small footprint** — ~40KB, cold start < 100ms. Won't bloat the esbuild bundle.

8. **Active maintenance** — 2.2K+ GitHub stars, v3.x stable, frequent releases.

### Installation

```bash
pnpm add fastmcp --filter @workspace/api-server
```

---

## 4. Plug-and-Play MCP Servers

These are existing MCP servers that could be integrated with minimal effort:

### 4.1 yfnhanced-mcp — Yahoo Finance Data (High Value, Zero Cost)

**Description:** Enterprise-grade Yahoo Finance MCP server with circuit breaker, rate limiting, caching.

**Tools (13+):**
- `get_quote` — Real-time quote with change %, 52-week range, market state
- `get_historical_data` — OHLCV candles for any symbol/timeframe
- `get_financial_statements` — Income statement, balance sheet, cash flow
- `get_earnings` — Earnings history and estimates
- `get_analyst_ratings` — Buy/hold/sell consensus
- `get_options_chain` — Options data with Greeks
- `get_news` — Financial news headlines
- `get_screener` — Multi-criteria stock screening
- `get_crypto_quote` — Crypto prices
- `get_forex_quote` — Forex pair quotes

**Integration value for SMC Pulse Predict:**
- **Redundant data source** — if Binance WS fails, Yahoo MCP provides backup market data
- **Fundamental context** — AI analyst can supplement SMC technical analysis with earnings, news, and analyst ratings
- **Forex fallback** — replaces our custom Yahoo polling with a battle-tested implementation

**Setup:**
```bash
npx yfnhanced-mcp
# Add to Claude Desktop / Cursor / any MCP client config
```

**Cost:** Free, no API key required.

**Risk:** Unofficial Yahoo API — same as our current Yahoo fetcher. The MCP server adds resilience (circuit breaker, retry, rate limiting) that our implementation lacks.

### 4.2 CCXT MCP Server — Multi-Exchange Crypto (Medium Value)

**Description:** Bridges LLMs to 20+ cryptocurrency exchanges via the CCXT unified API.

**Tools (24):**
- Market data (tickers, order books, OHLCV)
- Order management (create, cancel, fetch)
- Balance and position queries
- Exchange-specific operations

**Integration value:**
- **Multi-exchange data** — supplement Binance US with data from Coinbase, Kraken, KuCoin
- **Arbitrage detection** — AI can compare prices across exchanges
- **Order execution** (future) — if the platform adds trading capability

**Setup:**
```bash
npx ccxt-mcp-server
```

**Risk:** Requires per-exchange API keys for trading. Market data is free on most exchanges.

### 4.3 mcp-avantage-server — Alpha Vantage (Medium Value)

**Description:** Full Alpha Vantage API wrapper. Stocks, forex, crypto, commodities, technical indicators, economic data.

**Integration value:**
- **Technical indicators** — RSI, MACD, Bollinger, etc. as supplementary context alongside SMC analysis
- **Economic calendar** — Fed meetings, NFP, CPI dates that impact SMC bias
- **Commodity data** — Gold (XAU), Oil correlations

**Setup:**
```bash
ALPHA_VANTAGE_API_KEY="your_key" npx mcp-avantage-server
```

**Cost:** Free tier: 25 API calls/day. Premium: $50/month for 75 calls/min.

### 4.4 TVControl — TradingView Desktop (Dev-Only)

**Description:** Controls TradingView Desktop via Chrome DevTools Protocol. 88 tools for chart reading, Pine Script, strategy backtesting.

**Integration value:**
- **Pine Script development** — AI can write, compile, and fix Pine Script indicators
- **Strategy optimization** — Cartesian product sweeps across symbols, timeframes, parameters
- **Chart vision** — AI can "see" charts and describe patterns

**Setup:**
```bash
# Requires TradingView Desktop with --remote-debugging-port=9222
npx @ferroxlabs/tvcontrol
```

**Risk:** Desktop-only, CDP-fragile, internal APIs change. **Not for production.**

### 4.5 Plug-and-Play Summary

| Server | Value | Cost | Production Ready | Setup Effort |
|---|---|---|---|---|
| **yfnhanced-mcp** | ⭐⭐⭐⭐⭐ | Free | ✅ Yes | `npx` one-liner |
| **CCXT MCP** | ⭐⭐⭐ | Free* | ✅ Yes | `npx` one-liner |
| **mcp-avantage** | ⭐⭐⭐ | Free tier | ✅ Yes | API key + `npx` |
| **TVControl** | ⭐⭐ | Free | ❌ Dev only | TradingView Desktop |

---

## 5. Custom SMC MCP Server Design

The highest-value MCP server is a **custom server that wraps our SMC engine**. This is where MCP directly improves the platform's core functionality.

### 5.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                SMC MCP Server (FastMCP)                      │
│                runs on same Express process, port 8080/mcp   │
│                                                             │
│  Tools (12):                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ analyze_structure(symbol, market, timeframe)         │   │
│  │   → StructureResult (pivots, BOS/CHoCH, bias, phase) │   │
│  │                                                      │   │
│  │ analyze_liquidity(symbol, market, timeframe)         │   │
│  │   → LiquidityResult (BSL/SSL pools, sweep prob)      │   │
│  │                                                      │   │
│  │ analyze_order_blocks(symbol, market, timeframe)      │   │
│  │   → OrderBlock[] (OBs, breakers, confidence)         │   │
│  │                                                      │   │
│  │ analyze_fvg(symbol, market, timeframe)               │   │
│  │   → FairValueGap[] (FVGs, fill fraction, inversion)  │   │
│  │                                                      │   │
│  │ analyze_pd_array(symbol, market, timeframe)          │   │
│  │   → PdArrayResult (premium/discount/equilibrium)     │   │
│  │                                                      │   │
│  │ get_daily_bias(symbol, market)                       │   │
│  │   → DailyBiasResult (HTF bias, strength, evidence)   │   │
│  │                                                      │   │
│  │ detect_smt(symbol1, symbol2, market, timeframe)     │   │
│  │   → SmtDivergence (detected, type, confidence)       │   │
│  │                                                      │   │
│  │ get_draw_targets(symbol, market, timeframe)          │   │
│  │   → DrawTarget[] (ranked price objectives)           │   │
│  │                                                      │   │
│  │ build_full_report(symbol, market, timeframe)         │   │
│  │   → SmcReport (complete SMC analysis, all modules)   │   │
│  │                                                      │   │
│  │ get_live_candles(symbol, market, timeframe)          │   │
│  │   → Candle[] (from candle-store, real-time)          │   │
│  │                                                      │   │
│  │ scan_all_timeframes(symbol, market)                  │   │
│  │   → Record<Timeframe, SmcReport> (full cascade)      │   │
│  │                                                      │   │
│  │ set_price_alert(symbol, price, condition)            │   │
│  │   → AlertConfirmation (future: alert system)         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Resources (4):                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ smc://candles/{market}/{symbol}/{timeframe}           │   │
│  │   → Candle[] (live, from candle-store)                │   │
│  │                                                      │   │
│  │ smc://report/{market}/{symbol}/{timeframe}            │   │
│  │   → SmcReport (cached, refreshed on candle close)    │   │
│  │                                                      │   │
│  │ smc://symbols/{market}                               │   │
│  │   → Symbol[] (supported trading pairs)               │   │
│  │                                                      │   │
│  │ smc://status                                        │   │
│  │   → SystemStatus (WS health, candle counts, clients) │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Prompts (3):                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ smc-analysis — "Analyze {symbol} on {timeframe}       │   │
│  │   using SMC methodology. Consider structure,          │   │
│  │   liquidity, OBs, FVGs, and daily bias."              │   │
│  │                                                      │   │
│  │ smc-multi-tf — "Perform a top-down multi-timeframe   │   │
│  │   analysis of {symbol} across {style} style."         │   │
│  │                                                      │   │
│  │ smc-sentiment — "Synthesize the current market       │   │
│  │   narrative for {symbol} on {timeframe}."             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Code Example: analyze_structure Tool

```typescript
// artifacts/mcp-server/src/tools/structure.ts
import { z } from "zod";
import { analyzeStructure } from "@workspace/api-server/src/lib/smc/structure.js";
import { candleStore } from "@workspace/api-server/src/lib/realtime/candle-store.js";

export function registerStructureTool(server: FastMCP) {
  server.addTool({
    name: "analyze_structure",
    description:
      "Analyze ICT market structure for a symbol. Detects swing pivots " +
      "(HH/HL/LH/LL), BOS/CHoCH breaks, trend direction, bias with confidence " +
      "score, and ICT market phase (accumulation/manipulation/expansion/" +
      "distribution/continuation).",
    parameters: z.object({
      symbol: z.string().describe("Trading symbol (e.g. BTCUSDT, EURUSD=X)"),
      market: z.enum(["crypto", "forex"]),
      timeframe: z.enum(["1m","5m","15m","1h","4h","1d","1w"]),
    }),
    execute: async ({ symbol, market, timeframe }) => {
      // Get candles from the real-time store (already populated by WS + backfill)
      const candles = candleStore.getCandles(symbol, timeframe);

      if (candles.length < 10) {
        return {
          content: [{
            type: "text",
            text: `Insufficient candle data for ${symbol} ${timeframe}. ` +
                  `Currently have ${candles.length} candles (minimum 10 required). ` +
                  `Try again in a few seconds as the WebSocket accumulates data.`,
          }],
        };
      }

      const result = analyzeStructure(candles, timeframe);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            symbol,
            market,
            timeframe,
            trend: result.trend,
            bias: result.bias,
            confidence: result.confidence,
            phase: result.phase,
            pivots: result.pivots.slice(-10),     // last 10 pivots
            breaks: result.breaks.slice(-8),       // last 8 breaks
            narrative: result.narrative,
            evidence: result.evidence,
          }, null, 2),
        }],
      };
    },
  });
}
```

### 5.3 Code Example: Live Candle Resource

```typescript
// artifacts/mcp-server/src/resources/candles.ts
import { ResourceTemplate } from "fastmcp";
import { candleStore } from "@workspace/api-server/src/lib/realtime/candle-store.js";

export function registerCandleResource(server: FastMCP) {
  server.addResource({
    uri: new ResourceTemplate("smc://candles/{market}/{symbol}/{timeframe}"),
    name: "Live Market Candles",
    description: "Real-time OHLCV candles from the WebSocket pipeline. " +
                 "Includes historical backfill + current forming candle.",
    mimeType: "application/json",
    async load(uri, { market, symbol, timeframe }) {
      const candles = candleStore.getCandles(
        symbol.toUpperCase(),
        timeframe,
      );

      return {
        text: JSON.stringify({
          symbol: symbol.toUpperCase(),
          market,
          timeframe,
          count: candles.length,
          firstCandle: candles[0] ?? null,
          lastCandle: candles[candles.length - 1] ?? null,
          candles, // full array
        }),
      };
    },
  });

  // Auto-complete: list available symbols for the resource template
  server.addResourceTemplateCompletion("smc://candles/{market}/{symbol}/{timeframe}", {
    async complete(uri, params) {
      if (!params.market) {
        return { values: ["crypto", "forex"] };
      }
      if (!params.symbol) {
        const symbols = candleStore.getActiveSymbols()
          .filter(s => params.market === "crypto" ? !s.includes("=") : s.includes("="));
        return { values: symbols };
      }
      if (!params.timeframe) {
        return { values: ["1m","5m","15m","1h","4h","1d","1w"] };
      }
      return { values: [] };
    },
  });
}
```

### 5.4 Server Startup (Integrated with Express)

```typescript
// artifacts/mcp-server/src/index.ts
import { FastMCP } from "fastmcp";
import { registerStructureTool } from "./tools/structure.js";
import { registerLiquidityTool } from "./tools/liquidity.js";
// ... other tool registrations
import { registerCandleResource } from "./resources/candles.js";
// ... other resource registrations

export function createSmcMcpServer(): FastMCP {
  const server = new FastMCP({
    name: "SMC Pulse Predict — Liquidity Hunter",
    version: "1.0.0",
    description:
      "ICT/SMC market analysis engine. Provides algorithmic detection of " +
      "institutional order flow concepts — Order Blocks, Fair Value Gaps, " +
      "BOS/CHoCH, liquidity pools, SMT divergence, and draw-on-liquidity targets.",
  });

  // Register tools
  registerStructureTool(server);
  registerLiquidityTool(server);
  registerOrderBlocksTool(server);
  registerFvgTool(server);
  registerPdArrayTool(server);
  registerDailyBiasTool(server);
  registerSmtTool(server);
  registerDrawTargetsTool(server);
  registerFullReportTool(server);
  registerLiveCandlesTool(server);
  registerScanAllTimeframesTool(server);
  registerSetAlertTool(server);

  // Register resources
  registerCandleResource(server);
  registerReportResource(server);
  registerSymbolsResource(server);
  registerStatusResource(server);

  // Register prompts
  registerSmcAnalysisPrompt(server);
  registerMultiTfPrompt(server);
  registerSentimentPrompt(server);

  return server;
}
```

### 5.5 Mounting on Express (Shared Process)

```typescript
// In artifacts/api-server/src/app.ts or a new mcp-app.ts

import express from "express";
import { createSmcMcpServer } from "@workspace/mcp-server";

const mcpServer = createSmcMcpServer();

// Mount MCP on the same Express instance as our REST API
// FastMCP's httpStream transport can share port 8080
await mcpServer.start({
  transportType: "httpStream",
  httpStream: {
    // FastMCP adds /mcp and /sse endpoints to the Express app
    endpoint: "/api/mcp",
  },
});
```

**Result:** The MCP server runs in-process with the Express API, sharing the same port. Clients connect to `http://localhost:8080/api/mcp` for MCP tool calls.

---

## 6. Integration Architecture

### 6.1 Full System with MCP

```
┌──────────────────────────────────────────────────────────────────┐
│                        BROWSER                                    │
│  Dashboard │ ChartView │ AgentChat │ AgentPipeline               │
│  (TanStack Query + useRealtimeStream SSE)                        │
└────────────┬─────────────────────────────────────────────────────┘
             │ REST + SSE (existing, unchanged)
             │
┌────────────▼─────────────────────────────────────────────────────┐
│                   EXPRESS 5 (port 8080)                           │
│                                                                   │
│  /api/analysis/*     /api/agents/*     /api/stream/*             │
│  (existing REST)     (existing AI)     (existing SSE)            │
│                                                                   │
│  /api/mcp  ←── NEW: FastMCP HTTP Stream endpoint                 │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  SMC MCP Server (in-process)                              │    │
│  │  Tools (12) │ Resources (4) │ Prompts (3)                │    │
│  │                                                          │    │
│  │  Shares: candleStore, sseManager, SMC engine modules     │    │
│  │  Adds: tool-call logging, retry, circuit breaker         │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
             │
             │ MCP protocol (tool calls)
             │
┌────────────▼─────────────────────────────────────────────────────┐
│                     AI CLIENTS                                    │
│                                                                   │
│  Claude Desktop ──► MCP client ──► /api/mcp                      │
│  Claude Code    ──► MCP client ──► /api/mcp                      │
│  Cursor/Copilot ──► MCP client ──► /api/mcp                      │
│  Fireworks AI   ──► Tool use    ──► /api/mcp (via Express proxy) │
│  Custom GPT     ──► Function calling ──► /api/mcp                │
└──────────────────────────────────────────────────────────────────┘

OPTIONAL: Supplementary MCP Servers (separate processes)
┌──────────────────────────────────────────────────────────────────┐
│  yfnhanced-mcp    (Yahoo Finance data, free, no key)             │
│  ccxt-mcp-server  (Multi-exchange crypto, free market data)      │
│  mcp-avantage     (Alpha Vantage, free tier)                     │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Data Flow: MCP-Aware AI Query

```
User: "What's the BTCUSDT structure on 4h, and where's the nearest liquidity?"
  │
  ▼
AI Client (Claude/GPT/Fireworks)
  │  1. Calls analyze_structure("BTCUSDT", "crypto", "4h")
  │     → MCP server → candleStore.getCandles() → SMC engine
  │     ← { bias: "bearish", confidence: 0.72, phase: "expansion", ... }
  │
  │  2. Calls analyze_liquidity("BTCUSDT", "crypto", "4h")
  │     → MCP server → candleStore.getCandles() → SMC engine
  │     ← { nearestBSL: {price: 65549, score: 0.81},
  │          nearestSSL: {price: 59093, score: 0.94, probSweep: 0.71} }
  │
  │  3. AI synthesizes: "BTCUSDT 4h is bearish (72% confidence, expansion phase).
  │     SSL at 59,093 has a 71% probability of being swept and sits just below
  │     current price. This is the most likely draw on liquidity."
  │
  ▼
Response to user (specific, grounded in live data, ~500 tokens total)
```

### 6.3 AgentChat MCP Integration

The existing `POST /api/agents/ask` endpoint can be upgraded to use MCP tools:

```typescript
// routes/agents.ts — new MCP-aware endpoint
router.post("/agents/ask-mcp", async (req, res) => {
  const { question, history = [] } = req.body;

  // Lightweight system prompt (~200 tokens vs current 3K)
  const systemPrompt = `You are an SMC analyst with access to market analysis tools.
    Use the tools to fetch live data. Never guess — always call the appropriate tool.
    Available: analyze_structure, analyze_liquidity, analyze_order_blocks,
    analyze_fvg, analyze_pd_array, get_daily_bias, detect_smt,
    get_draw_targets, build_full_report, get_live_candles.`;

  // Use Fireworks AI with tool definitions
  const response = await fetch(`${FIREWORKS_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: FIREWORKS_MODEL,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.slice(-8),
        { role: "user", content: question },
      ],
      tools: MCP_TOOLS_AS_OPENAI_FORMAT, // Convert MCP tools to OpenAI format
      tool_choice: "auto",
    }),
  });

  // Handle tool calls by routing to MCP server, returning results to AI
  // Stream the final response to the browser
});
```

---

## 7. Phase 1: Proof of Concept

### Goal

A working MCP server with 2 tools (`analyze_structure`, `analyze_liquidity`) + 1 resource (`smc://candles`) running in-process with the Express server. Connectable from Claude Desktop or Claude Code.

### Files (New Package)

```
artifacts/mcp-server/
├── package.json              # @workspace/mcp-server
├── tsconfig.json
├── build.mjs                 # esbuild bundler
├── src/
│   ├── index.ts              # createSmcMcpServer() factory
│   ├── tools/
│   │   ├── index.ts
│   │   ├── structure.ts       # analyze_structure tool
│   │   └── liquidity.ts       # analyze_liquidity tool
│   ├── resources/
│   │   ├── index.ts
│   │   └── candles.ts         # smc://candles resource
│   └── lib/
│       ├── logger.ts          # Tool-call structured logger
│       └── metrics.ts         # Per-tool timing/error metrics
└── tests/
    ├── tools/
    │   ├── structure.test.ts
    │   └── liquidity.test.ts
    └── fixtures/
        └── btc-4h-candles.json
```

### MCP Client Configuration (Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "smc-pulse-predict": {
      "type": "http",
      "url": "http://localhost:8080/api/mcp"
    }
  }
}
```

### Success Criteria

1. ✅ `analyze_structure` returns valid StructureResult from live candle-store data
2. ✅ `analyze_liquidity` returns LiquidityResult with BSL/SSL pools
3. ✅ `smc://candles` resource returns candles from the real-time store
4. ✅ Tool calls are logged with timing and error codes
5. ✅ Claude Desktop can connect and call tools
6. ✅ No regression: existing REST, SSE, and WebSocket continue working

### Effort: 2–3 days

---

## 8. Phase 2: Full SMC Tool Suite

### Goal

All 12 tools + 4 resources + 3 prompts. MCP-aware AgentChat endpoint. Frontend tool-call cards.

### New Files

```
artifacts/mcp-server/src/
├── tools/
│   ├── order-blocks.ts
│   ├── fvg.ts
│   ├── pd-array.ts
│   ├── daily-bias.ts
│   ├── smt.ts
│   ├── draw-targets.ts
│   ├── full-report.ts        # Composite: runs all 8 modules
│   ├── live-candles.ts       # Direct candle-store access
│   ├── scan-all-timeframes.ts # Multi-TF cascade
│   └── set-alert.ts          # In-memory price alerts
├── resources/
│   ├── report.ts
│   ├── symbols.ts
│   └── status.ts
└── prompts/
    ├── smc-analysis.ts
    ├── multi-tf.ts
    └── sentiment.ts

Modified:
  artifacts/api-server/src/routes/agents.ts  ← Add /agents/ask-mcp endpoint
  artifacts/liquidity-hunter/src/components/
    ├── AgentChat.tsx        ← Tool call card rendering
    └── AgentPipeline.tsx    ← MCP-aware pipeline mode
```

### Effort: 1–2 weeks

---

## 9. Phase 3: Multi-Provider AI + Actions

### Goal

Provider-agnostic AI with persistent alerts, backtesting, and strategy optimization.

### Features

- **Multi-provider AI** — switch between Claude, GPT, Fireworks, or local models without code changes
- **Price alert system** — AI sets alerts via `set_price_alert`, server monitors via candle-store, pushes notifications via SSE
- **Pattern backtesting** — AI can define a setup, run it through historical candles, get win rate + expectancy
- **Trade journal** — AI logs setups, tracks outcomes, learns from results
- **Supplementary MCP integration** — yfnhanced-mcp for fundamentals, CCXT for multi-exchange data

### Effort: 2–4 weeks

---

## 10. Recommendation & Next Steps

### Immediate: Install FastMCP and Build PoC

```bash
# 1. Install FastMCP in the monorepo
pnpm add fastmcp --filter @workspace/api-server

# 2. Create the MCP server package
mkdir -p artifacts/mcp-server/src/{tools,resources,lib}
mkdir -p artifacts/mcp-server/tests/fixtures

# 3. Implement Phase 1 (2 tools, 1 resource, 2 days)
```

### Why FastMCP Over Raw SDK

| Factor | Raw @modelcontextprotocol/sdk | FastMCP |
|---|---|---|
| Boilerplate per tool | ~40 lines | ~15 lines |
| HTTP transport setup | Manual Express wiring | `server.start({ transportType: "httpStream" })` |
| Zod integration | Manual schema conversion | Native `parameters: z.object({...})` |
| Session management | Manual | Built-in `context.session` |
| Streaming tool output | Manual | `streamingHint: true` |
| Authentication | Manual | `authenticate` callback |
| TypeScript types | Complex generics | Clean, inferred types |

### Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| FastMCP API changes (pre-1.0) | Medium | Pin version, wrap in factory function |
| MCP tools expose internal data | Low | Zod validation, no sensitive data in tool output |
| Performance overhead | Low | In-process (no IPC), tools call existing functions directly |
| Breaking existing REST/SSE | Low | MCP on separate endpoint `/api/mcp`, no shared mutation |

### What Stays Unchanged

- REST API (`/api/analysis/*`, `/api/agents/*`, `/api/stream/*`)
- WebSocket pipeline (Binance, Finnhub/Yahoo)
- Candle store, SSE manager, analysis bridge
- Dashboard, ChartView, AgentChat, AgentPipeline
- All existing documentation

MCP is **purely additive** — it exposes the existing infrastructure through a standard protocol without modifying any of the current data flows.

---

## Appendix: Quick Reference

### FastMCP Tool Pattern

```typescript
server.addTool({
  name: "tool_name",              // snake_case
  description: "What it does",
  parameters: z.object({ ... }),  // Zod schema
  execute: async (args) => {      // Return string or content array
    return { content: [{ type: "text", text: result }] };
  },
});
```

### FastMCP Resource Pattern

```typescript
server.addResource({
  uri: new ResourceTemplate("protocol://{param1}/{param2}"),
  name: "Resource Name",
  description: "What it provides",
  mimeType: "application/json",
  async load(uri, params) {
    return { text: JSON.stringify(data) };
  },
});
```

### Claude Desktop Config

```json
{
  "mcpServers": {
    "smc-pulse-predict": {
      "type": "http",
      "url": "http://localhost:8080/api/mcp"
    }
  }
}
```

### Cursor / Claude Code Config

```json
{
  "mcpServers": {
    "smc-pulse-predict": {
      "url": "http://localhost:8080/api/mcp",
      "transport": "http"
    }
  }
}
```
