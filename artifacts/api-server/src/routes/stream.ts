import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { sseManager } from "../lib/realtime/sse-manager.js";
import { candleStore } from "../lib/realtime/candle-store.js";
import { binanceWs } from "../lib/realtime/binance-ws.js";
import { forexWs } from "../lib/realtime/forex-ws.js";

const router: IRouter = Router();

// All timeframes the platform supports — used as default subscription set
const ALL_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

// Crypto symbols available for real-time streaming (Binance supports these)
const CRYPTO_SYMBOLS = new Set([
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
]);

// Forex symbols available for real-time streaming (Finnhub/Yahoo supported)
const FOREX_SYMBOLS = new Set([
  "EURUSD=X", "GBPUSD=X", "USDJPY=X", "AUDUSD=X", "USDCAD=X",
  "USDCHF=X", "NZDUSD=X", "EURJPY=X", "GBPJPY=X", "XAUUSD=X",
]);

// ── GET /api/stream/status ──────────────────────────────────────────────────────
// MUST be registered before /stream/:symbol to avoid "status" being captured as :symbol

router.get("/stream/status", (_req: Request, res: Response): void => {
  res.json({
    clients: sseManager.getClientCount(),
    clientList: sseManager.getStatus(),
    candles: candleStore.getStatus(),
    activeSymbols: candleStore.getActiveSymbols(),
    endpoint: "Binance US → Binance global (auto-fallback)",
  });
});

// ── GET /api/stream/:symbol ─────────────────────────────────────────────────────

router.get("/stream/:symbol", (req: Request, res: Response): void => {
  const symbolParam = req.params.symbol;
  const symbol = (typeof symbolParam === "string" ? symbolParam : symbolParam?.[0] ?? "").toUpperCase();
  const tfsParam = req.query.timeframes as string | undefined;

  if (!symbol) {
    res.status(400).json({ error: "symbol path param is required" });
    return;
  }

  // Parse requested timeframes (comma-separated), default to all
  const timeframes = tfsParam
    ? tfsParam.split(",").map((t) => t.trim()).filter((t) => ALL_TIMEFRAMES.includes(t))
    : [...ALL_TIMEFRAMES];

  if (timeframes.length === 0) {
    res.status(400).json({ error: "No valid timeframes requested" });
    return;
  }

  // Subscribe to the appropriate real-time source for this symbol
  if (CRYPTO_SYMBOLS.has(symbol)) {
    binanceWs.subscribe(symbol, timeframes);
  } else if (FOREX_SYMBOLS.has(symbol)) {
    forexWs.subscribe(symbol, timeframes);
  }

  // Register SSE client — this sets headers and starts the stream
  sseManager.addClient(res, symbol, timeframes);
});

export default router;
