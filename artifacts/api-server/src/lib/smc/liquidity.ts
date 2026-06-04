import type { Candle, LiquidityPool, LiquidityResult } from "./types.js";
import { SMC_CONFIG } from "./config.js";

function getSession(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const hour = date.getUTCHours();
  if (hour >= 0 && hour < 6) return "asia";
  if (hour >= 6 && hour < 8) return "overlap";
  if (hour >= 8 && hour < 12) return "london";
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
  if (pool.type === "BSL" || pool.type === "EQH") {
    return candle.close > pool.price;
  }
  return candle.close < pool.price;
}

function wasWickSwept(pool: { price: number; type: string }, candle: Candle): boolean {
  if (pool.type === "BSL" || pool.type === "EQH") {
    return candle.high > pool.price;
  }
  return candle.low < pool.price;
}

export function analyzeLiquidity(candles: Candle[], timeframe: string, market: string): LiquidityResult {
  const n = candles.length;
  const halfLife = SMC_CONFIG.liquidityHalfLifeBars[timeframe] ?? 200;
  const threshold = SMC_CONFIG.equalLevelThreshold;
  const pools: LiquidityPool[] = [];

  const windowSize = Math.min(20, Math.floor(n / 4));

  for (let i = windowSize; i < n - 1; i++) {
    const hi = candles[i].high;
    const lo = candles[i].low;

    let isLocalHigh = true;
    let isLocalLow = true;

    for (let j = i - windowSize; j <= Math.min(i + windowSize, n - 1); j++) {
      if (j === i) continue;
      if (candles[j].high >= hi) isLocalHigh = false;
      if (candles[j].low <= lo) isLocalLow = false;
    }

    if (isLocalHigh) {
      const session = getSession(candles[i].time);
      const sessW = getSessionWeight(session);
      const decay = recencyDecay(i, n, halfLife);

      let touches = 1;
      let sweptIdx: number | null = null;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(candles[k].high - hi) / hi < threshold * 5) touches++;
        if (wasSwept({ price: hi, type: "BSL" }, candles[k])) {
          sweptIdx = k;
          break;
        }
      }

      const displaced = sweptIdx !== null;
      const displacementFactor = displaced ? 1.5 : 1.0;

      const score = touches * decay * sessW * displacementFactor;

      pools.push({
        price: hi,
        type: "BSL",
        score,
        touches,
        wasSwept: displaced,
        sweptAt: sweptIdx !== null ? candles[sweptIdx].time : null,
        time: candles[i].time,
        index: i,
        session,
      });
    }

    if (isLocalLow) {
      const session = getSession(candles[i].time);
      const sessW = getSessionWeight(session);
      const decay = recencyDecay(i, n, halfLife);

      let touches = 1;
      let sweptIdx: number | null = null;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(candles[k].low - lo) / lo < threshold * 5) touches++;
        if (wasSwept({ price: lo, type: "SSL" }, candles[k])) {
          sweptIdx = k;
          break;
        }
      }

      const displaced = sweptIdx !== null;
      const displacementFactor = displaced ? 1.5 : 1.0;
      const score = touches * decay * sessW * displacementFactor;

      pools.push({
        price: lo,
        type: "SSL",
        score,
        touches,
        wasSwept: displaced,
        sweptAt: sweptIdx !== null ? candles[sweptIdx].time : null,
        time: candles[i].time,
        index: i,
        session,
      });
    }
  }

  const sortedByScore = [...pools].sort((a, b) => b.score - a.score);
  const topPools = sortedByScore.slice(0, 20);
  const currentPrice = candles[n - 1].close;

  const activePools = topPools.filter(p => !p.wasSwept);
  const bslPools = activePools.filter(p => p.type === "BSL" && p.price > currentPrice);
  const sslPools = activePools.filter(p => p.type === "SSL" && p.price < currentPrice);

  const nearestBSL = bslPools.sort((a, b) => a.price - b.price)[0] ?? null;
  const nearestSSL = sslPools.sort((a, b) => b.price - a.price)[0] ?? null;

  return {
    pools: topPools,
    nearestBSL,
    nearestSSL,
  };
}
