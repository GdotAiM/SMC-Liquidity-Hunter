/**
 * Unit tests for the ICT Order Block analyzer.
 *
 * Run with:
 *   npx tsx artifacts/api-server/src/lib/smc/order-blocks.test.ts
 */

import { analyzeOrderBlocks } from "./order-blocks.js";
import { analyzeFVG } from "./fvg.js";
import type { Candle } from "./types.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function c(
  time: number, o: number, h: number, l: number, cl: number, vol = 1000,
): Candle {
  return { time, open: o, high: h, low: l, close: cl, volume: vol };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build candles that produce a bullish OB with FVG confluence.
 *
 * Structure:
 *   [flat bars] [bearish OB-source] [bullish displacement + FVG] [flat bars]
 *
 * The displacement candle creates a bullish FVG (prev.high < next.low gap),
 * and the prior bearish candle becomes the bullish OB.
 */
function bullishObWithFvg(): Candle[] {
  const candles: Candle[] = [];
  // Flat preamble for ATR seeding
  for (let i = 0; i < 20; i++) {
    candles.push(c(i, 100, 100.3, 99.7, 100.1));
  }
  // Bearish OB-source candle
  candles.push(c(20, 100.2, 102, 99.5, 100, 1000));
  // Bullish displacement with volume spike → creates FVG
  // prev.high=102, next.low=104 → gap 102→104 is the FVG
  candles.push(c(21, 100, 106, 99, 105, 2500));
  // Gap-filling candle: low = 104 (above prev.high=102 → FVG confirmed)
  candles.push(c(22, 105, 108, 104, 106, 1000));
  // More flat bars
  for (let i = 23; i < 35; i++) {
    candles.push(c(i, 106, 106.5, 105, 106.2));
  }
  return candles;
}

/**
 * Build candles that produce a bearish OB with FVG confluence.
 */
function bearishObWithFvg(): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    candles.push(c(i, 200, 200.3, 199.7, 200.1));
  }
  // Bullish OB-source candle
  candles.push(c(20, 199.5, 200.5, 198, 200, 1000));
  // Bearish displacement with volume spike → creates bearish FVG
  // prev.low=198, next.high=196 → gap 196→198
  candles.push(c(21, 200, 202, 194, 195, 2500));
  // Gap-confirming candle: high = 196 (below prev.low=198)
  candles.push(c(22, 195, 196, 192, 193, 1000));
  for (let i = 23; i < 35; i++) {
    candles.push(c(i, 193, 193.5, 192, 193.2));
  }
  return candles;
}

/** Build candles creating a mitigated bullish OB. */
function mitigatedBullishOb(): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    candles.push(c(i, 100, 100.3, 99.7, 100.1));
  }
  // Bearish OB source
  candles.push(c(20, 100.2, 102, 95, 100, 1000));
  // Bullish displacement
  candles.push(c(21, 100, 107, 99, 106, 2500));
  // Gap confirm
  candles.push(c(22, 106, 109, 104, 108, 1000));
  // More flat bars
  for (let i = 23; i < 28; i++) {
    candles.push(c(i, 108, 108.5, 107, 108.2));
  }
  // Mitigation: price drops back — low touches OB proximal (open=100.2)
  candles.push(c(28, 108, 108.5, 100, 105, 1000));
  for (let i = 29; i < 35; i++) {
    candles.push(c(i, 105, 105.5, 104, 105.2));
  }
  return candles;
}

/** Build candles creating a breaker (bearish close beyond OB distal). */
function breakerBullishOb(): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    candles.push(c(i, 100, 100.3, 99.7, 100.1));
  }
  // Bearish OB source: low=90
  candles.push(c(20, 100.2, 101, 90, 100, 1000));
  // Bullish displacement
  candles.push(c(21, 100, 107, 99, 106, 2500));
  // Gap confirm
  candles.push(c(22, 106, 109, 104, 108, 1000));
  // Flat
  for (let i = 23; i < 28; i++) {
    candles.push(c(i, 108, 108.5, 107, 108.2));
  }
  // Mitigation + breaker on same candle: low touches proximal AND close < distal
  candles.push(c(28, 108, 109, 100, 88, 2000));
  for (let i = 29; i < 37; i++) {
    candles.push(c(i, 88, 89, 86, 87));
  }
  return candles;
}

// ── Test runner ────────────────────────────────────────────────────────────────

async function run() {
  console.log("Order Blocks analyzer test\n");

  // ── 1. Bullish OB detection with FVG confluence ───────────────────────────
  console.log("1. Bullish OB with FVG confluence");
  const bullCandles = bullishObWithFvg();
  const bullFvgs = analyzeFVG(bullCandles, "forex");
  const bullObs = analyzeOrderBlocks(bullCandles, bullFvgs);
  const bullishObs = bullObs.filter(ob => ob.type === "bullish");
  assert(bullishObs.length > 0,
    `bullish OBs found: ${bullishObs.length} (FVG count: ${bullFvgs.length})`);
  if (bullishObs.length > 0) {
    const ob = bullishObs[0];
    assert(ob.type === "bullish", `correct type: ${ob.type}`);
    assert(ob.proximal > ob.distal,
      `proximal=${ob.proximal.toFixed(2)} > distal=${ob.distal.toFixed(2)}`);
    assert(ob.hasFvg === true, "has FVG confluence");
    assert(ob.valid === true, "unmitigated OB is valid");
  }

  // ── 2. Bearish OB detection with FVG confluence ───────────────────────────
  console.log("\n2. Bearish OB with FVG confluence");
  const bearCandles = bearishObWithFvg();
  const bearFvgs = analyzeFVG(bearCandles, "forex");
  const bearObs = analyzeOrderBlocks(bearCandles, bearFvgs);
  const bearishObs = bearObs.filter(ob => ob.type === "bearish");
  assert(bearishObs.length > 0,
    `bearish OBs found: ${bearishObs.length} (FVG count: ${bearFvgs.length})`);
  if (bearishObs.length > 0) {
    const ob = bearishObs[0];
    assert(ob.type === "bearish", `correct type: ${ob.type}`);
    assert(ob.distal > ob.proximal,
      `distal=${ob.distal.toFixed(2)} > proximal=${ob.proximal.toFixed(2)}`);
  }

  // ── 3. Mitigated OB ──────────────────────────────────────────────────────
  console.log("\n3. Mitigated OB");
  const mitCandles = mitigatedBullishOb();
  const mitFvgs = analyzeFVG(mitCandles, "forex");
  const mitObs = analyzeOrderBlocks(mitCandles, mitFvgs);
  const mitBull = mitObs.filter(ob => ob.type === "bullish");
  assert(mitBull.length > 0, `mitigated OB found: ${mitBull.length}`);
  if (mitBull.length > 0) {
    assert(mitBull[0].isMitigated === true, "OB is mitigated");
    assert(mitBull[0].valid === false, "mitigated OB without breaker is invalid");
  }

  // ── 4. Breaker OB ────────────────────────────────────────────────────────
  console.log("\n4. Breaker OB");
  const brkCandles = breakerBullishOb();
  const brkFvgs = analyzeFVG(brkCandles, "forex");
  const brkObs = analyzeOrderBlocks(brkCandles, brkFvgs);
  const brkBulls = brkObs.filter(ob => ob.type === "bullish");
  assert(brkBulls.length > 0, `breaker OB found: ${brkBulls.length}`);
  if (brkBulls.length > 0) {
    const ob = brkBulls[0];
    assert(ob.isBreaker === true, `isBreaker: ${ob.isBreaker}`);
    assert(ob.isMitigated === true, "breaker is mitigated first");
    assert(ob.valid === true, "breaker OB is valid");
  }

  // ── 5. Confidence scoring ────────────────────────────────────────────────
  console.log("\n5. Confidence scoring");
  const confCheck = [...bullObs, ...bearObs];
  assert(confCheck.length > 0, `OBs available for confidence: ${confCheck.length}`);
  for (const ob of confCheck) {
    assert(ob.confidence >= 0.05 && ob.confidence <= 0.97,
      `confidence ∈ [0.05,0.97]: ${ob.confidence.toFixed(3)}`);
    assert(Array.isArray(ob.confidenceFactors), "confidenceFactors is array");
  }

  // ── 6. Strength bounds ───────────────────────────────────────────────────
  console.log("\n6. Strength bounds");
  const allObs = [...bullObs, ...bearObs, ...mitObs, ...brkObs];
  assert(allObs.length > 0, "OBs available for strength check");
  for (const ob of allObs) {
    assert(ob.strength > 0, `strength > 0: ${ob.strength.toFixed(3)}`);
    assert(ob.strength <= 3, `strength capped at 3: ${ob.strength.toFixed(3)}`);
  }

  // ── 7. Type and field integrity ──────────────────────────────────────────
  console.log("\n7. Field integrity");
  for (const ob of allObs) {
    assert(["bullish", "bearish"].includes(ob.type), `valid type: ${ob.type}`);
    assert(typeof ob.valid === "boolean", "valid is boolean");
    assert(typeof ob.isMitigated === "boolean", "isMitigated is boolean");
    assert(typeof ob.isBreaker === "boolean", "isBreaker is boolean");
    assert(typeof ob.hasFvg === "boolean", "hasFvg is boolean");
    assert(ob.index >= 0, `index non-negative: ${ob.index}`);
  }

  // ── 8. Result limit (max 20) ─────────────────────────────────────────────
  console.log("\n8. Result cap at 20");
  const bigCandles: Candle[] = [];
  for (let i = 0; i < 14; i++) bigCandles.push(c(i, 100, 100.5, 99.5, 100.3));
  // Generate many OB candidates
  for (let i = 0; i < 60; i++) {
    const base = 110 + i * 0.5;
    bigCandles.push(c(14 + i * 4, base, base + 1, base - 4, base - 0.5, 1000));  // bearish
    bigCandles.push(c(15 + i * 4, base - 0.5, base + 7, base - 1, base + 6, 2500)); // bull displacement
    bigCandles.push(c(16 + i * 4, base + 6, base + 9, base + 3, base + 7, 1000));  // FVG confirm
    bigCandles.push(c(17 + i * 4, base + 7, base + 8, base + 5, base + 7.5, 1000));
  }
  const bigFvgs = analyzeFVG(bigCandles, "forex");
  const bigObs = analyzeOrderBlocks(bigCandles, bigFvgs);
  assert(bigObs.length <= 20, `capped at 20 (got ${bigObs.length})`);

  // ── 9. Short dataset ─────────────────────────────────────────────────────
  console.log("\n9. Short dataset");
  const shortObs = analyzeOrderBlocks([c(0, 100, 101, 99, 100)], []);
  assert(Array.isArray(shortObs), "returns array");
  assert(shortObs.length === 0, `empty for short data (got ${shortObs.length})`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
