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

// ── Session state inference ────────────────────────────────────────────────────

function getSessionHour(candles: Candle[]): number {
  return new Date(candles[candles.length - 1].time * 1000).getUTCHours();
}

/**
 * Derive a human-readable ICT session state from session time + structure context.
 * Possible states: Asian Range Formation, London Liquidity Sweep, London Expansion,
 * NY Open, NY Continuation, NY Retracement, PM Distribution, Late Session.
 */
function deriveSessionState(
  candles: Candle[],
  bias: string,
  trend: string,
  phase: string,
  pdBias: string,
): string {
  if (candles.length === 0) return "Unknown";
  const hour = getSessionHour(candles);

  if (hour >= 0 && hour < 6) {
    return "Asian Range Formation";
  }

  if (hour >= 6 && hour < 8) {
    // London-Asia overlap — prime sweep territory
    if (bias === "bullish" && pdBias === "discount") return "London Liquidity Sweep (Bullish Setup)";
    if (bias === "bearish" && pdBias === "premium")  return "London Liquidity Sweep (Bearish Setup)";
    return "London Open — Awaiting Sweep";
  }

  if (hour >= 8 && hour < 12) {
    if (phase === "expansion" && bias === "bullish") return "London Expansion — Bullish";
    if (phase === "expansion" && bias === "bearish") return "London Expansion — Bearish";
    if (phase === "manipulation")                    return "London Manipulation Sweep";
    if (trend === "ranging")                         return "London Consolidation";
    return "London Session Active";
  }

  if (hour >= 12 && hour < 14) {
    return "NY Open / London Close";
  }

  if (hour >= 14 && hour < 17) {
    if (phase === "continuation" && bias === "bullish") return "NY Continuation — Bullish";
    if (phase === "continuation" && bias === "bearish") return "NY Continuation — Bearish";
    if (pdBias === "discount" && bias === "bullish")    return "NY Retracement — Seeking Discount";
    if (pdBias === "premium"  && bias === "bearish")    return "NY Retracement — Seeking Premium";
    return "NY Session Active";
  }

  if (hour >= 17 && hour < 20) {
    return "PM Distribution";
  }

  return "Late / Off-Hours Session";
}

// ── Market narrative builder ───────────────────────────────────────────────────

function fmtPriceSimple(p: number): string {
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1)     return p.toFixed(4);
  return p.toFixed(6);
}

/**
 * Build an institutional-quality market narrative for AI agents and UI.
 * Reads left-to-right: HTF context → session → structure event → entry context → objective.
 */
function buildMarketNarrative(
  report: Omit<SmcReport, "narrative" | "sessionState">,
): string {
  const parts: string[] = [];
  const bias  = report.structure.bias;
  const phase = report.structure.phase;

  // 1. Daily bias context
  if (report.dailyBias.bias !== "neutral") {
    parts.push(`Daily ${report.dailyBias.bias}.`);
  }

  // 2. Session state (we have it derived below but can infer here inline)
  const lastTs = report.candles[report.candles.length - 1]?.time ?? 0;
  const hour = new Date(lastTs * 1000).getUTCHours();
  if (hour >= 6 && hour < 8) {
    const recentSwept = report.liquidity.pools.find(p =>
      p.wasSwept && (Date.now() / 1000 - p.time) < 14400,
    );
    if (recentSwept) {
      parts.push(`London swept ${recentSwept.type}.`);
    }
  }

  // 3. Most recent structure event
  const lastBreak = report.structure.breaks[report.structure.breaks.length - 1];
  if (lastBreak) {
    const label = lastBreak.type === "BOS" ? "BOS" : "CHoCH";
    parts.push(`${label} ${lastBreak.direction} confirmed.`);
  }

  // 4. Price location context
  if (report.pdArray.currentBias !== "equilibrium") {
    const obContext = report.orderBlocks
      .filter(ob => ob.valid && !ob.isMitigated && ob.type === (bias === "bullish" ? "bullish" : "bearish"))
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (obContext) {
      const obDir = obContext.type === "bullish" ? "bullish" : "bearish";
      const hasFvg = obContext.hasFvg ? " with FVG confluence" : "";
      parts.push(
        `Price returned into ${obDir} order block${hasFvg} inside ${report.pdArray.currentBias}.`,
      );
    } else {
      parts.push(`Price in ${report.pdArray.currentBias} zone.`);
    }
  }

  // 5. SMT context
  if (report.smt.detected) {
    const smtDir = report.smt.type === "bullish_smt" ? "bullish" : "bearish";
    parts.push(`SMT divergence (${smtDir}) supports direction.`);
  }

  // 6. Nearest objective
  const topDraw = report.draw[0];
  if (topDraw) {
    parts.push(`Nearest objective: ${topDraw.type} at ${fmtPriceSimple(topDraw.price)}.`);
  }

  return parts.filter(Boolean).join(" ");
}

// ── Confluence-based draw target scoring ─────────────────────────────────────

/**
 * Determine whether a nearby order block or FVG is confluent with a given price level.
 * Used to boost draw target scores beyond simple liquidity proximity.
 */
function confluenceBoost(
  price: number,
  orderBlocks: SmcReport["orderBlocks"],
  fvgs: SmcReport["fvg"],
  bias: string,
  pdBias: string,
  smt: SmcReport["smt"],
): { multiplier: number; evidence: string[] } {
  let multiplier = 1.0;
  const evidence: string[] = [];

  const obProximityPct = 0.005; // 0.5% proximity check
  const nearOB = orderBlocks.find(
    ob => ob.valid && !ob.isMitigated && Math.abs(ob.proximal - price) / price < obProximityPct,
  );
  if (nearOB) {
    multiplier += nearOB.confidence * 0.35;
    evidence.push(`✓ ${nearOB.type === "bullish" ? "Bullish" : "Bearish"} OB nearby`);
  }

  const nearFVG = fvgs.find(g => g.fillFraction < 0.5 && price >= g.bottom && price <= g.top);
  if (nearFVG) {
    multiplier += 0.20;
    evidence.push("✓ FVG confluence");
  }

  if (pdBias === "discount" && bias === "bullish") {
    multiplier += 0.10;
    evidence.push("✓ Discount zone (bullish)");
  } else if (pdBias === "premium" && bias === "bearish") {
    multiplier += 0.10;
    evidence.push("✓ Premium zone (bearish)");
  }

  if (smt.detected) {
    multiplier += 0.08;
    evidence.push("✓ SMT divergence");
  }

  return { multiplier, evidence };
}

// ── Main report builder ───────────────────────────────────────────────────────

export function buildReport(
  candles: Candle[],
  symbol: string,
  market: Market,
  timeframe: string,
  options: BuildReportOptions = {},
): SmcReport {
  const structure  = analyzeStructure(candles, timeframe);
  const fvg        = analyzeFVG(candles, market);
  const liquidity  = analyzeLiquidity(candles, timeframe, market);
  const orderBlocks = analyzeOrderBlocks(candles, fvg);
  const pdArray    = analyzePdArray(candles, timeframe);
  const dailyBias  = analyzeDailyBias(options.dailyCandles ?? []);

  // Apply HTF bias alignment to OB confidence (available here where bias is known)
  const bias = structure.bias !== "neutral" ? structure.bias : dailyBias.bias;
  for (const ob of orderBlocks) {
    if (ob.type === (bias === "bullish" ? "bullish" : "bearish")) {
      ob.confidence = Math.min(0.97, ob.confidence + 0.12);
      ob.confidenceFactors.unshift("✓ HTF bias aligned");
    } else if (bias !== "neutral") {
      ob.confidence = Math.max(0.05, ob.confidence - 0.15);
      ob.confidenceFactors.push("✗ Counter-trend OB");
    }
  }

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

  // ── Build draw targets with confluence-boosted scoring ─────────────────────
  const draw: DrawTarget[] = [];

  if (liquidity.nearestBSL) {
    const pool      = liquidity.nearestBSL;
    const proximity = 1 / (1 + Math.abs(pool.price - currentPrice) / currentPrice * 100);
    const biasScore = bias === "bullish" ? 1.5 : 0.8;
    const baseScore = pool.score * proximity * biasScore;
    const { multiplier, evidence } = confluenceBoost(pool.price, orderBlocks, fvg, bias, pdArray.currentBias, smt);
    const ev = [`✓ BSL @ ${fmtPriceSimple(pool.price)}`, `Prob sweep: ${Math.round(pool.probabilityOfSweep * 100)}%`, ...evidence];
    draw.push({
      price: pool.price, type: "BSL", score: baseScore * multiplier,
      direction: "long", label: `Buy-side Liquidity @ ${pool.price.toFixed(5)}`,
      evidence: ev,
    });
  }

  if (liquidity.nearestSSL) {
    const pool      = liquidity.nearestSSL;
    const proximity = 1 / (1 + Math.abs(pool.price - currentPrice) / currentPrice * 100);
    const biasScore = bias === "bearish" ? 1.5 : 0.8;
    const baseScore = pool.score * proximity * biasScore;
    const { multiplier, evidence } = confluenceBoost(pool.price, orderBlocks, fvg, bias, pdArray.currentBias, smt);
    const ev = [`✓ SSL @ ${fmtPriceSimple(pool.price)}`, `Prob sweep: ${Math.round(pool.probabilityOfSweep * 100)}%`, ...evidence];
    draw.push({
      price: pool.price, type: "SSL", score: baseScore * multiplier,
      direction: "short", label: `Sell-side Liquidity @ ${pool.price.toFixed(5)}`,
      evidence: ev,
    });
  }

  const validOBs = orderBlocks.filter(ob => ob.valid && !ob.isMitigated).slice(-3);
  for (const ob of validOBs) {
    const direction = ob.type === "bullish" ? "long" : "short";
    const biasScore = (ob.type === "bullish" && bias === "bullish") ||
                      (ob.type === "bearish" && bias === "bearish") ? 1.3 : 0.7;
    const baseScore = ob.strength * ob.confidence * biasScore;
    const { multiplier, evidence } = confluenceBoost(ob.proximal, orderBlocks, fvg, bias, pdArray.currentBias, smt);
    draw.push({
      price: ob.proximal,
      type:  `${ob.type === "bullish" ? "Bullish" : "Bearish"} OB`,
      score: baseScore * multiplier,
      direction,
      label: `${ob.type === "bullish" ? "Bullish" : "Bearish"} OB @ ${ob.proximal.toFixed(5)}`,
      evidence: [
        `Conf: ${Math.round(ob.confidence * 100)}%`,
        ...ob.confidenceFactors.slice(0, 3),
        ...evidence,
      ],
    });
  }

  const unfilledFVGs = fvg.filter(g => g.fillFraction < 0.5).slice(-3);
  for (const gap of unfilledFVGs) {
    const midpoint  = (gap.top + gap.bottom) / 2;
    const direction = gap.type === "bullish" ? "long" : "short";
    const biasScore = gap.type === (bias === "bullish" ? "bullish" : "bearish") ? 1.15 : 0.7;
    const baseScore = 0.6 * biasScore;
    const { multiplier, evidence } = confluenceBoost(midpoint, orderBlocks, fvg, bias, pdArray.currentBias, smt);
    draw.push({
      price: midpoint,
      type:  `${gap.type === "bullish" ? "Bullish" : "Bearish"} FVG`,
      score: baseScore * multiplier,
      direction,
      label: `${gap.type === "bullish" ? "Bullish" : "Bearish"} FVG @ ${midpoint.toFixed(5)}`,
      evidence: [
        `Fill: ${Math.round(gap.fillFraction * 100)}%`,
        gap.isInversion ? "✓ Inversion FVG" : "",
        ...evidence,
      ].filter(Boolean),
    });
  }

  draw.sort((a, b) => b.score - a.score);

  const sessionState = deriveSessionState(
    candles, structure.bias, structure.trend, structure.phase, pdArray.currentBias,
  );

  const recentCandles = candles.slice(-100);

  // Build preliminary report (without narrative) to pass into narrative builder
  const partial = {
    symbol, market, timeframe, currentPrice,
    generatedAt: Date.now() / 1000,
    candles: recentCandles,
    structure, liquidity, orderBlocks, fvg, pdArray, dailyBias, smt,
    draw: draw.slice(0, 5),
  };

  const narrative = buildMarketNarrative(partial as SmcReport);

  return { ...partial, narrative, sessionState };
}
