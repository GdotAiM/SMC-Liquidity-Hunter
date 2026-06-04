import type { Candle, StructureResult, StructurePoint, StructureBreak } from "./types.js";
import { SMC_CONFIG } from "./config.js";

function calcATR(candles: Candle[], period: number): number[] {
  const atr: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    atr[i] = i < period ? tr : (atr[i - 1] * (period - 1) + tr) / period;
  }
  return atr;
}

function findPivots(candles: Candle[], atr: number[], lookback: number): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  const n = candles.length;

  for (let i = lookback; i < n - lookback; i++) {
    const c = candles[i];
    const noise = atr[i] * 0.5;

    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high - noise) isHigh = false;
      if (candles[j].low <= c.low + noise) isLow = false;
    }

    if (isHigh && c.close > c.open) highs.push(i);
    if (isLow && c.close < c.open) lows.push(i);
  }

  return { highs, lows };
}

export function analyzeStructure(candles: Candle[]): StructureResult {
  const atr = calcATR(candles, SMC_CONFIG.atrPeriod);
  const { highs, lows } = findPivots(candles, atr, SMC_CONFIG.pivotLookback);

  const pivots: StructurePoint[] = [];
  const breaks: StructureBreak[] = [];

  let lastHH: number | null = null;
  let lastHL: number | null = null;
  let lastLH: number | null = null;
  let lastLL: number | null = null;

  const allPivotIndices = [...highs.map(i => ({ i, isHigh: true })), ...lows.map(i => ({ i, isHigh: false }))]
    .sort((a, b) => a.i - b.i);

  for (const { i, isHigh } of allPivotIndices) {
    const price = isHigh ? candles[i].high : candles[i].low;
    const totalBars = candles.length;
    const recencyWeight = 0.5 + 0.5 * (i / totalBars);

    if (isHigh) {
      if (lastHH === null || price > lastHH) {
        pivots.push({ index: i, price, type: "HH", confirmed: true, time: candles[i].time });
        if (lastHH !== null && lastLH !== null) {
          breaks.push({ index: i, price, type: "BOS", direction: "bullish", time: candles[i].time });
        }
        lastHH = price;
      } else {
        pivots.push({ index: i, price, type: "LH", confirmed: true, time: candles[i].time });
        if (lastHL !== null) {
          breaks.push({ index: i, price, type: "CHoCH", direction: "bearish", time: candles[i].time });
        }
        lastLH = price;
      }
    } else {
      if (lastLL === null || price < lastLL) {
        pivots.push({ index: i, price, type: "LL", confirmed: true, time: candles[i].time });
        if (lastLL !== null && lastHL !== null) {
          breaks.push({ index: i, price, type: "BOS", direction: "bearish", time: candles[i].time });
        }
        lastLL = price;
      } else {
        pivots.push({ index: i, price, type: "HL", confirmed: true, time: candles[i].time });
        if (lastLH !== null) {
          breaks.push({ index: i, price, type: "CHoCH", direction: "bullish", time: candles[i].time });
        }
        lastHL = price;
      }
    }
  }

  const recentPivots = pivots.slice(-12);
  const recentHighs = recentPivots.filter(p => p.type === "HH" || p.type === "LH");
  const recentLows = recentPivots.filter(p => p.type === "HL" || p.type === "LL");

  const bullishPivots = recentPivots.filter(p => p.type === "HH" || p.type === "HL");
  const bearishPivots = recentPivots.filter(p => p.type === "LH" || p.type === "LL");

  const totalBars = candles.length;

  const weightedBullish = bullishPivots.reduce((acc, p) => acc + (0.5 + 0.5 * (p.index / totalBars)), 0);
  const weightedBearish = bearishPivots.reduce((acc, p) => acc + (0.5 + 0.5 * (p.index / totalBars)), 0);
  const totalWeight = weightedBullish + weightedBearish;

  let trend: "bullish" | "bearish" | "ranging" = "ranging";
  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  let confidence = 0.5;

  if (totalWeight > 0) {
    const bullishRatio = weightedBullish / totalWeight;
    if (bullishRatio > 0.65) {
      trend = "bullish";
      bias = "bullish";
      confidence = Math.min(0.95, bullishRatio);
    } else if (bullishRatio < 0.35) {
      trend = "bearish";
      bias = "bearish";
      confidence = Math.min(0.95, 1 - bullishRatio);
    } else {
      trend = "ranging";
      bias = "neutral";
      confidence = 1 - Math.abs(bullishRatio - 0.5) * 4;
    }
  }

  const lastBreaks = breaks.slice(-3);
  if (lastBreaks.length > 0) {
    const lastBreak = lastBreaks[lastBreaks.length - 1];
    bias = lastBreak.direction;
  }

  return {
    trend,
    bias,
    confidence,
    pivots: pivots.slice(-50),
    breaks: breaks.slice(-20),
  };
}
