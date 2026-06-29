import type { Candle, LiquidityPool, LiquidityResult } from "./types.js";
import { SMC_CONFIG } from "./config.js";

function getSession(timestamp: number): string {
  const hour = new Date(timestamp * 1000).getUTCHours();
  if (hour >= 0  && hour < 6)  return "asia";
  if (hour >= 6  && hour < 8)  return "overlap";
  if (hour >= 8  && hour < 12) return "london";
  if (hour >= 12 && hour < 17) return "newYork";
  return "offHours";
}

function getSessionWeight(session: string): number {
  return SMC_CONFIG.sessionWeights[session as keyof typeof SMC_CONFIG.sessionWeights] ?? 1.0;
}

function recencyDecay(index: number, totalBars: number, halfLife: number): number {
  const barsAgo = totalBars - 1 - index;
  return Math.exp(-Math.LN2 * barsAgo / halfLife);
}

function wasSwept(pool: { price: number; type: string }, candle: Candle): boolean {
  if (pool.type === "BSL" || pool.type === "EQH") return candle.close > pool.price;
  return candle.close < pool.price;
}

/**
 * Estimate the probability (0–1) that an unswept pool will be swept soon.
 *
 * Factors:
 *  - Distance from current price (exponential decay — closer = much more likely)
 *  - Number of equal-level touches (more resting orders = more likely to be hunted)
 *  - Session weight (London / NY sweeps are more common)
 *  - Recency (fresh pools are more relevant)
 *
 * HTF bias alignment and nearby OB/FVG confluence are applied at draw-target
 * ranking time in report.ts where that context is available.
 */
function estimateProbabilityOfSweep(
  price: number,
  currentPrice: number,
  touches: number,
  sessW: number,
  decay: number,
): number {
  const distancePct   = Math.abs(price - currentPrice) / currentPrice;
  // Exponential distance penalty: 5% away ≈ 0.22, 1% away ≈ 0.74
  const distanceFactor = Math.exp(-distancePct * 30);

  const touchFactor   = Math.min(1, touches / 4) * 0.25;
  const sessionFactor = ((sessW - 0.8) / 0.7) * 0.15;  // normalise 0.8–1.5 → 0–1
  const recencyFactor = decay * 0.15;

  return Math.min(0.95, Math.max(0.05,
    distanceFactor * 0.45 + touchFactor + sessionFactor + recencyFactor,
  ));
}

export function analyzeLiquidity(candles: Candle[], timeframe: string, market: string): LiquidityResult {
  const n          = candles.length;
  const halfLife   = SMC_CONFIG.liquidityHalfLifeBars[timeframe] ?? 200;
  const threshold  = SMC_CONFIG.equalLevelThreshold;
  const pools: LiquidityPool[] = [];

  const currentPrice = candles[n - 1].close;
  const windowSize   = Math.min(20, Math.floor(n / 4));

  for (let i = windowSize; i < n - 1; i++) {
    const hi = candles[i].high;
    const lo = candles[i].low;

    let isLocalHigh = true;
    let isLocalLow  = true;

    for (let j = i - windowSize; j <= Math.min(i + windowSize, n - 1); j++) {
      if (j === i) continue;
      if (candles[j].high >= hi) isLocalHigh = false;
      if (candles[j].low  <= lo) isLocalLow  = false;
    }

    if (isLocalHigh) {
      const session = getSession(candles[i].time);
      const sessW   = getSessionWeight(session);
      const decay   = recencyDecay(i, n, halfLife);

      let touches  = 1;
      let sweptIdx: number | null = null;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(candles[k].high - hi) / hi < threshold * 5) touches++;
        if (wasSwept({ price: hi, type: "BSL" }, candles[k])) { sweptIdx = k; break; }
      }

      const displaced         = sweptIdx !== null;
      const displacementFactor = displaced ? 1.5 : 1.0;
      const score             = touches * decay * sessW * displacementFactor;
      const probabilityOfSweep = displaced
        ? 0                // already swept — not a future target
        : estimateProbabilityOfSweep(hi, currentPrice, touches, sessW, decay);

      pools.push({
        price: hi, type: "BSL", score, touches,
        wasSwept: displaced,
        sweptAt: sweptIdx !== null ? candles[sweptIdx].time : null,
        time: candles[i].time, index: i, session,
        probabilityOfSweep,
      });
    }

    if (isLocalLow) {
      const session = getSession(candles[i].time);
      const sessW   = getSessionWeight(session);
      const decay   = recencyDecay(i, n, halfLife);

      let touches  = 1;
      let sweptIdx: number | null = null;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(candles[k].low - lo) / lo < threshold * 5) touches++;
        if (wasSwept({ price: lo, type: "SSL" }, candles[k])) { sweptIdx = k; break; }
      }

      const displaced         = sweptIdx !== null;
      const displacementFactor = displaced ? 1.5 : 1.0;
      const score             = touches * decay * sessW * displacementFactor;
      const probabilityOfSweep = displaced
        ? 0
        : estimateProbabilityOfSweep(lo, currentPrice, touches, sessW, decay);

      pools.push({
        price: lo, type: "SSL", score, touches,
        wasSwept: displaced,
        sweptAt: sweptIdx !== null ? candles[sweptIdx].time : null,
        time: candles[i].time, index: i, session,
        probabilityOfSweep,
      });
    }
  }

  const sortedByScore = [...pools].sort((a, b) => b.score - a.score);
  const topPools      = sortedByScore.slice(0, 20);
  const activePools   = topPools.filter(p => !p.wasSwept);
  const bslPools      = activePools.filter(p => p.type === "BSL" && p.price > currentPrice);
  const sslPools      = activePools.filter(p => p.type === "SSL" && p.price < currentPrice);

  const nearestBSL = bslPools.sort((a, b) => a.price - b.price)[0] ?? null;
  const nearestSSL = sslPools.sort((a, b) => b.price - a.price)[0] ?? null;

  return { pools: topPools, nearestBSL, nearestSSL };
}
