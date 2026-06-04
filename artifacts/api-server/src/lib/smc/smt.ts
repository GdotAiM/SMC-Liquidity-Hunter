import type { Candle, SmtDivergence } from "./types.js";

function findLocalExtremes(candles: Candle[], lookback = 5): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  const n = candles.length;
  for (let i = lookback; i < n - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

export function analyzeSMT(
  primaryCandles: Candle[],
  correlatedCandles: Candle[],
  primarySymbol: string,
  correlatedSymbol: string,
): SmtDivergence {
  if (primaryCandles.length < 20 || correlatedCandles.length < 20) {
    return { detected: false, type: null, confidence: 0, time: null, primarySymbol, correlatedSymbol };
  }

  const minLen = Math.min(primaryCandles.length, correlatedCandles.length);
  const primSlice = primaryCandles.slice(-minLen);
  const corrSlice = correlatedCandles.slice(-minLen);

  const primExtremes = findLocalExtremes(primSlice);
  const corrExtremes = findLocalExtremes(corrSlice);

  const recentHighsPrim = primExtremes.highs.slice(-4);
  const recentHighsCorr = corrExtremes.highs.slice(-4);
  const recentLowsPrim = primExtremes.lows.slice(-4);
  const recentLowsCorr = corrExtremes.lows.slice(-4);

  let bearishSmt = false;
  let bullishSmt = false;
  let smtTime: number | null = null;
  let confidence = 0;

  for (const ph of recentHighsPrim) {
    for (const ch of recentHighsCorr) {
      const indexDiff = Math.abs(ph - ch);
      if (indexDiff <= 5) {
        const primHH = primSlice[ph].high;
        const corrHH = corrSlice[ch].high;

        const prevPrimHigh = primExtremes.highs.slice(0, -1).pop();
        const prevCorrHigh = corrExtremes.highs.slice(0, -1).pop();

        if (prevPrimHigh !== undefined && prevCorrHigh !== undefined) {
          const primMadeHH = primHH > primSlice[prevPrimHigh].high;
          const corrMadeHH = corrHH > corrSlice[prevCorrHigh].high;

          if (primMadeHH && !corrMadeHH) {
            bearishSmt = true;
            smtTime = primSlice[ph].time;
            confidence = Math.min(0.9, 0.6 + (1 - indexDiff / 5) * 0.3);
          }
        }
      }
    }
  }

  for (const pl of recentLowsPrim) {
    for (const cl of recentLowsCorr) {
      const indexDiff = Math.abs(pl - cl);
      if (indexDiff <= 5) {
        const primLL = primSlice[pl].low;
        const corrLL = corrSlice[cl].low;

        const prevPrimLow = primExtremes.lows.slice(0, -1).pop();
        const prevCorrLow = corrExtremes.lows.slice(0, -1).pop();

        if (prevPrimLow !== undefined && prevCorrLow !== undefined) {
          const primMadeLL = primLL < primSlice[prevPrimLow].low;
          const corrMadeLL = corrLL < corrSlice[prevCorrLow].low;

          if (primMadeLL && !corrMadeLL) {
            bullishSmt = true;
            smtTime = primSlice[pl].time;
            confidence = Math.min(0.9, 0.6 + (1 - indexDiff / 5) * 0.3);
          }
        }
      }
    }
  }

  if (bearishSmt) {
    return { detected: true, type: "bearish_smt", confidence, time: smtTime, primarySymbol, correlatedSymbol };
  }
  if (bullishSmt) {
    return { detected: true, type: "bullish_smt", confidence, time: smtTime, primarySymbol, correlatedSymbol };
  }

  return { detected: false, type: null, confidence: 0, time: null, primarySymbol, correlatedSymbol };
}
