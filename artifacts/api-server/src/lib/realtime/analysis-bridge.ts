/**
 * Analysis Bridge — wires the real-time candle pipeline into the SMC engine.
 *
 * When a candle closes, we:
 *   1. Grab the updated candle array from the candle store
 *   2. Run the full SMC engine (buildReport) with those candles
 *   3. Pre-warm the REST analysis cache so the next poll returns fresh data
 *   4. Push the SmcReport directly to browsers via SSE "report_update"
 *
 * This means the dashboard cards update INSTANTLY on candle close — no
 * client-side refetch round-trip to Yahoo Finance needed.
 */

import { candleStore } from "./candle-store.js";
import { sseManager } from "./sse-manager.js";
import { buildReport } from "../smc/report.js";
import { fetchBinanceDailyCandles } from "../fetchers/binance.js";
import { fetchYahooDailyCandles } from "../fetchers/yahoo.js";
import { updateCachedReport } from "../../routes/analysis.js";
import { logger } from "../logger.js";
import type { Candle, Market } from "../smc/types.js";

// ── Event wiring ─────────────────────────────────────────────────────────────────

candleStore.on("candleClosed", async (evt: { symbol: string; timeframe: string; candle: Candle }) => {
  const { symbol, timeframe } = evt;

  // Determine market from symbol format
  const market = detectMarket(symbol);
  if (!market) return;
  if (!VALID_TFS.has(timeframe)) return;

  try {
    // Get the full candle history from the store (backfill + live)
    const candles = candleStore.getCandles(symbol, timeframe);
    if (candles.length < 10) {
      logger.debug({ symbol, timeframe, count: candles.length }, "Skipping report rebuild — insufficient candles");
      return;
    }

    // Fetch daily candles for HTF bias (best-effort, may fail)
    let dailyCandles: Candle[] | undefined;
    try {
      dailyCandles = market === "crypto"
        ? await fetchBinanceDailyCandles(symbol)
        : await fetchYahooDailyCandles(symbol);
    } catch {
      logger.debug({ symbol }, "Daily candles unavailable for report rebuild, using fallback");
    }

    // Rebuild the full SMC report from fresh candles
    const report = buildReport(candles, symbol, market, timeframe, {
      dailyCandles,
    });

    // Pre-warm the REST cache so the next poll returns this fresh report
    updateCachedReport(market, symbol, timeframe, undefined, report);

    // Push the report to every browser watching this symbol
    sseManager.broadcastReport(symbol, timeframe, report);

    logger.info({
      symbol,
      timeframe,
      market,
      price: report.currentPrice,
      bias: report.structure.bias,
    }, "SMC report rebuilt after candle close");
  } catch (err) {
    logger.error({ err, symbol, timeframe }, "Failed to rebuild SMC report on candle close");
  }
});

// ── Guards ──────────────────────────────────────────────────────────────────────

/** Detect whether symbol is crypto or forex based on naming convention. */
function detectMarket(symbol: string): Market | null {
  if (symbol.endsWith("=X") || symbol.includes("=X")) return "forex";
  if (symbol.endsWith("USDT")) return "crypto";
  // Check against known sets
  if (CRYPTO_SYMBOLS.has(symbol)) return "crypto";
  if (FOREX_SYMBOLS.has(symbol)) return "forex";
  return null;
}

const CRYPTO_SYMBOLS = new Set([
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
]);

const FOREX_SYMBOLS = new Set([
  "EURUSD=X", "GBPUSD=X", "USDJPY=X", "AUDUSD=X", "USDCAD=X",
  "USDCHF=X", "NZDUSD=X", "EURJPY=X", "GBPJPY=X", "XAUUSD=X",
]);

const VALID_TFS = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);
