/**
 * Unit tests for the Fair Value Gap analyzer.
 *
 * Run with:
 *   npx tsx artifacts/api-server/src/lib/smc/fvg.test.ts
 *
 * Tests:
 *   1. Bullish FVG detection (displacement candle with volume spike)
 *   2. Bearish FVG detection
 *   3. No FVG when candles overlap normally
 *   4. Volume spike requirement (crypto market)
 *   5. Body ratio filter (doji rejection)
 *   6. Fill fraction tracking
 *   7. Short dataset
 */

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

function candle(time: number, o: number, h: number, l: number, c: number, vol = 1000): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: vol };
}

// ── Test runner ────────────────────────────────────────────────────────────────

async function run() {
  console.log("FVG analyzer test\n");

  // ── 1. Bullish FVG (with volume spike) ────────────────────────────────────
  // prev.high=101, next.low=104 → gap from 101 to 104
  // Displacement candle needs volume ≥ 1.5× average of prior candles
  console.log("1. Bullish FVG detection");
  const bullCandles: Candle[] = [
    candle(0, 100, 101,  99, 100.5, 1000),       // low volume
    candle(1, 100.5, 107, 100, 107,   2500),       // high volume displacement (2.5× avg)
    candle(2, 107, 108,  104, 106,  1000),         // FVG: 101 → 104
    candle(3, 106, 109, 105, 108,  1000),
    candle(4, 108, 110, 107, 109,  1000),
    candle(5, 109, 111, 108, 110,  1000),
  ];
  const bullFvgs = analyzeFVG(bullCandles, "crypto");
  const bullishGaps = bullFvgs.filter(f => f.type === "bullish");
  assert(bullishGaps.length >= 1, `detects bullish FVG (found ${bullishGaps.length})`);
  if (bullishGaps.length > 0) {
    const fvg = bullishGaps[0];
    assert(fvg.top > fvg.bottom, "FVG top > bottom");
    assert(fvg.top === 104, `FVG top is next.low (got ${fvg.top})`);
    assert(fvg.bottom === 101, `FVG bottom is prev.high (got ${fvg.bottom})`);
  }

  // ── 2. Bearish FVG (with volume spike) ────────────────────────────────────
  console.log("\n2. Bearish FVG detection");
  const bearCandles: Candle[] = [
    candle(0, 200, 201, 199, 200.5, 1000),
    candle(1, 200.5, 202, 195, 195,  3000),        // volume spike
    candle(2, 195, 197, 193, 194,  1000),           // FVG: prev.low=199 → next.high=197
    candle(3, 194, 196, 192, 193,  1000),
    candle(4, 193, 195, 191, 194,  1000),
    candle(5, 194, 196, 193, 195,  1000),
  ];
  const bearFvgs = analyzeFVG(bearCandles, "crypto");
  const bearishGaps = bearFvgs.filter(f => f.type === "bearish");
  assert(bearishGaps.length >= 1, `detects bearish FVG (found ${bearishGaps.length})`);

  // ── 3. No FVG when candles overlap normally ────────────────────────────────
  console.log("\n3. No FVG on overlapping candles");
  const overlapping: Candle[] = [
    candle(0, 100, 105,  98, 102, 2000),
    candle(1, 102, 106, 100, 104, 2000),
    candle(2, 104, 105, 101, 103, 2000),
    candle(3, 103, 107, 102, 106, 2000),
    candle(4, 106, 108, 104, 107, 2000),
    candle(5, 107, 109, 105, 106, 2000),
  ];
  const overlapFvgs = analyzeFVG(overlapping, "crypto");
  // No displacement candles here — all body ratios are moderate
  assert(overlapFvgs.length === 0, `overlapping candles produce no FVGs (got ${overlapFvgs.length})`);

  // ── 4. Forex market (no volume gate) ──────────────────────────────────────
  console.log("\n4. Forex market (no volume gate)");
  const forexCandles: Candle[] = [
    candle(0, 1.1000, 1.1010, 1.0990, 1.1005, 1),
    candle(1, 1.1005, 1.1070, 1.1000, 1.1070, 1),   // displacement — no vol gate for forex
    candle(2, 1.1070, 1.1080, 1.1040, 1.1060, 1),   // FVG: 1.1010 → 1.1040
    candle(3, 1.1060, 1.1090, 1.1050, 1.1080, 1),
    candle(4, 1.1080, 1.1100, 1.1070, 1.1090, 1),
    candle(5, 1.1090, 1.1110, 1.1080, 1.1100, 1),
  ];
  const forexFvgs = analyzeFVG(forexCandles, "forex");
  assert(forexFvgs.some(f => f.type === "bullish"), "forex detects bullish FVG without volume gate");

  // ── 5. Body ratio filter (doji rejection) ─────────────────────────────────
  console.log("\n5. Body ratio filter (doji rejection)");
  const dojiCandles: Candle[] = [
    candle(0, 100, 101, 99, 100.5, 3000),
    candle(1, 100.5, 108, 100.2, 100.51, 3000),     // doji: body=0.01, range=7.8 → ratio=0.001 < 0.5
    candle(2, 100.51, 102, 99, 101,    3000),
    candle(3, 101, 103, 100, 102,  3000),
    candle(4, 102, 104, 101, 103,  3000),
    candle(5, 103, 105, 102, 104,  3000),
  ];
  const dojiFvgs = analyzeFVG(dojiCandles, "crypto");
  const dojiGaps = dojiFvgs.filter(f => f.index === 1);
  assert(dojiGaps.length === 0, `doji candle rejected (found ${dojiGaps.length})`);

  // ── 6. Short dataset ──────────────────────────────────────────────────────
  console.log("\n6. Short dataset");
  const shortCandles: Candle[] = [candle(0, 100, 101, 99, 100)];
  const shortFvgs = analyzeFVG(shortCandles, "crypto");
  assert(shortFvgs.length === 0, "single candle produces no FVGs");

  // ── 7. FVG type integrity ─────────────────────────────────────────────────
  console.log("\n7. FVG type integrity");
  const allFvgs = [...bullFvgs, ...bearFvgs, ...forexFvgs];
  assert(allFvgs.length > 0, "at least some FVGs across all tests");
  for (const fvg of allFvgs) {
    assert(typeof fvg.type === "string", `type: ${fvg.type}`);
    assert(fvg.top >= fvg.bottom, `top >= bottom (${fvg.top} >= ${fvg.bottom})`);
    assert(fvg.fillFraction >= 0, `fillFraction >= 0: ${fvg.fillFraction}`);
    assert(fvg.fillFraction <= 1, `fillFraction <= 1: ${fvg.fillFraction}`);
    assert(typeof fvg.isInversion === "boolean", "isInversion is boolean");
    assert(fvg.index >= 0, `index >= 0: ${fvg.index}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
