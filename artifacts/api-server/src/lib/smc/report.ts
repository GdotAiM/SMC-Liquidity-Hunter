import type { Candle, SmcReport, DrawTarget, Market } from "./types.js";
import { analyzeStructure } from "./structure.js";
import { analyzeLiquidity } from "./liquidity.js";
import { analyzeOrderBlocks } from "./order-blocks.js";
import { analyzeFVG } from "./fvg.js";
import { analyzePdArray } from "./pd-array.js";
import { analyzeDailyBias } from "./daily-bias.js";
import { analyzeSMT } from "./smt.js";

export interface BuildReportOptions {
  dailyCandles?: Candle[];
  correlatedCandles?: Candle[];
  primarySymbol?: string;
  correlatedSymbol?: string;
  market?: Market;
  timeframe?: string;
}

export function buildReport(
  candles: Candle[],
  symbol: string,
  market: Market,
  timeframe: string,
  options: BuildReportOptions = {},
): SmcReport {
  const structure = analyzeStructure(candles);
  const fvg = analyzeFVG(candles, market);
  const liquidity = analyzeLiquidity(candles, timeframe, market);
  const orderBlocks = analyzeOrderBlocks(candles, fvg);
  const pdArray = analyzePdArray(candles, timeframe);
  const dailyBias = analyzeDailyBias(options.dailyCandles ?? []);

  let smt = {
    detected: false,
    type: null as null,
    confidence: 0,
    time: null as number | null,
    primarySymbol: symbol,
    correlatedSymbol: options.correlatedSymbol ?? null,
  };

  if (options.correlatedCandles && options.correlatedCandles.length > 0 && options.correlatedSymbol) {
    smt = analyzeSMT(candles, options.correlatedCandles, symbol, options.correlatedSymbol);
  }

  const currentPrice = candles[candles.length - 1].close;

  const draw: DrawTarget[] = [];

  const bias = structure.bias !== "neutral" ? structure.bias : dailyBias.bias;

  if (liquidity.nearestBSL) {
    const pool = liquidity.nearestBSL;
    const proximityScore = 1 / (1 + Math.abs(pool.price - currentPrice) / currentPrice * 100);
    const biasScore = bias === "bullish" ? 1.5 : 0.8;
    draw.push({
      price: pool.price,
      type: "BSL",
      score: pool.score * proximityScore * biasScore,
      direction: "long",
      label: `Buy-side Liquidity @ ${pool.price.toFixed(5)}`,
    });
  }

  if (liquidity.nearestSSL) {
    const pool = liquidity.nearestSSL;
    const proximityScore = 1 / (1 + Math.abs(pool.price - currentPrice) / currentPrice * 100);
    const biasScore = bias === "bearish" ? 1.5 : 0.8;
    draw.push({
      price: pool.price,
      type: "SSL",
      score: pool.score * proximityScore * biasScore,
      direction: "short",
      label: `Sell-side Liquidity @ ${pool.price.toFixed(5)}`,
    });
  }

  const validOBs = orderBlocks.filter(ob => ob.valid && !ob.isMitigated).slice(-3);
  for (const ob of validOBs) {
    const direction = ob.type === "bullish" ? "long" : "short";
    const biasScore = (ob.type === "bullish" && bias === "bullish") || (ob.type === "bearish" && bias === "bearish") ? 1.3 : 0.7;
    draw.push({
      price: ob.proximal,
      type: `${ob.type === "bullish" ? "Bullish" : "Bearish"} OB`,
      score: ob.strength * biasScore,
      direction,
      label: `${ob.type === "bullish" ? "Bullish" : "Bearish"} OB @ ${ob.proximal.toFixed(5)}`,
    });
  }

  const unfilledFVGs = fvg.filter(g => g.fillFraction < 0.5).slice(-3);
  for (const gap of unfilledFVGs) {
    const midpoint = (gap.top + gap.bottom) / 2;
    const direction = gap.type === "bullish" ? "long" : "short";
    draw.push({
      price: midpoint,
      type: `${gap.type === "bullish" ? "Bullish" : "Bearish"} FVG`,
      score: 0.6,
      direction,
      label: `${gap.type === "bullish" ? "Bullish" : "Bearish"} FVG @ ${midpoint.toFixed(5)}`,
    });
  }

  draw.sort((a, b) => b.score - a.score);

  const recentCandles = candles.slice(-100);

  return {
    symbol,
    market,
    timeframe,
    currentPrice,
    generatedAt: Date.now() / 1000,
    candles: recentCandles,
    structure,
    liquidity,
    orderBlocks,
    fvg,
    pdArray,
    dailyBias,
    smt,
    draw: draw.slice(0, 5),
  };
}
