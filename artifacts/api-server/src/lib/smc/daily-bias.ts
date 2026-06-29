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

/**
 * Daily bias using ICT methodology — structure-primary approach.
 *
 * Priority order:
 *   1. Market structure (HH/HL or LH/LL sequence) — PRIMARY
 *   2. Dealing range: is price trading in premium or discount?
 *   3. Recent swing direction (higher-timeframe swing high/low)
 *   4. SMA position — WEAK secondary confirmation only
 *
 * A structural bias without SMA confirmation still yields strength 0.65–0.75.
 * SMA alone (no structural signal) gives only 0.20 — it should not dominate.
 */
export function analyzeDailyBias(dailyCandles: Candle[]): DailyBiasResult {
  if (!dailyCandles || dailyCandles.length < SMC_CONFIG.smaPeriod) {
    return { bias: "neutral", strength: 0, consecutiveDays: 0, referencedSwing: null, evidence: [] };
  }

  const n            = dailyCandles.length;
  const currentClose = dailyCandles[n - 1].close;
  const evidence: string[] = [];

  // ── 1. Market structure from recent 20 bars ─────────────────────────────────
  const lookback = Math.min(20, n);
  const recent   = dailyCandles.slice(-lookback);

  let recentHH: number | null = null;
  let recentHL: number | null = null;
  let recentLH: number | null = null;
  let recentLL: number | null = null;

  for (let i = 2; i < recent.length - 1; i++) {
    const hi     = recent[i].high;
    const lo     = recent[i].low;
    const prevHi = recent[i - 1].high;
    const prevLo = recent[i - 1].low;
    const nextHi = recent[i + 1]?.high ?? hi;
    const nextLo = recent[i + 1]?.low  ?? lo;

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
    swingSignal     = "bullish";
    referencedSwing = `HH @ ${recentHH!.toFixed(5)} / HL @ ${recentHL!.toFixed(5)}`;
    evidence.push("✓ Bullish structure: HH–HL sequence");
  } else if (bearishStructure && !bullishStructure) {
    swingSignal     = "bearish";
    referencedSwing = `LH @ ${recentLH!.toFixed(5)} / LL @ ${recentLL!.toFixed(5)}`;
    evidence.push("✓ Bearish structure: LH–LL sequence");
  } else if (bullishStructure && bearishStructure) {
    referencedSwing = "Conflicting structure";
    evidence.push("◐ Conflicting structure — ranging");
  }

  // ── 2. Dealing range premium / discount ─────────────────────────────────────
  const rangeHigh = Math.max(...recent.map(c => c.high));
  const rangeLow  = Math.min(...recent.map(c => c.low));
  const rangeEq   = (rangeHigh + rangeLow) / 2;

  let pdConfirms = false;
  if (swingSignal === "bullish" && currentClose < rangeEq) {
    pdConfirms = true;
    evidence.push("✓ Price in discount — supports bullish");
  } else if (swingSignal === "bearish" && currentClose > rangeEq) {
    pdConfirms = true;
    evidence.push("✓ Price in premium — supports bearish");
  } else if (swingSignal !== "neutral") {
    evidence.push("◐ PD zone counter to structure bias");
  }

  // ── 3. SMA — weak secondary tiebreaker only ──────────────────────────────────
  const sma         = calcSMA(dailyCandles, SMC_CONFIG.smaPeriod);
  const currentSma  = sma[n - 1];
  const priceAboveSma = currentClose > currentSma;
  const smaSignal: "bullish" | "bearish" = priceAboveSma ? "bullish" : "bearish";

  if (smaSignal === swingSignal && swingSignal !== "neutral") {
    evidence.push("✓ SMA confirms structure");
  } else if (swingSignal !== "neutral") {
    evidence.push("◐ SMA diverges from structure");
  }

  // ── Strength table: structure is primary ─────────────────────────────────────
  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  let strength = 0;

  if (swingSignal !== "neutral") {
    bias = swingSignal;
    // Structure + PD confirmation = strong
    if (pdConfirms && smaSignal === swingSignal) {
      strength = 0.88;
    } else if (pdConfirms || smaSignal === swingSignal) {
      strength = 0.72;
    } else {
      strength = 0.55; // structure alone — still valid but lower conviction
    }
  } else if (smaSignal !== "neutral") {
    // SMA only — very weak signal
    bias     = smaSignal;
    strength = 0.20;
    evidence.push("◐ SMA-only signal (low conviction)");
  }

  // ── Consecutive days ────────────────────────────────────────────────────────
  let consecutiveDays = 0;
  for (let i = n - 1; i >= 0; i--) {
    const aboveSma = dailyCandles[i].close > sma[i];
    if ((bias === "bullish" && aboveSma) || (bias === "bearish" && !aboveSma)) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  if (consecutiveDays >= 3) evidence.push(`✓ ${consecutiveDays}-day consecutive bias`);

  return { bias, strength, consecutiveDays, referencedSwing, evidence };
}
