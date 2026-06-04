import type { Candle, FairValueGap } from "./types.js";
import { SMC_CONFIG } from "./config.js";

function avgVolume(candles: Candle[], i: number, period = 20): number {
  const start = Math.max(0, i - period);
  const slice = candles.slice(start, i);
  if (slice.length === 0) return 1;
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

export function analyzeFVG(candles: Candle[], market: string): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  const volumeMin = SMC_CONFIG.volumeSpikeMin[market] ?? 0;
  const n = candles.length;

  for (let i = 1; i < n - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];

    const bodySize = Math.abs(curr.close - curr.open);
    const rangeSize = curr.high - curr.low;
    if (rangeSize === 0) continue;
    const bodyRatio = bodySize / rangeSize;

    const avgVol = avgVolume(candles, i);
    const volumeSpike = avgVol === 0 ? true : curr.volume / avgVol >= volumeMin;
    const hasDisplacement = bodyRatio >= SMC_CONFIG.fvgMinBodyRatio;

    if (!volumeSpike && volumeMin > 0) continue;

    if (curr.close > curr.open && hasDisplacement) {
      const gapBottom = prev.high;
      const gapTop = next.low;
      if (gapTop > gapBottom) {
        const top = gapTop;
        const bottom = gapBottom;

        let fillFraction = 0;
        let isInversion = false;
        for (let k = i + 2; k < n; k++) {
          const wick = Math.min(candles[k].high, top) - Math.max(candles[k].low, bottom);
          if (wick > 0) {
            fillFraction = Math.min(1, fillFraction + wick / (top - bottom));
          }
          if (fillFraction >= 1.0) {
            if (k + 1 < n && candles[k + 1].close > candles[k + 1].open) {
              isInversion = true;
            }
            break;
          }
        }

        gaps.push({ type: "bullish", top, bottom, time: curr.time, index: i, fillFraction, isInversion });
      }
    }

    if (curr.close < curr.open && hasDisplacement) {
      const gapTop = prev.low;
      const gapBottom = next.high;
      if (gapTop > gapBottom) {
        const top = gapTop;
        const bottom = gapBottom;

        let fillFraction = 0;
        let isInversion = false;
        for (let k = i + 2; k < n; k++) {
          const wick = Math.min(candles[k].high, top) - Math.max(candles[k].low, bottom);
          if (wick > 0) {
            fillFraction = Math.min(1, fillFraction + wick / (top - bottom));
          }
          if (fillFraction >= 1.0) {
            if (k + 1 < n && candles[k + 1].close < candles[k + 1].open) {
              isInversion = true;
            }
            break;
          }
        }

        gaps.push({ type: "bearish", top, bottom, time: curr.time, index: i, fillFraction, isInversion });
      }
    }
  }

  return gaps.slice(-30);
}
