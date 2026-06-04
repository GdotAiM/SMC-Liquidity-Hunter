import { Router, type IRouter } from "express";
import { fetchBinanceCandles, fetchBinanceDailyCandles } from "../lib/fetchers/binance.js";
import { fetchYahooCandles, fetchYahooDailyCandles } from "../lib/fetchers/yahoo.js";
import { buildReport } from "../lib/smc/report.js";

const router: IRouter = Router();

router.get("/analysis/crypto", async (req, res): Promise<void> => {
  const symbol = Array.isArray(req.query.symbol) ? req.query.symbol[0] : req.query.symbol;
  const timeframe = Array.isArray(req.query.timeframe) ? req.query.timeframe[0] : (req.query.timeframe ?? "4h");
  const correlatedSymbol = Array.isArray(req.query.correlatedSymbol)
    ? req.query.correlatedSymbol[0]
    : req.query.correlatedSymbol;

  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "symbol query param is required" });
    return;
  }

  const tf = typeof timeframe === "string" ? timeframe : "4h";
  const corrSym = typeof correlatedSymbol === "string" ? correlatedSymbol : undefined;

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

    res.json(report);
  } catch (err) {
    req.log.error({ err, symbol }, "Failed to fetch crypto analysis");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Failed to analyze ${symbol}: ${message}` });
  }
});

router.get("/analysis/forex", async (req, res): Promise<void> => {
  const symbol = Array.isArray(req.query.symbol) ? req.query.symbol[0] : req.query.symbol;
  const timeframe = Array.isArray(req.query.timeframe) ? req.query.timeframe[0] : (req.query.timeframe ?? "4h");
  const correlatedSymbol = Array.isArray(req.query.correlatedSymbol)
    ? req.query.correlatedSymbol[0]
    : req.query.correlatedSymbol;

  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "symbol query param is required" });
    return;
  }

  const tf = typeof timeframe === "string" ? timeframe : "4h";
  const corrSym = typeof correlatedSymbol === "string" ? correlatedSymbol : undefined;

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

    res.json(report);
  } catch (err) {
    req.log.error({ err, symbol }, "Failed to fetch forex analysis");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Failed to analyze ${symbol}: ${message}` });
  }
});

export default router;
