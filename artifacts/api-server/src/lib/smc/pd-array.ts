import type { Candle, PdArrayResult, PdZone, DealingRange } from "./types.js";

function findDealingRange(candles: Candle[], timeframe: string, windowBars: number): DealingRange {
  const slice = candles.slice(-windowBars);
  const high = Math.max(...slice.map(c => c.high));
  const low = Math.min(...slice.map(c => c.low));
  return { high, low, timeframe };
}

export function analyzePdArray(candles: Candle[], timeframe: string): PdArrayResult {
  const n = candles.length;
  const currentPrice = candles[n - 1].close;

  const sessionWindow = Math.min(24, Math.floor(n * 0.1));
  const dailyWindow = Math.min(60, Math.floor(n * 0.3));

  const sessionRange = findDealingRange(candles, `${timeframe} session`, sessionWindow);
  const dailyRange = findDealingRange(candles, `${timeframe} swing`, dailyWindow);

  const sessionEq = (sessionRange.high + sessionRange.low) / 2;
  const dailyEq = (dailyRange.high + dailyRange.low) / 2;

  const zones: PdZone[] = [];

  const sessionPremiumTop = sessionRange.high;
  const sessionPremiumBottom = sessionEq + (sessionRange.high - sessionEq) * 0.5;
  const sessionDiscountTop = sessionEq - (sessionEq - sessionRange.low) * 0.5;
  const sessionDiscountBottom = sessionRange.low;

  zones.push({
    label: "Session Premium",
    top: sessionPremiumTop,
    bottom: sessionPremiumBottom,
    timeframe: `${timeframe} (recent)`,
    type: "premium",
  });

  zones.push({
    label: "Session Equilibrium",
    top: sessionEq * 1.001,
    bottom: sessionEq * 0.999,
    timeframe: `${timeframe} (recent)`,
    type: "equilibrium",
  });

  zones.push({
    label: "Session Discount",
    top: sessionDiscountTop,
    bottom: sessionDiscountBottom,
    timeframe: `${timeframe} (recent)`,
    type: "discount",
  });

  const dailyPremiumTop = dailyRange.high;
  const dailyPremiumBottom = dailyEq + (dailyRange.high - dailyEq) * 0.5;
  const dailyDiscountTop = dailyEq - (dailyEq - dailyRange.low) * 0.5;
  const dailyDiscountBottom = dailyRange.low;

  zones.push({
    label: "Swing Premium",
    top: dailyPremiumTop,
    bottom: dailyPremiumBottom,
    timeframe: `${timeframe} (swing)`,
    type: "premium",
  });

  zones.push({
    label: "Swing Equilibrium",
    top: dailyEq * 1.001,
    bottom: dailyEq * 0.999,
    timeframe: `${timeframe} (swing)`,
    type: "equilibrium",
  });

  zones.push({
    label: "Swing Discount",
    top: dailyDiscountTop,
    bottom: dailyDiscountBottom,
    timeframe: `${timeframe} (swing)`,
    type: "discount",
  });

  let currentBias: "premium" | "discount" | "equilibrium" = "equilibrium";
  const eqBuffer = (sessionRange.high - sessionRange.low) * 0.1;
  if (currentPrice > sessionEq + eqBuffer) currentBias = "premium";
  else if (currentPrice < sessionEq - eqBuffer) currentBias = "discount";

  return {
    currentBias,
    zones,
    dealingRange: sessionRange,
    equilibrium: sessionEq,
  };
}
