import { Router, type IRouter } from "express";
import { fetchBinanceCandles, fetchBinanceDailyCandles } from "../lib/fetchers/binance.js";
import { fetchYahooCandles, fetchYahooDailyCandles } from "../lib/fetchers/yahoo.js";
import { buildReport } from "../lib/smc/report.js";

const router: IRouter = Router();

// ── Lightweight in-memory TTL cache ─────────────────────────────────────────
// Caches OHLCV + report responses for 60 seconds.
// Key: market|symbol|timeframe|correlatedSymbol
// No external infrastructure required — pure in-process Map.

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function cacheKey(market: string, symbol: string, tf: string, corrSym?: string): string {
  return `${market}|${symbol}|${tf}|${corrSym ?? ""}`;
}

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setCached(key: string, data: unknown): void {
  // Evict oldest entry if cache grows large (>500 keys) to avoid memory leak
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Crypto analysis ──────────────────────────────────────────────────────────

router.get("/analysis/crypto", async (req, res): Promise<void> => {
  const symbol = Array.isArray(req.query.symbol) ? req.query.symbol[0] : req.query.symbol;
  const timeframe = Array.isArray(req.query.timeframe)
    ? req.query.timeframe[0]
    : (req.query.timeframe ?? "4h");
  const correlatedSymbol = Array.isArray(req.query.correlatedSymbol)
    ? req.query.correlatedSymbol[0]
    : req.query.correlatedSymbol;

  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "symbol query param is required" });
    return;
  }

  const tf      = typeof timeframe          === "string" ? timeframe          : "4h";
  const corrSym = typeof correlatedSymbol   === "string" ? correlatedSymbol   : undefined;
  const key     = cacheKey("crypto", symbol, tf, corrSym);

  const cached = getCached(key);
  if (cached) { res.json(cached); return; }

  try {
    const [candles, dailyCandles, correlatedCandles] = await Promise.all([
      fetchBinanceCandles(symbol, tf),
      fetchBinanceDailyCandles(symbol),
      corrSym ? fetchBinanceCandles(corrSym, tf) : Promise.resolve(undefined),
    ]);

    const report = buildReport(candles, symbol, "crypto", tf, {
      dailyCandles,
      correlatedCandles: correlatedCandles ?? undefined,
      primarySymbol: symbol,
      correlatedSymbol: corrSym,
    });

    setCached(key, report);
    res.json(report);
  } catch (err) {
    req.log.error({ err, symbol }, "Failed to fetch crypto analysis");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Failed to analyze ${symbol}: ${message}` });
  }
});

// ── Forex analysis ───────────────────────────────────────────────────────────

router.get("/analysis/forex", async (req, res): Promise<void> => {
  const symbol = Array.isArray(req.query.symbol) ? req.query.symbol[0] : req.query.symbol;
  const timeframe = Array.isArray(req.query.timeframe)
    ? req.query.timeframe[0]
    : (req.query.timeframe ?? "4h");
  const correlatedSymbol = Array.isArray(req.query.correlatedSymbol)
    ? req.query.correlatedSymbol[0]
    : req.query.correlatedSymbol;

  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "symbol query param is required" });
    return;
  }

  const tf      = typeof timeframe          === "string" ? timeframe          : "4h";
  const corrSym = typeof correlatedSymbol   === "string" ? correlatedSymbol   : undefined;
  const key     = cacheKey("forex", symbol, tf, corrSym);

  const cached = getCached(key);
  if (cached) { res.json(cached); return; }

  try {
    const [candles, dailyCandles, correlatedCandles] = await Promise.all([
      fetchYahooCandles(symbol, tf),
      fetchYahooDailyCandles(symbol),
      corrSym ? fetchYahooCandles(corrSym, tf) : Promise.resolve(undefined),
    ]);

    const report = buildReport(candles, symbol, "forex", tf, {
      dailyCandles,
      correlatedCandles: correlatedCandles ?? undefined,
      primarySymbol: symbol,
      correlatedSymbol: corrSym,
    });

    setCached(key, report);
    res.json(report);
  } catch (err) {
    req.log.error({ err, symbol }, "Failed to fetch forex analysis");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Failed to analyze ${symbol}: ${message}` });
  }
});

export default router;
