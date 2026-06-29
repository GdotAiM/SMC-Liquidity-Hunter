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

/**
 * ICT pivot detection — structure-only, no candle-colour filter.
 * Highs and lows are determined purely by price position relative to neighbours.
 * Requiring a bullish candle for a swing high or bearish candle for a swing low
 * is incorrect and suppresses many valid ICT pivots.
 */
function findPivots(
  candles: Candle[],
  atr: number[],
  lookback: number,
): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  const n = candles.length;

  for (let i = lookback; i < n - lookback; i++) {
    const c = candles[i];
    const noise = atr[i] * 0.5;

    let isHigh = true;
    let isLow  = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high - noise) isHigh = false;
      if (candles[j].low  <= c.low  + noise) isLow  = false;
    }

    // ICT: pivots depend only on price structure, NOT candle colour
    if (isHigh) highs.push(i);
    if (isLow)  lows.push(i);
  }

  return { highs, lows };
}

/**
 * Infer the current ICT market phase from recent BOS/CHoCH pattern.
 *   Expansion      — consecutive BOS in bias direction
 *   Continuation   — CHoCH followed by BOS in bias direction
 *   Manipulation   — CHoCH against the prior bias (stop hunt / liquidity grab)
 *   Distribution   — bearish CHoCH after bullish structure
 *   Accumulation   — no clear breaks or alternating directions (ranging)
 */
function detectPhase(
  breaks: StructureBreak[],
  bias: "bullish" | "bearish" | "neutral",
): "accumulation" | "manipulation" | "expansion" | "distribution" | "continuation" | "unknown" {
  if (breaks.length === 0) return "accumulation";

  const recent = breaks.slice(-5);
  const last   = recent[recent.length - 1];
  const prev   = recent[recent.length - 2];

  // Two or more BOS in the same direction as current bias → expansion
  const bosSameDir = recent.filter(b => b.type === "BOS" && b.direction === bias);
  if (bosSameDir.length >= 2) return "expansion";

  // CHoCH immediately followed by BOS in same direction → confirmed continuation
  if (prev?.type === "CHoCH" && last?.type === "BOS" && last.direction === bias) {
    return "continuation";
  }

  // Terminal CHoCH — determines reversal type
  if (last.type === "CHoCH") {
    if (last.direction === "bullish") return "manipulation";   // bullish sweep of lows then reversal up
    if (last.direction === "bearish") return "distribution";   // bearish sweep of highs then roll over
  }

  // Mixed BOS directions → accumulation / ranging
  const hasMixed =
    recent.some(b => b.direction === "bullish") &&
    recent.some(b => b.direction === "bearish");
  if (hasMixed) return "accumulation";

  if (bias !== "neutral" && recent.some(b => b.direction === bias)) return "continuation";

  return "unknown";
}

/** Build a readable narrative sentence from structure components. */
function buildNarrative(
  phase: string,
  bias: string,
  breaks: StructureBreak[],
  pivots: StructurePoint[],
): string {
  const parts: string[] = [];

  const phaseLines: Record<string, string> = {
    expansion:    `${bias === "bullish" ? "Bullish" : "Bearish"} expansion in progress.`,
    continuation: `${bias === "bullish" ? "Bullish" : "Bearish"} continuation confirmed.`,
    manipulation: "Manipulation sweep detected — potential reversal setup.",
    distribution: "Distribution phase underway — watch for bearish reversal.",
    accumulation: "Price consolidating inside accumulation range.",
    unknown:      "Structure unclear — wait for confirmation.",
  };
  if (phaseLines[phase]) parts.push(phaseLines[phase]);

  const lastBreak = breaks[breaks.length - 1];
  if (lastBreak) {
    parts.push(`${lastBreak.type} ${lastBreak.direction} confirmed.`);
  }

  const recent = pivots.slice(-6);
  const hh = recent.filter(p => p.type === "HH").length;
  const hl = recent.filter(p => p.type === "HL").length;
  const ll = recent.filter(p => p.type === "LL").length;
  const lh = recent.filter(p => p.type === "LH").length;

  if (hh >= 2 && hl >= 1)      parts.push("HH–HL sequence intact.");
  else if (ll >= 2 && lh >= 1) parts.push("LL–LH sequence intact.");
  else if (hh >= 1 && ll >= 1) parts.push("Conflicting pivots — ranging.");

  return parts.join(" ");
}

/** Evidence bullets explaining the bias and confidence. */
function buildEvidence(
  bias: string,
  phase: string,
  breaks: StructureBreak[],
  confidence: number,
): string[] {
  const ev: string[] = [];

  if (bias !== "neutral") {
    ev.push(`${bias === "bullish" ? "✓" : "✗"} ${bias.charAt(0).toUpperCase() + bias.slice(1)} bias`);
  }

  const lastBreak = breaks[breaks.length - 1];
  if (lastBreak) {
    ev.push(`✓ ${lastBreak.type} ${lastBreak.direction}`);
  }

  const phaseEv: Record<string, string> = {
    expansion:    "✓ Expansion phase",
    continuation: "✓ Continuation phase",
    manipulation: "◐ Manipulation sweep",
    distribution: "✗ Distribution phase",
    accumulation: "◐ Accumulation / ranging",
  };
  if (phaseEv[phase]) ev.push(phaseEv[phase]);

  if (confidence > 0.75) ev.push("✓ High confidence structure");
  else if (confidence < 0.45) ev.push("◐ Low confidence — wait");

  return ev;
}

export function analyzeStructure(candles: Candle[], timeframe = "4h"): StructureResult {
  const pivotLookback = SMC_CONFIG.pivotLookbackPerTf[timeframe] ?? SMC_CONFIG.pivotLookback;
  const atrPeriod     = SMC_CONFIG.atrPeriodPerTf[timeframe]     ?? SMC_CONFIG.atrPeriod;

  const atr = calcATR(candles, atrPeriod);
  const { highs, lows } = findPivots(candles, atr, pivotLookback);

  const pivots: StructurePoint[] = [];
  const breaks: StructureBreak[] = [];

  let lastHH: number | null = null;
  let lastHL: number | null = null;
  let lastLH: number | null = null;
  let lastLL: number | null = null;

  const allPivotIndices = [
    ...highs.map(i => ({ i, isHigh: true  })),
    ...lows.map( i => ({ i, isHigh: false })),
  ].sort((a, b) => a.i - b.i);

  for (const { i, isHigh } of allPivotIndices) {
    const price     = isHigh ? candles[i].high : candles[i].low;
    const totalBars = candles.length;

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

  // ── Bias via weighted recency ──────────────────────────────────────────────
  const recentPivots = pivots.slice(-12);
  const bullishPivots = recentPivots.filter(p => p.type === "HH" || p.type === "HL");
  const bearishPivots = recentPivots.filter(p => p.type === "LH" || p.type === "LL");

  const totalBars = candles.length;
  const weightedBullish = bullishPivots.reduce((acc, p) => acc + (0.5 + 0.5 * (p.index / totalBars)), 0);
  const weightedBearish = bearishPivots.reduce((acc, p) => acc + (0.5 + 0.5 * (p.index / totalBars)), 0);
  const totalWeight = weightedBullish + weightedBearish;

  let trend: "bullish" | "bearish" | "ranging" = "ranging";
  let bias:  "bullish" | "bearish" | "neutral"  = "neutral";
  let confidence = 0.5;

  if (totalWeight > 0) {
    const bullishRatio = weightedBullish / totalWeight;
    if (bullishRatio > 0.65) {
      trend = "bullish"; bias = "bullish"; confidence = Math.min(0.95, bullishRatio);
    } else if (bullishRatio < 0.35) {
      trend = "bearish"; bias = "bearish"; confidence = Math.min(0.95, 1 - bullishRatio);
    } else {
      trend = "ranging"; bias = "neutral"; confidence = 1 - Math.abs(bullishRatio - 0.5) * 4;
    }
  }

  // Most recent structure break overrides bias (last BOS/CHoCH is ground truth)
  const lastBreaks = breaks.slice(-3);
  if (lastBreaks.length > 0) {
    bias = lastBreaks[lastBreaks.length - 1].direction;
  }

  const phase    = detectPhase(breaks, bias);
  const narrative = buildNarrative(phase, bias, breaks, pivots);
  const evidence  = buildEvidence(bias, phase, breaks, confidence);

  return {
    trend,
    bias,
    confidence,
    pivots:  pivots.slice(-50),
    breaks:  breaks.slice(-20),
    phase,
    narrative,
    evidence,
  };
}
