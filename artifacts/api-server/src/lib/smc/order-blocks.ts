import type { Candle, OrderBlock, FairValueGap } from "./types.js";
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

function hasFVGInWindow(fvgs: FairValueGap[], obIndex: number, lookForward: number): boolean {
  return fvgs.some(g => g.index >= obIndex && g.index <= obIndex + lookForward);
}

/**
 * Score OB confidence from 0–1 based on ICT quality factors.
 * Alignment with HTF bias is applied later in report.ts where bias is available.
 */
function scoreOBConfidence(
  ob: {
    hasFvg: boolean;
    isMitigated: boolean;
    isBreaker: boolean;
    strength: number;
    index: number;
  },
  totalCandles: number,
): { confidence: number; factors: string[] } {
  let score = 0.45; // ICT baseline
  const factors: string[] = [];

  // FVG confluence is a strong quality signal
  if (ob.hasFvg) {
    score += 0.18;
    factors.push("✓ FVG confluence");
  }

  // Unmitigated blocks are fresh and high-value
  if (!ob.isMitigated) {
    score += 0.15;
    factors.push("✓ Unmitigated");
  }

  // Breakers have been invalidated — reduce confidence
  if (ob.isBreaker) {
    score -= 0.20;
    factors.push("✗ Breaker (invalidated)");
  }

  // Displacement strength above average
  if (ob.strength > 1.5) {
    score += 0.10;
    factors.push("✓ Strong displacement");
  }

  // Recency: OBs in the recent 40% of the dataset are fresher
  const recency = ob.index / totalCandles;
  if (recency > 0.6) {
    score += 0.10;
    factors.push("✓ Recent OB");
  } else if (recency < 0.25) {
    score -= 0.08;
    factors.push("◐ Old OB");
  }

  return { confidence: Math.min(0.95, Math.max(0.05, score)), factors };
}

export function analyzeOrderBlocks(candles: Candle[], fvgs: FairValueGap[]): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const atr = calcATR(candles, SMC_CONFIG.atrPeriod);
  const n  = candles.length;
  const lf = SMC_CONFIG.obLookForward;

  for (let i = lf; i < n - lf; i++) {
    const curr = candles[i];
    const isBearishCandle = curr.close < curr.open;
    const isBullishCandle = curr.close > curr.open;

    // ── Bullish OB: last bearish candle before a bullish impulse ──────────────
    if (isBearishCandle) {
      let impulseIdx = -1;
      for (let k = i + 1; k <= Math.min(i + lf, n - 2); k++) {
        if (candles[k].close > candles[k].open) {
          const impulseSize = candles[k].close - candles[k].open;
          if (impulseSize > atr[k] * 0.5) { impulseIdx = k; break; }
        }
      }
      if (impulseIdx === -1) continue;

      // Find the last bearish candle in the consolidation before the impulse
      let lastBearishIdx = i;
      for (let scan = impulseIdx - 1; scan >= Math.max(0, impulseIdx - lf - 1); scan--) {
        if (candles[scan].close < candles[scan].open) { lastBearishIdx = scan; break; }
      }

      const ob = candles[lastBearishIdx];

      /**
       * ICT bullish OB zone: open (top of body) → low (distal wick)
       * proximal = candle.open  (nearest level price reacts to on re-entry)
       * distal   = candle.low   (invalidation if closed below)
       */
      const proximal = ob.open;
      const distal   = ob.low;

      const hasFvg = SMC_CONFIG.obRequireFvg ? hasFVGInWindow(fvgs, impulseIdx, lf) : true;
      if (!hasFvg) continue;

      let isMitigated = false;
      let isBreaker   = false;
      for (let k = impulseIdx + 1; k < n; k++) {
        if (candles[k].low <= proximal) {
          isMitigated = true;
          if (candles[k].close < distal) isBreaker = true;
          break;
        }
      }

      const strength = (ob.high - ob.low) / (atr[lastBearishIdx] || 1);
      const { confidence, factors } = scoreOBConfidence(
        { hasFvg, isMitigated, isBreaker, strength, index: lastBearishIdx },
        n,
      );

      blocks.push({
        type: "bullish",
        proximal,
        distal,
        time: ob.time,
        index: lastBearishIdx,
        valid: !isMitigated || isBreaker,
        isMitigated,
        isBreaker,
        strength: Math.min(3, strength),
        hasFvg,
        confidence,
        confidenceFactors: factors,
      });
    }

    // ── Bearish OB: last bullish candle before a bearish impulse ─────────────
    if (isBullishCandle) {
      let impulseIdx = -1;
      for (let k = i + 1; k <= Math.min(i + lf, n - 2); k++) {
        if (candles[k].close < candles[k].open) {
          const impulseSize = candles[k].open - candles[k].close;
          if (impulseSize > atr[k] * 0.5) { impulseIdx = k; break; }
        }
      }
      if (impulseIdx === -1) continue;

      let lastBullishIdx = i;
      for (let scan = impulseIdx - 1; scan >= Math.max(0, impulseIdx - lf - 1); scan--) {
        if (candles[scan].close > candles[scan].open) { lastBullishIdx = scan; break; }
      }

      const ob = candles[lastBullishIdx];

      /**
       * Bearish OB zone: open (bottom of body) → high (distal wick)
       * proximal = candle.close → kept as-is for bearish (close is lower than open for bullish candle? No.
       * For a BULLISH candle: close > open. The OB proximal for bearish = candle.open (entry level on pullback).
       * We maintain current bearish OB behaviour as instructed.
       */
      const proximal = ob.close;
      const distal   = ob.high;

      const hasFvg = SMC_CONFIG.obRequireFvg ? hasFVGInWindow(fvgs, impulseIdx, lf) : true;
      if (!hasFvg) continue;

      let isMitigated = false;
      let isBreaker   = false;
      for (let k = impulseIdx + 1; k < n; k++) {
        if (candles[k].high >= proximal) {
          isMitigated = true;
          if (candles[k].close > distal) isBreaker = true;
          break;
        }
      }

      const strength = (ob.high - ob.low) / (atr[lastBullishIdx] || 1);
      const { confidence, factors } = scoreOBConfidence(
        { hasFvg, isMitigated, isBreaker, strength, index: lastBullishIdx },
        n,
      );

      blocks.push({
        type: "bearish",
        proximal,
        distal,
        time: ob.time,
        index: lastBullishIdx,
        valid: !isMitigated || isBreaker,
        isMitigated,
        isBreaker,
        strength: Math.min(3, strength),
        hasFvg,
        confidence,
        confidenceFactors: factors,
      });
    }
  }

  return blocks.slice(-20);
}
