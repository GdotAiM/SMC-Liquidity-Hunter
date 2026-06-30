# MCP Chat — Full Capabilities Reference

> **Date:** 2026-06-30
> **Status:** ✅ Complete and verified
> **Framework:** FastMCP v4.3.2
> **Model:** DeepSeek V4 Pro (Fireworks AI)
> **Related:** [`MCP_TIER3_IMPLEMENTATION.md`](../MCP_TIER3_IMPLEMENTATION.md) | [`MCP_EXPLORATION_REPORT.md`](../MCP_EXPLORATION_REPORT.md)

---

## Architecture

```
Frontend (AgentChat.tsx)                    Backend (agents-mcp.ts)
┌─────────────────────────┐                ┌──────────────────────────────┐
│ MCP Toggle (default ON) │─── POST ──────▶│ POST /api/agents/ask-mcp    │
│ Dashboard context       │  {question,    │                              │
│ (symbol, tf, price)     │   history,     │ buildMcpSystemPrompt(ctx)    │
│ Tool call cards          │   context}     │   ↓                          │
│ (Wrench icon, spinner,  │                │ Fireworks AI (DeepSeek V4)   │
│  green "done" badge)     │◀──── SSE ─────│   ↓                          │
└─────────────────────────┘                │ Agent Loop (up to 3 rounds)  │
                                           │   → AI calls tools           │
                                           │   → Tool registry executes   │
                                           │   → Results fed back to AI   │
                                           │   → AI synthesizes response  │
                                           └──────────────────────────────┘
```

### SSE Protocol

| Event | Direction | Description |
|---|---|---|
| `{ content: "..." }` | Server → Browser | Token delta from AI response |
| `{ tool_start: "name" }` | Server → Browser | Tool call initiated |
| `{ tool_result: "name", content: "..." }` | Server → Browser | Tool execution result (first 200 chars) |
| `{ done: true }` | Server → Browser | Agent loop complete |

---

## 11 Analysis Tools

Every tool reads **live data** from the WebSocket pipeline (Binance for crypto, Finnhub WS + Yahoo REST for forex). No stale data, no guesses.

### Structure & Bias

| Tool | What it does | Key outputs |
|---|---|---|
| `analyze_structure` | Detects swing pivots (HH/HL/LH/LL), BOS/CHoCH breaks, trend direction, bias, market phase | `trend`, `bias`, `confidence` (0-1), `phase` (accumulation/manipulation/expansion/distribution/continuation), `pivots[]`, `breaks[]`, `narrative`, `evidence[]` |
| `get_daily_bias` | Computes HTF bias on daily candles using structure-primary detection with SMA(20) fallback | `bias`, `strength` (0-1), `consecutiveDays`, `referencedSwing`, `evidence[]` |
| `scan_all_timeframes` | Runs full SMC analysis across all 7 timeframes (M1→W1) | Per-TF: `bias`, `confidence`, alignment summary |

### Liquidity & Order Flow

| Tool | What it does | Key outputs |
|---|---|---|
| `analyze_liquidity` | Scans swing pivots for BSL/SSL pools, EQH/EQL clusters. Scores by touches, session, and probability of sweep | `nearestBSL` (price, score, probSweep), `nearestSSL` (price, score, probSweep), `activePools[]` (9+ pools with type, price, touches, session, swept status) |
| `analyze_order_blocks` | Detects institutional OBs and breaker blocks — last opposite-direction candle before displacement. Confidence scored by bias alignment, FVG confluence, mitigation status, displacement strength | `activeOBs[]` (type, proximal→distal range, confidence 0-1, isBreaker, hasFvg, factors[]) |
| `get_draw_targets` | Ranks draw-on-liquidity targets by proximity, bias alignment, and confluence. Combines liquidity + OB + FVG data | `targets[]` (type, price, direction, score, label, evidence[]) — top 5 ranked |

### Price Action

| Tool | What it does | Key outputs |
|---|---|---|
| `analyze_fvg` | Detects 3-candle imbalance gaps. Tracks fill fraction (0-1), identifies inversions | `gaps[]` (type, top, bottom, fillFraction, isInversion) |
| `analyze_pd_array` | Identifies dealing range, equilibrium, and premium/discount zones using recent session + swing ranges | `currentBias` (premium/discount/EQ), `equilibrium`, `zones[]`, `dealingRange` |

### Multi-Symbol

| Tool | What it does | Key outputs |
|---|---|---|
| `detect_smt` | Detects Smart Money Technique divergence — when correlated symbol makes opposing high/low. Requires primary + correlated symbol | `detected` (bool), `type` (bullish/bearish), `confidence` (0-1) |

### Composite & Raw Data

| Tool | What it does | Key outputs |
|---|---|---|
| `build_full_report` | Runs all 8 SMC dimensions in one call. Returns complete `SmcReport` | Full report with structure, liquidity, OBs, FVGs, PD array, daily bias, SMT, draw targets — all nested |
| `get_live_candles` | Returns raw OHLCV from the real-time WebSocket pipeline. Includes historical backfill (up to 300) + current forming candle | `candles[]` (time, open, high, low, close, volume) |

---

## Supported Markets

| Market | Symbols | Data source |
|---|---|---|
| **Crypto** | BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, AVAXUSDT, DOTUSDT, LINKUSDT | Binance WebSocket (real-time ticks + klines) |
| **Forex** | EURUSD=X, GBPUSD=X, USDJPY=X, AUDUSD=X, USDCAD=X, USDCHF=X, NZDUSD=X, EURJPY=X, GBPJPY=X, XAUUSD=X (Gold) | Finnhub WS (1m ticks) + Yahoo REST (all TFs) |

## Supported Timeframes

All 7 across both markets: **1m, 5m, 15m, 1h, 4h, 1d, 1w**

---

## MCP Resources (for external MCP clients)

| URI | Description |
|---|---|
| `smc://candles/{market}/{symbol}/{timeframe}` | Live OHLCV candles with auto-complete for all params |
| `smc://status` | Real-time system status: SSE clients, candle store stats, active symbols |

## MCP Prompt Template

`smsc-analysis` — A reusable 6-step ICT/SMC analysis prompt that instructs the AI to:

1. Call `analyze_structure` — determine who controls the market, bias, confidence, phase
2. Call `analyze_liquidity` — identify BSL/SSL, which is more likely to be hunted
3. Call `analyze_order_blocks` — note unmitigated OBs and breaker blocks near price
4. Call `analyze_fvg` — identify unfilled gaps seeking rebalance
5. Call `get_daily_bias` — check HTF bias alignment
6. Synthesize — highest-probability draw, confirmation signals, invalidation conditions

Accepts `symbol` (required) and `timeframe` (optional, defaults to 4h).

---

## Dashboard Context Awareness

When the `AgentChat` component has a report loaded (user is viewing a market on the dashboard), the chat **automatically knows**:

| Context passed | Example |
|---|---|
| `symbol` | BTCUSDT |
| `timeframe` | 4h |
| `currentPrice` | 58,294 |

This means:

- *"Where are institutions sitting?"* → AI defaults to current symbol/timeframe, calls tools immediately
- *"What's the bias?"* → Analyzes the viewed pair without the user specifying
- *"Compare with ETH"* → Can cross-reference while keeping current pair as primary

**Without context** (e.g., no report loaded), the AI asks for symbol/timeframe — a graceful fallback.

---

## Agent Loop Behavior

| Property | Value |
|---|---|
| Max tool-calling rounds | 3 (prevents infinite loops) |
| Max tokens per round | 4,096 |
| Tool execution latency | <50ms (direct function call, no IPC) |
| Parallel tool calls | Supported — AI can batch 5+ tools in one round |
| Error handling | Per-tool: errors return `{ error: "..." }`, AI can retry or use fallback |
| Data freshness | Live from WebSocket pipeline (crypto: <100ms, forex 1m: <1s via Finnhub WS) |

---

## System Prompt Design

```
CRITICAL RULES:
1. CALL TOOLS FIRST — do not explain what you're planning, just do it.
2. If a tool returns insufficient data, immediately try another timeframe
   without narrating the fallback plan.
3. When you need multiple data points (bias + liquidity + targets),
   call all needed tools in a single parallel batch.
4. Only describe your approach AFTER you have the data.

Always cite specific price levels from tool results. Do not give
financial advice or buy/sell signals. Synthesize in 3-6 sentences.
```

---

## Token Efficiency

| Scenario | Classic endpoint | MCP endpoint | Savings |
|---|---|---|---|
| "What's the structure?" | ~3,000 tokens | ~1,000 tokens | **3×** |
| "Where's liquidity?" | ~3,000 tokens | ~800 tokens | **3.75×** |
| Multi-tool chain | Not possible | ~3,000 tokens | **New capability** |
| "Analyze across 2 TFs" | Not possible | ~2,000 tokens | **New capability** |
| 5-turn conversation | ~15,000 tokens (5 × 3K) | ~3,000 tokens (tools + synthesis) | **5×** |

---

## Frontend UX

| Feature | Detail |
|---|---|
| **MCP toggle** | Green toggle-right in AgentChat header — on by default |
| **Tool call cards** | Inline cards showing tool name with Wrench icon, spinner while running, green "done" badge + result preview (first 200 chars) when complete |
| **Streaming** | Token-by-token SSE streaming for AI response text, separate events for tool lifecycle |
| **Classic fallback** | Toggle off → uses monolithic 3K-token prompt with full SmcReport (original behavior, unchanged) |
| **Suggested questions** | 6 pre-written prompts (Can be asked regardless of toggle state) |

---

## Key Files

| File | Purpose |
|---|---|
| `artifacts/api-server/src/routes/agents-mcp.ts` | MCP-aware agent endpoint with tool-calling loop |
| `artifacts/api-server/src/lib/mcp/tool-registry.ts` | Direct function registry (tool name → execute function) |
| `artifacts/api-server/src/lib/mcp/tools/*.ts` | 11 SMC analysis tool implementations |
| `artifacts/api-server/src/lib/mcp/resources/*.ts` | 2 MCP resources (candles, status) |
| `artifacts/api-server/src/lib/mcp/prompts/*.ts` | 1 MCP prompt template (smc-analysis) |
| `artifacts/api-server/src/lib/mcp/server.ts` | FastMCP server factory |
| `artifacts/liquidity-hunter/src/components/AgentChat.tsx` | Frontend with MCP toggle, tool call cards, dashboard context |
| `artifacts/liquidity-hunter/src/lib/api.ts` | API client with `askAgentsMcp()` and SSE event types |

---

## Limitations & Design Choices

- **No trading execution** — Read-only analysis. No order placement, no account access.
- **No financial advice** — System prompt explicitly prohibits buy/sell signals.
- **3-round max** — Prevents runaway loops. AI must synthesize within 3 tool-calling rounds.
- **DeepSeek V4 Pro only** — Single model via Fireworks AI. Multi-provider support is a future phase.
- **In-memory only** — No persistent chat history across sessions. Tool results live in the request scope.
- **No Pine Script** — SMC analysis only. Traditional indicators (RSI, MACD) are not available.
- **20 crypto + forex pairs** — The supported symbol set. Arbitrary symbols won't have WebSocket data.

---

## Future Phases

| Phase | Scope |
|---|---|
| **Phase 4: Multi-Provider** | Claude, GPT, Llama support — provider-agnostic tool calling |
| **Phase 5: Actions** | Price alerts, pattern backtesting, trade journal |
| **Phase 6: External MCP** | Full FastMCP HTTP transport for Claude Desktop / Cursor integration |
