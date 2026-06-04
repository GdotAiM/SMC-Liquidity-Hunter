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

export function analyzeOrderBlocks(candles: Candle[], fvgs: FairValueGap[]): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const atr = calcATR(candles, SMC_CONFIG.atrPeriod);
  const n = candles.length;
  const lf = SMC_CONFIG.obLookForward;

  for (let i = lf; i < n - lf; i++) {
    const curr = candles[i];
    const isBearishCandle = curr.close < curr.open;
    const isBullishCandle = curr.close > curr.open;

    if (isBearishCandle) {
      let impulseIdx = -1;
      for (let k = i + 1; k <= Math.min(i + lf, n - 2); k++) {
        if (candles[k].close > candles[k].open) {
          const impulseSize = candles[k].close - candles[k].open;
          if (impulseSize > atr[k] * 0.5) {
            impulseIdx = k;
            break;
          }
        }
      }

      if (impulseIdx === -1) continue;

      let lastBearishIdx = i;
      for (let scan = impulseIdx - 1; scan >= Math.max(0, impulseIdx - lf - 1); scan--) {
        if (candles[scan].close < candles[scan].open) {
          lastBearishIdx = scan;
          break;
        }
      }

      const ob = candles[lastBearishIdx];
      const proximal = ob.close;
      const distal = ob.low;

      const hasFvg = SMC_CONFIG.obRequireFvg ? hasFVGInWindow(fvgs, impulseIdx, lf) : true;
      if (!hasFvg) continue;

      let isMitigated = false;
      let isBreaker = false;
      for (let k = impulseIdx + 1; k < n; k++) {
        if (candles[k].low <= proximal) {
          isMitigated = true;
          if (candles[k].close < distal) isBreaker = true;
          break;
        }
      }

      const strength = (ob.high - ob.low) / (atr[lastBearishIdx] || 1);

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
      });
    }

    if (isBullishCandle) {
      let impulseIdx = -1;
      for (let k = i + 1; k <= Math.min(i + lf, n - 2); k++) {
        if (candles[k].close < candles[k].open) {
          const impulseSize = candles[k].open - candles[k].close;
          if (impulseSize > atr[k] * 0.5) {
            impulseIdx = k;
            break;
          }
        }
      }

      if (impulseIdx === -1) continue;

      let lastBullishIdx = i;
      for (let scan = impulseIdx - 1; scan >= Math.max(0, impulseIdx - lf - 1); scan--) {
        if (candles[scan].close > candles[scan].open) {
          lastBullishIdx = scan;
          break;
        }
      }

      const ob = candles[lastBullishIdx];
      const proximal = ob.close;
      const distal = ob.high;

      const hasFvg = SMC_CONFIG.obRequireFvg ? hasFVGInWindow(fvgs, impulseIdx, lf) : true;
      if (!hasFvg) continue;

      let isMitigated = false;
      let isBreaker = false;
      for (let k = impulseIdx + 1; k < n; k++) {
        if (candles[k].high >= proximal) {
          isMitigated = true;
          if (candles[k].close > distal) isBreaker = true;
          break;
        }
      }

      const strength = (ob.high - ob.low) / (atr[lastBullishIdx] || 1);

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
      });
    }
  }

  return blocks.slice(-20);
}
