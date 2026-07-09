# SMC Pulse Predict — Liquidity Hunter

> **Real-time ICT/SMC market intelligence for crypto and forex traders.**
> A full-stack web application that algorithmically detects institutional order flow concepts — Order Blocks, Fair Value Gaps, BOS/CHoCH, liquidity pools, and SMT divergence — and surfaces them through a multi-timeframe dashboard with an embedded AI analyst.

---

## Vision

Most retail traders lose because they see charts the wrong way. Institutions don't buy at support and sell at resistance — they hunt liquidity, create imbalance, and deliver price into equilibrium. SMC Pulse Predict translates the Inner Circle Trader (ICT) methodology into a live, automated analysis engine that processes OHLCV data and produces the same read a trained SMC analyst would perform manually, in seconds, across every timeframe simultaneously.

---

## Key Features

| Feature | Description |
|---|---|
| **Multi-TF Dashboard** | Scalp / Intraday / Swing / All modes with cascade bias computation across 7 timeframes |
| **ICT Structure Engine** | ATR-normalised pivot detection → BOS / CHoCH classification → phase inference (Accumulation → Manipulation → Expansion) |
| **Liquidity Hunter** | BSL / SSL / Equal Highs / Equal Lows pool detection with session-weighted scoring and probability-of-sweep |
| **Order Block Detection** | Bullish & bearish OBs with breaker block classification, FVG confluence, and institutional confidence scoring |
| **Fair Value Gap Engine** | FVG detection with fill-fraction tracking and inversion FVG identification |
| **PD Array** | Premium / Discount / Equilibrium zone computation from dealing range |
| **Daily Bias** | HTF 1D structure-primary bias (0.55–0.88 strength) used to gate lower-TF OB confidence |
| **SMT Divergence** | Correlated-pair divergence detection (BTC/ETH, EUR/GBP) with magnitude + timing scoring |
| **Draw on Liquidity** | Confluence-boosted target scoring that ranks BSL/SSL/OB/FVG as next price objectives |
| **Visual Chart Layer** | TradingView Lightweight Charts (v5) with session backgrounds, OB/FVG rectangles, BOS/CHoCH markers, KZO lines |
| **AI Agent System** | Fireworks AI (DeepSeek V4 Pro) — streaming Q&A + 4-agent sequential analysis pipeline + MCP tool-calling agent (11 autonomous tools) |
| **MCP Tier 3** | FastMCP v4.3.2 server on port 3002 — 11 SMC tools, 2 resources, 1 prompt for external AI agent access |
| **Broker Execution** | Broker-agnostic trade execution with REVIEW/LIVE mode toggle, Alpaca Paper API adapter, file-based mock broker |
| **Broker Dashboard** | `/broker` page — account overview, open orders table, mode switch with typed-LIVE confirmation, execution log |
| **Market Narrative** | Auto-generated institutional narrative string per report |
| **Session State** | Real-time ICT session inference: Asian Range / London Expansion / NY Open / PM Distribution |
| **Real-Time Price Feed** | Binance US WebSocket (crypto) + Finnhub WS / Yahoo polling (forex) with SSE push to browser |
| **Live Price Badge** | Green pulsing indicator when real-time stream is connected, price updates in real-time |
| **60s Cache** | In-memory TTL cache prevents repeated data-provider hits on dashboard refresh |
| **Auto Candle-Close Refresh** | Server rebuilds SMC reports on candle close and pushes to browser — no polling needed |

---

## Screenshots

> _Open the app and hit the **CHART** button to see the visual layer._

| Intelligence Dashboard | Chart View |
|---|---|
| Multi-TF cascade with confluence card | Candlesticks + OB/FVG/session overlays |

---

## Demo

Run locally (see Installation below) then visit `http://localhost:5173`.

- Select **CRYPTO** → **BTC/USDT** → **INTRADAY**
- View the cascade: H4 sets direction, H1 confirms, M15 triggers
- Tap any card → **Intelligence Sheet** for deep analysis
- Tap **CHART** for the visual chart with SMC overlays
- Tap **SMT** on any card → AI agent pipeline fires
- Visit `/broker` for the broker dashboard — account balance, open orders, LIVE/REVIEW mode switch
- Visit `/analytics` for trade ledger, performance matrix, and signal generation

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    React Frontend                         │
│  Dashboard → ConfluenceCard → IntelligenceSheet          │
│             ChartView (Lightweight Charts v5)             │
│             AgentChat + AgentPipeline (SSE)              │
│             useRealtimeStream (SSE live prices + candles) │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP REST + SSE (dual channel)
┌──────────────────────▼───────────────────────────────────┐
│                Express 5 API Server                       │
│  /api/analysis/crypto|forex    /api/agents/ask|pipeline  │
│  /api/stream/:symbol (SSE)     /api/stream/status        │
│  /api/broker/mode|status       /api/account              │
│  /api/ledger                   /api/signals/*            │
│  60s in-memory TTL cache                                 │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Real-Time Pipeline                               │    │
│  │  binance-ws.ts → candle-store → sse-manager      │    │
│  │  forex-ws.ts   →     ↓          → analysis-bridge│    │
│  │                → candleClosed  → buildReport     │    │
│  │                                 → cache + SSE push│    │
│  ├──────────────────────────────────────────────────┤    │
│  │ Execution Layer                                   │    │
│  │  ExecutionManager → MockBrokerAdapter (file)      │    │
│  │                   → AlpacaAdapter (paper API)     │    │
│  │  SignalGenerator → TradeLedgerService (PG)        │    │
│  └──────────────────────────────────────────────────┘    │
└──────┬──────────────────────────────┬────────────────────┘
       │                              │
┌──────▼──────────┐  ┌────────────────▼────────────┐
│  Binance US WS  │  │  Finnhub WS / Yahoo poll    │
│  + REST API     │  │  + REST API                 │
│  (Crypto)       │  │  (Forex)                    │
└─────────────────┘  └─────────────────────────────┘
```

---

## Technology Stack

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript 5 |
| Framework | Express 5 |
| Logger | Pino (JSON structured logging) |
| Data (Crypto) | Binance REST + WebSocket (no key required) |
| Data (Forex) | Yahoo Finance REST + Finnhub WebSocket (optional) |
| AI | Fireworks AI — DeepSeek V4 Pro (SSE streaming) + multi-provider abstraction (AMD/vLLM, OpenAI, custom) |
| MCP | FastMCP v4.3.2 on port 3002 — 11 tools, 2 resources, 1 prompt |
| Execution | BrokerAdapter interface — MockBroker (file-based) + AlpacaAdapter (paper API) |
| Database | PostgreSQL via Drizzle ORM (optional — server runs without it) |
| Cache | In-process Map, 60s TTL |

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Data Fetching | TanStack Query v5 |
| Charts | TradingView Lightweight Charts v5 |
| Animations | Framer Motion |
| Router | Wouter |

### Monorepo
| Package | Purpose |
|---|---|
| `artifacts/api-server` | Backend Express server |
| `artifacts/liquidity-hunter` | Frontend React SPA |
| `lib/api-client-react` | TanStack Query hooks (manually maintained) |
| `lib/api-spec` | OpenAPI 3.1 spec |
| `lib/api-zod` | Zod schemas |
| `lib/db` | Drizzle ORM — trades + performance matrix tables |
| `deploy/amd-developer-cloud` | AMD MI300X deployment (Docker Compose + vLLM + Gemma 4) |

---

## AI Pipeline Overview

```
User taps "SMT" button
        ↓
POST /api/agents/pipeline { report: SmcReport }
        ↓
System prompt built from live SmcReport data
(price, structure, liquidity map, OBs, FVGs, SMT, draw targets)
        ↓
Sequential agent loop (SSE streaming):
  1. Structure Agent   → market structure narrative
  2. Liquidity Agent   → BSL/SSL hunt probability
  3. FVG Agent         → rebalance vs continuation gaps
  4. Confluence Agent  → final synthesis + invalidation level
        ↓
Frontend streams each agent token-by-token into AgentPipeline panel
```

Also supports: `POST /api/agents/ask` — single-turn Q&A with full report context and conversation history (last 8 turns).

---

## ICT/SMC Concepts Implemented

- Market Structure (Pivots: HH / HL / LH / LL)
- Break of Structure (BOS)
- Change of Character (CHoCH / MSS)
- Market Phase: Accumulation → Manipulation → Expansion → Distribution → Continuation
- Buy-Side Liquidity (BSL) — Equal Highs, prior session highs
- Sell-Side Liquidity (SSL) — Equal Lows, prior session lows
- Probability of Sweep scoring per liquidity pool
- Order Blocks (Bullish / Bearish)
- Breaker Blocks (mitigated OBs that flip polarity)
- Fair Value Gaps (FVG)
- Inversion FVG
- Premium / Discount / Equilibrium (PD Array)
- Dealing Range
- Daily Bias (HTF anchor)
- SMT Divergence (correlated pair)
- Draw on Liquidity (DOL) — scored target engine
- Session analysis: Asian Range / London / NY AM / NY PM / PM Distribution
- KZO (Key Zone — OB proximal line)

---

## Project Structure

```
workspace/
├── artifacts/
│   ├── api-server/              # Express backend
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── smc/         # ICT engine (core algorithms)
│   │       │   │   ├── config.ts
│   │       │   │   ├── types.ts
│   │       │   │   ├── structure.ts
│   │       │   │   ├── structure.test.ts
│   │       │   │   ├── liquidity.ts
│   │       │   │   ├── liquidity.test.ts
│   │       │   │   ├── order-blocks.ts
│   │       │   │   ├── order-blocks.test.ts
│   │       │   │   ├── fvg.ts
│   │       │   │   ├── fvg.test.ts
│   │       │   │   ├── pd-array.ts
│   │       │   │   ├── pd-array.test.ts
│   │       │   │   ├── daily-bias.ts
│   │       │   │   ├── daily-bias.test.ts
│   │       │   │   ├── smt.ts
│   │       │   │   ├── smt.test.ts
│   │       │   │   └── report.ts
│   │       │   ├── fetchers/    # Market data
│   │       │   │   ├── binance.ts
│   │       │   │   └── yahoo.ts
│   │       │   └── realtime/    # Real-time infrastructure
│   │       │       ├── binance-ws.ts
│   │       │       ├── forex-ws.ts
│   │       │       ├── candle-store.ts
│   │       │       ├── sse-manager.ts
│   │       │       └── analysis-bridge.ts
│   │       │   ├── execution/     # Broker execution layer
│   │       │   │   ├── BrokerAbstraction.ts
│   │       │   │   └── AlpacaAdapter.ts
│   │       │   └── mcp/           # MCP server (FastMCP v4.3)
│   │       └── routes/          # API endpoints
│   │           ├── analysis.ts
│   │           ├── agents.ts
│   │           ├── agents-mcp.ts
│   │           ├── stream.ts
│   │           ├── ledger.ts     # Trading + broker
│   │           ├── symbols.ts
│   │           └── health.ts
│   └── liquidity-hunter/        # React frontend
│       └── src/
│           ├── pages/
│           │   ├── dashboard.tsx
│           │   ├── Analytics.tsx
│           │   └── Broker.tsx
│           └── components/
│               ├── IntelligenceSheet.tsx
│               ├── ConfluenceCard.tsx
│               ├── ConfluenceSheet.tsx
│               ├── ChartView.tsx
│               ├── AgentChat.tsx
│               ├── AgentPipeline.tsx
│               ├── TradeLedgerDashboard.tsx
│               └── SignalDetailSheet.tsx
├── lib/
│   ├── api-spec/                # OpenAPI 3.1 definition
│   ├── api-client-react/        # TanStack Query hooks
│   └── api-zod/                 # Zod schemas
└── pnpm-workspace.yaml
```

---

## Installation

### Prerequisites
- Node.js ≥ 20
- pnpm ≥ 9

```bash
git clone <repo-url>
cd workspace
pnpm install
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `FIREWORKS_API_KEY` | Yes | Fireworks AI key for the analyst agent. Get one free at https://fireworks.ai |
| `FINNHUB_API_KEY` | No | Finnhub API key for forex real-time WebSocket. Without it, Yahoo polling is used as fallback (free, no key). Get one free at https://finnhub.io |
| `ALPACA_API_KEY_ID` | No | Alpaca Paper Trading API key ID. Set both this and the secret to enable live paper-trading execution through AlpacaAdapter. Without them, the server uses MockBrokerAdapter (file-based, no real orders) |
| `ALPACA_API_SECRET_KEY` | No | Alpaca Paper Trading API secret key |
| `DATABASE_URL` | No | PostgreSQL connection string for persistent trade ledger + performance matrix. Server runs without it (ledger and matrix endpoints return empty) |

Set via your platform's secrets manager or `.env` at the repo root.

---

## Running Locally

```bash
# Start API server (port 3001 by default)
pnpm --filter @workspace/api-server run dev

# Start frontend (port 5173 by default)
pnpm --filter @workspace/liquidity-hunter run dev
```

Then open `http://localhost:5173`.

---

## Example API Request

```bash
# Crypto analysis — BTC/USDT 4h with ETH/USDT correlation
curl "http://localhost:3001/api/analysis/crypto?symbol=BTCUSDT&timeframe=4h&correlatedSymbol=ETHUSDT"

# Forex analysis — EUR/USD 1h
curl "http://localhost:3001/api/analysis/forex?symbol=EURUSD=X&timeframe=1h"

# Real-time stream — BTC/USDT 1m candles (SSE)
curl -N "http://localhost:3001/api/stream/BTCUSDT?timeframes=1m,5m,15m"

# Stream status — active symbols and candle counts
curl "http://localhost:3001/api/stream/status"
```

---

## Example API Response (abbreviated)

```json
{
  "symbol": "BTCUSDT",
  "market": "crypto",
  "timeframe": "4h",
  "currentPrice": 59740.37,
  "narrative": "Daily bearish. BOS bearish confirmed. Price in premium zone. Nearest objective: SSL at 59,094.",
  "sessionState": "Asian Range Formation",
  "structure": {
    "bias": "bearish",
    "phase": "expansion",
    "confidence": 0.72,
    "evidence": ["2 BOS bearish", "CHoCH at 61,200"]
  },
  "liquidity": {
    "nearestBSL": { "price": 65549.94, "probabilityOfSweep": 0.34 },
    "nearestSSL": { "price": 59093.99, "probabilityOfSweep": 0.71 }
  },
  "orderBlocks": [
    {
      "type": "bearish", "proximal": 61400, "distal": 60800,
      "confidence": 0.81, "confidenceFactors": ["✓ HTF bias aligned", "✓ FVG confluence"],
      "isMitigated": false, "isBreaker": false
    }
  ],
  "draw": [
    { "type": "SSL", "price": 59093.99, "score": 1.42, "direction": "short",
      "evidence": ["✓ SSL @ 59,094", "Prob sweep: 71%", "✓ HTF bias aligned"] }
  ]
}
```

---

## Roadmap

- [x] WebSocket live price feed (Binance US for crypto, Finnhub/Yahoo for forex)
- [x] Real-time candle-close SMC report rebuild with SSE push to browser
- [x] AI agent system — streaming Q&A + 4-agent pipeline + MCP tool-calling
- [x] MCP Tier 3 server — 11 SMC tools, 2 resources, 1 prompt for external AI agents
- [x] Broker abstraction — MockBroker + AlpacaAdapter with REVIEW/LIVE mode toggle
- [x] Broker dashboard — `/broker` page with account overview, orders, mode switch
- [x] Backtesting — sliding-window backtest runner using real SMC engine
- [x] Trade journal — PostgreSQL-backed ledger + performance matrix per setup
- [x] Docker + CI — multi-stage Dockerfile, AMD MI300X docker-compose, GitHub Actions
- [x] TypeScript — zero errors across both packages
- [ ] End-to-end MI300X deployment — run on real AMD Developer Cloud hardware
- [ ] Price alert notifications when price enters OB zone or sweeps liquidity
- [ ] Multi-panel chart view (two TFs side-by-side)
- [ ] Candle tap to inspect — SMC context tooltip for selected bar
- [ ] Mobile-native app (Expo React Native)
- [ ] Public API with rate limiting

---

## Testing

The SMC engine has a comprehensive test suite — **302 tests across 7 modules, 0 failures**.

```bash
# Run all SMC tests
npx tsx artifacts/api-server/src/lib/smc/fvg.test.ts
npx tsx artifacts/api-server/src/lib/smc/structure.test.ts
npx tsx artifacts/api-server/src/lib/smc/liquidity.test.ts
npx tsx artifacts/api-server/src/lib/smc/order-blocks.test.ts
npx tsx artifacts/api-server/src/lib/smc/daily-bias.test.ts
npx tsx artifacts/api-server/src/lib/smc/pd-array.test.ts
npx tsx artifacts/api-server/src/lib/smc/smt.test.ts
```

| Module | Tests | Coverage |
|---|---|---|
| `fvg.test.ts` | 28 | Bullish/bearish FVG, volume spikes, doji rejection, forex, fill tracking, inversion |
| `structure.test.ts` | 67 | Uptrend/downtrend bias, ranging, pivots (HH/HL/LH/LL), CHoCH/BOS reversal, confidence, phase, narratives |
| `liquidity.test.ts` | 19 | BSL/SSL pools, swept/unswept, probability scoring, nearest pool, session assignment |
| `order-blocks.test.ts` | 100 | Bullish/bearish OB, FVG confluence, mitigation, breaker blocks, confidence, strength |
| `daily-bias.test.ts` | 29 | HH/HL structure, LH/LL structure, SMA confirmation, strength tiers, empty/short data |
| `pd-array.test.ts` | 39 | Premium/discount/equilibrium bias, zone geometry, dealing range, labels |
| `smt.test.ts` | 20 | Bearish/bullish SMT, no-divergence sync, confidence bounds, timing proximity |

## Contributing

Pull requests welcome. The codebase is deliberately modular — each SMC concept lives in its own file under `artifacts/api-server/src/lib/smc/`. To add a new concept:

1. Create `artifacts/api-server/src/lib/smc/your-concept.ts`
2. Export a typed result interface from `types.ts`
3. Call your analyser in `report.ts → buildReport()`
4. Extend `SmcReport` in `types.ts` and mirror the new field in `lib/api-client-react/src/generated/api.schemas.ts`

---

## License

MIT

---

## Credits

- **ICT (Inner Circle Trader)** — trading methodology and concept definitions
- **TradingView** — Lightweight Charts v5 library
- **Fireworks AI** — LLM inference infrastructure
- **Binance** — crypto OHLCV data
- **Yahoo Finance** — forex OHLCV data
