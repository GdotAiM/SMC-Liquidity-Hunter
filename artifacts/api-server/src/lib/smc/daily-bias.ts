import type { Candle, DailyBiasResult } from "./types.js";
import { SMC_CONFIG } from "./config.js";

function calcSMA(candles: Candle[], period: number): number[] {
  const sma: number[] = new Array(candles.length).fill(0);
  for (let i = period - 1; i < candles.length; i++) {
    const sum = candles.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0);
    sma[i] = sum / period;
  }
  return sma;
}

export function analyzeDailyBias(dailyCandles: Candle[]): DailyBiasResult {
  if (!dailyCandles || dailyCandles.length < SMC_CONFIG.smaPeriod) {
    return { bias: "neutral", strength: 0, consecutiveDays: 0, referencedSwing: null };
  }

  const n = dailyCandles.length;
  const sma = calcSMA(dailyCandles, SMC_CONFIG.smaPeriod);
  const currentClose = dailyCandles[n - 1].close;
  const currentSma = sma[n - 1];

  const priceAboveSma = currentClose > currentSma;

  let recentHH: number | null = null;
  let recentHL: number | null = null;
  let recentLH: number | null = null;
  let recentLL: number | null = null;

  const lookback = Math.min(20, n);
  const recent = dailyCandles.slice(-lookback);

  for (let i = 2; i < recent.length - 1; i++) {
    const hi = recent[i].high;
    const lo = recent[i].low;
    const prevHi = recent[i - 1].high;
    const prevLo = recent[i - 1].low;
    const nextHi = recent[i + 1]?.high ?? hi;
    const nextLo = recent[i + 1]?.low ?? lo;

    if (hi > prevHi && hi > nextHi) {
      if (recentHH === null || hi > recentHH) recentHH = hi;
      else if (recentLH === null || hi < recentLH) recentLH = hi;
    }
    if (lo < prevLo && lo < nextLo) {
      if (recentLL === null || lo < recentLL) recentLL = lo;
      else if (recentHL === null || lo > recentHL) recentHL = lo;
    }
  }

  const bullishStructure = recentHH !== null && recentHL !== null;
  const bearishStructure = recentLH !== null && recentLL !== null;

  let swingSignal: "bullish" | "bearish" | "neutral" = "neutral";
  let referencedSwing: string | null = null;

  if (bullishStructure && !bearishStructure) {
    swingSignal = "bullish";
    referencedSwing = `HH @ ${recentHH!.toFixed(5)} / HL @ ${recentHL!.toFixed(5)}`;
  } else if (bearishStructure && !bullishStructure) {
    swingSignal = "bearish";
    referencedSwing = `LH @ ${recentLH!.toFixed(5)} / LL @ ${recentLL!.toFixed(5)}`;
  } else if (bullishStructure && bearishStructure) {
    swingSignal = "neutral";
    referencedSwing = "Conflicting structure";
  }

  const smaSignal: "bullish" | "bearish" | "neutral" = priceAboveSma ? "bullish" : "bearish";

  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  let strength = 0;

  if (swingSignal === smaSignal && swingSignal !== "neutral") {
    bias = swingSignal;
    strength = 0.8;
  } else if (swingSignal !== "neutral") {
    bias = swingSignal;
    strength = 0.5;
  } else if (smaSignal !== "neutral") {
    bias = smaSignal;
    strength = 0.3;
  }

  let consecutiveDays = 0;
  for (let i = n - 1; i >= 0; i--) {
    const aboveSma = dailyCandles[i].close > sma[i];
    if ((bias === "bullish" && aboveSma) || (bias === "bearish" && !aboveSma)) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  return { bias, strength, consecutiveDays, referencedSwing };
}
