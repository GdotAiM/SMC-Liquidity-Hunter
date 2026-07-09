import type { Candle, SmtDivergence } from "./types.js";

function findLocalExtremes(candles: Candle[], lookback = 5): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows:  number[] = [];
  const n = candles.length;
  for (let i = lookback; i < n - lookback; i++) {
    let isHigh = true;
    let isLow  = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low  <= candles[i].low)  isLow  = false;
    }
    if (isHigh) highs.push(i);
    if (isLow)  lows.push(i);
  }
  return { highs, lows };
}

/**
 * Score SMT confidence using:
 *   - Timing alignment between the two correlated swing highs/lows
 *   - Price divergence magnitude (the bigger the new HH / LL in primary vs
 *     failure of correlated, the stronger the signal)
 *   - Percentage move (normalised for scale-invariance)
 *   - Minimum divergence threshold to reject noise
 */
function calcSmtConfidence(
  divergencePriceDiff: number,   // absolute price move of the new extreme in primary
  referencePrice: number,        // previous extreme price for normalisation
  indexDiff: number,             // bar offset between primary and correlated extremes
  maxIndexDiff: number,          // maximum allowed bar offset
): number | null {
  if (referencePrice === 0) return null;
  const pctDiff = Math.abs(divergencePriceDiff) / referencePrice;

  // Reject extremely weak divergences (< 0.1% move) — likely noise
  if (pctDiff < 0.001) return null;

  // Timing: bars closer together are a stronger signal
  const timingScore = (1 - indexDiff / maxIndexDiff) * 0.3;

  // Magnitude: scale logarithmically so extreme moves don't dominate
  const magnitudeScore = Math.min(0.4, Math.log1p(pctDiff * 200) * 0.1);

  return Math.min(0.92, 0.45 + timingScore + magnitudeScore);
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

  const minLen    = Math.min(primaryCandles.length, correlatedCandles.length);
  const primSlice = primaryCandles.slice(-minLen);
  const corrSlice = correlatedCandles.slice(-minLen);

  const primExtremes = findLocalExtremes(primSlice);
  const corrExtremes = findLocalExtremes(corrSlice);

  const recentHighsPrim = primExtremes.highs.slice(-4);
  const recentHighsCorr = corrExtremes.highs.slice(-4);
  const recentLowsPrim  = primExtremes.lows.slice(-4);
  const recentLowsCorr  = corrExtremes.lows.slice(-4);

  const MAX_IDX_DIFF = 5;

  let bearishSmt = false;
  let bullishSmt = false;
  let smtTime: number | null = null;
  let confidence = 0;

  // ── Bearish SMT: primary made HH but correlated failed ──────────────────────
  for (const ph of recentHighsPrim) {
    for (const ch of recentHighsCorr) {
      const indexDiff = Math.abs(ph - ch);
      if (indexDiff > MAX_IDX_DIFF) continue;

      const primHH       = primSlice[ph].high;
      const prevPrimHigh = primExtremes.highs.slice(0, primExtremes.highs.indexOf(ph)).pop();
      const prevCorrHigh = corrExtremes.highs.slice(0, corrExtremes.highs.indexOf(ch)).pop();

      if (prevPrimHigh === undefined || prevCorrHigh === undefined) continue;

      const primMadeHH = primHH > primSlice[prevPrimHigh].high;
      const corrMadeHH = corrSlice[ch].high > corrSlice[prevCorrHigh].high;

      if (primMadeHH && !corrMadeHH) {
        const newHH   = primHH - primSlice[prevPrimHigh].high;
        const conf    = calcSmtConfidence(newHH, primSlice[prevPrimHigh].high, indexDiff, MAX_IDX_DIFF);
        if (conf !== null && conf > confidence) {
          bearishSmt = true;
          bullishSmt = false;
          smtTime    = primSlice[ph].time;
          confidence = conf;
        }
      }
    }
  }

  // ── Bullish SMT: primary made LL but correlated held ────────────────────────
  for (const pl of recentLowsPrim) {
    for (const cl of recentLowsCorr) {
      const indexDiff = Math.abs(pl - cl);
      if (indexDiff > MAX_IDX_DIFF) continue;

      const primLL      = primSlice[pl].low;
      const prevPrimLow = primExtremes.lows.slice(0, primExtremes.lows.indexOf(pl)).pop();
      const prevCorrLow = corrExtremes.lows.slice(0, corrExtremes.lows.indexOf(cl)).pop();

      if (prevPrimLow === undefined || prevCorrLow === undefined) continue;

      const primMadeLL = primLL < primSlice[prevPrimLow].low;
      const corrMadeLL = corrSlice[cl].low < corrSlice[prevCorrLow].low;

      if (primMadeLL && !corrMadeLL) {
        const newLL = primSlice[prevPrimLow].low - primLL;
        const conf  = calcSmtConfidence(newLL, primSlice[prevPrimLow].low, indexDiff, MAX_IDX_DIFF);
        if (conf !== null && conf > confidence) {
          bullishSmt = true;
          bearishSmt = false;
          smtTime    = primSlice[pl].time;
          confidence = conf;
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
