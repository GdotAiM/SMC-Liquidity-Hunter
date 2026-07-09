/**
 * Unit tests for the ICT SMT Divergence analyzer.
 *
 * Run with:
 *   npx tsx artifacts/api-server/src/lib/smc/smt.test.ts
 */

import { analyzeSMT } from "./smt.js";
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

function c(time: number, o: number, h: number, l: number, cl: number, vol = 1000): Candle {
  return { time, open: o, high: h, low: l, close: cl, volume: vol };
}

/**
 * Build candles where each pivot bar is an unambiguous, single-bar extreme.
 * Each "cycle" is 12 bars: 10 flat bars + 1 pivot bar + 1 gap bar.
 * All flat bars have a persistent, tiny range so they never compete with
 * the pivot bars in the SMT lookback window.
 */
function buildHHSequence(highs: number[], t0: number): Candle[] {
  const candles: Candle[] = [];
  let t = t0;
  for (const h of highs) {
    // 5 flat bars (tight range, low highs)
    for (let i = 0; i < 5; i++) {
      candles.push(c(t, 95, 96, 94, 95.5));
      t += 3600;
    }
    // 1 clear HH — the ONLY bar with a high this tall in the ±5 window
    candles.push(c(t, h - 2, h, h - 4, h - 1));
    t += 3600;
    // 6 more flat bars
    for (let i = 0; i < 6; i++) {
      candles.push(c(t, 95, 96, 94, 95.5));
      t += 3600;
    }
  }
  return candles;
}

/**
 * Correlated that FAILS to make new highs (bearish SMT setup).
 * Pivot bar stays at the same high level each time.
 */
function buildFailedHHSequence(highs: number[], t0: number): Candle[] {
  const candles: Candle[] = [];
  let t = t0;
  for (const h of highs) {
    for (let i = 0; i < 5; i++) {
      candles.push(c(t, 95, 96, 94, 95.5));
      t += 3600;
    }
    // High stays FLAT (doesn't increase)
    candles.push(c(t, h - 2, 100, h - 4, h - 1)); // peak always 100
    t += 3600;
    for (let i = 0; i < 6; i++) {
      candles.push(c(t, 95, 96, 94, 95.5));
      t += 3600;
    }
  }
  return candles;
}

/**
 * Primary making lower lows (bullish SMT).
 */
function buildLLSequence(lows: number[], t0: number): Candle[] {
  const candles: Candle[] = [];
  let t = t0;
  for (const lo of lows) {
    for (let i = 0; i < 5; i++) {
      candles.push(c(t, 195, 196, 194, 195.5));
      t += 3600;
    }
    // Clear LL — only bar with this low in the window
    candles.push(c(t, lo + 2, lo + 4, lo, lo + 1));
    t += 3600;
    for (let i = 0; i < 6; i++) {
      candles.push(c(t, 195, 196, 194, 195.5));
      t += 3600;
    }
  }
  return candles;
}

/**
 * Correlated that FAILS to make new lows (bullish SMT setup).
 */
function buildFailedLLSequence(lows: number[], t0: number): Candle[] {
  const candles: Candle[] = [];
  let t = t0;
  for (const lo of lows) {
    for (let i = 0; i < 5; i++) {
      candles.push(c(t, 195, 196, 194, 195.5));
      t += 3600;
    }
    // Low stays FLAT
    candles.push(c(t, 192, 194, 190, 191)); // low always 190
    t += 3600;
    for (let i = 0; i < 6; i++) {
      candles.push(c(t, 195, 196, 194, 195.5));
      t += 3600;
    }
  }
  return candles;
}

// ── Test runner ────────────────────────────────────────────────────────────────

async function run() {
  console.log("SMT Divergence analyzer test\n");

  const t0 = 1700000000;

  // ── 1. Bearish SMT: primary makes HH, correlated fails ────────────────────
  console.log("1. Bearish SMT (primary HH, correlated fails)");
  const primHigh = buildHHSequence([105, 115, 125], t0);
  const corrFail = buildFailedHHSequence([105, 115, 125], t0 + 100);
  const bearishSmt = analyzeSMT(primHigh, corrFail, "ES", "NQ");
  console.log(`    detected=${bearishSmt.detected} type=${bearishSmt.type} conf=${bearishSmt.confidence.toFixed(3)}`);
  assert(bearishSmt.detected === true, "bearish SMT detected");
  assert(bearishSmt.type === "bearish_smt", `type is bearish_smt (got: ${bearishSmt.type})`);
  assert(bearishSmt.primarySymbol === "ES", "primarySymbol ES");
  assert(bearishSmt.correlatedSymbol === "NQ", "correlatedSymbol NQ");

  // ── 2. Bullish SMT: primary makes LL, correlated holds ────────────────────
  console.log("\n2. Bullish SMT (primary LL, correlated holds)");
  const primLow = buildLLSequence([185, 175, 165], t0);
  const corrHold = buildFailedLLSequence([185, 175, 165], t0 + 100);
  const bullishSmt = analyzeSMT(primLow, corrHold, "ES", "NQ");
  console.log(`    detected=${bullishSmt.detected} type=${bullishSmt.type} conf=${bullishSmt.confidence.toFixed(3)}`);
  assert(bullishSmt.detected === true, "bullish SMT detected");
  assert(bullishSmt.type === "bullish_smt", `type is bullish_smt (got: ${bullishSmt.type})`);

  // ── 3. No SMT when both move in sync ──────────────────────────────────────
  console.log("\n3. No SMT when both move in sync");
  const bothHH = buildHHSequence([105, 115, 125], t0);
  const alsoHH = buildHHSequence([105, 115, 125], t0 + 100);
  const noSmt = analyzeSMT(bothHH, alsoHH, "ES", "NQ");
  console.log(`    detected=${noSmt.detected} type=${noSmt.type}`);
  assert(noSmt.detected === false, "no SMT when both make HH");
  assert(noSmt.type === null, "type is null");
  assert(noSmt.confidence === 0, "confidence is 0");

  // ── 4. Short dataset → no divergence ──────────────────────────────────────
  console.log("\n4. Short dataset (< 20 bars)");
  const short: Candle[] = [];
  for (let i = 0; i < 10; i++) {
    short.push(c(1700000000 + i * 3600, 100, 101, 99, 100.5));
  }
  const shortSmt = analyzeSMT(short, short, "ES", "NQ");
  assert(shortSmt.detected === false, "short dataset: not detected");
  assert(shortSmt.type === null, "type is null");
  assert(shortSmt.confidence === 0, "confidence is 0");

  // ── 5. Symbol passthrough on no-detection ─────────────────────────────────
  console.log("\n5. Symbol passthrough");
  assert(noSmt.primarySymbol === "ES", "primarySymbol present on no-detect");
  assert(noSmt.correlatedSymbol === "NQ", "correlatedSymbol present on no-detect");

  // ── 6. Confidence bounds [0, 0.92] ────────────────────────────────────────
  console.log("\n6. Confidence bounds");
  assert(bearishSmt.confidence > 0.45, `bearish conf > 0.45: ${bearishSmt.confidence.toFixed(3)}`);
  assert(bearishSmt.confidence <= 0.92, `bearish conf ≤ 0.92: ${bearishSmt.confidence.toFixed(3)}`);
  assert(bullishSmt.confidence > 0.45, `bullish conf > 0.45: ${bullishSmt.confidence.toFixed(3)}`);
  assert(bullishSmt.confidence <= 0.92, `bullish conf ≤ 0.92: ${bullishSmt.confidence.toFixed(3)}`);

  // ── 7. Time field set ─────────────────────────────────────────────────────
  console.log("\n7. Time field");
  assert(bearishSmt.time !== null && bearishSmt.time > 0,
    `bearish SMT time: ${bearishSmt.time}`);
  assert(bullishSmt.time !== null && bullishSmt.time > 0,
    `bullish SMT time: ${bullishSmt.time}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
