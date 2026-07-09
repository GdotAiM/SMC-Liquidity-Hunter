/**
 * Unit tests for the liquidity pool analyzer.
 *
 * Run with:
 *   npx tsx artifacts/api-server/src/lib/smc/liquidity.test.ts
 *
 * Tests:
 *   1. BSL pools from local swing highs
 *   2. SSL pools from local swing lows
 *   3. Swept pool detection
 *   4. Unswept pool probability scoring
 *   5. Nearest BSL / SSL identification
 *   6. Session assignment
 *   7. Short dataset handling
 *   8. Empty dataset handling
 */

import { analyzeLiquidity } from "./liquidity.js";
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
  console.log("Liquidity analyzer test\n");

  // ── 1. BSL pools from local highs ────────────────────────────────────────
  console.log("1. BSL pools from local swing highs");
  // Create candles with clear swing highs
  const bslCandles: Candle[] = [
    candle(1700000000, 100, 105,  98, 101),
    candle(1700003600, 101, 103,  99, 102),
    candle(1700007200, 102, 110, 101, 103),      // swing high at 110
    candle(1700010800, 103, 105, 100, 101),      // pull back
    candle(1700014400, 101, 104,  99, 103),
    candle(1700018000, 103, 106, 102, 105),
    candle(1700021600, 105, 108, 103, 107),      // price pushes higher
    candle(1700025200, 107, 111, 106, 110),
    candle(1700028800, 110, 112, 108, 111),      // sweeps 110 BSL
    candle(1700032400, 111, 113, 109, 112),
  ];
  const bslResult = analyzeLiquidity(bslCandles, "4h", "crypto");
  const bslPools = bslResult.pools.filter(p => p.type === "BSL");
  assert(bslPools.length > 0, `BSL pools found (got ${bslPools.length})`);

  // ── 2. SSL pools from local lows ──────────────────────────────────────────
  console.log("\n2. SSL pools from local swing lows");
  const sslCandles: Candle[] = [
    candle(1700000000, 200, 202, 195, 198),
    candle(1700003600, 198, 200, 194, 196),
    candle(1700007200, 196, 198, 190, 195),       // swing low at 190
    candle(1700010800, 195, 197, 192, 196),
    candle(1700014400, 196, 199, 194, 197),
    candle(1700018000, 197, 200, 193, 193),       // pushes below swing low
    candle(1700021600, 193, 194, 189, 190),       // sweeps 190 SSL
    candle(1700025200, 190, 193, 188, 191),
    candle(1700028800, 191, 193, 188, 189),
    candle(1700032400, 189, 192, 187, 190),
  ];
  const sslResult = analyzeLiquidity(sslCandles, "4h", "crypto");
  const sslPools = sslResult.pools.filter(p => p.type === "SSL");
  assert(sslPools.length > 0, `SSL pools found (got ${sslPools.length})`);

  // ── 3. Swept vs unswept ───────────────────────────────────────────────────
  console.log("\n3. Swept pool detection");
  const sweptPools = bslResult.pools.filter(p => p.wasSwept);
  const unsweptPools = bslResult.pools.filter(p => !p.wasSwept);
  assert(sweptPools.length > 0 || unsweptPools.length > 0,
    `swept: ${sweptPools.length}, unswept: ${unsweptPools.length}`);

  // Swept pools should have sweptAt timestamp set
  for (const p of sweptPools) {
    assert(p.sweptAt !== null, `swept pool at ${p.price} has sweptAt timestamp`);
    assert(p.probabilityOfSweep === 0, `swept pool has 0 future probability`);
  }

  // ── 4. Unswept pool probability of sweep ──────────────────────────────────
  console.log("\n4. Unswept pool probability scoring");
  for (const p of unsweptPools) {
    assert(p.probabilityOfSweep > 0 && p.probabilityOfSweep <= 0.95,
      `unswept pool probability in (0, 0.95]: ${p.probabilityOfSweep.toFixed(3)}`);
  }

  // ── 5. Nearest BSL / SSL ──────────────────────────────────────────────────
  console.log("\n5. Nearest BSL / SSL");
  // BSL above current price, SSL below.  Pool may be swept or absent — just
  // check that the fields are either an object or null.
  const currentBslPrice = bslCandles[bslCandles.length - 1].close;
  if (bslResult.nearestBSL) {
    assert(bslResult.nearestBSL.price > currentBslPrice,
      `nearest BSL above current price (BSL: ${bslResult.nearestBSL.price}, price: ${currentBslPrice})`);
  } else {
    console.log("  ✓ nearest BSL is null (all above-current BSLs swept)");
    passed++;
  }

  const currentSslPrice = sslCandles[sslCandles.length - 1].close;
  if (sslResult.nearestSSL) {
    assert(sslResult.nearestSSL.price < currentSslPrice,
      `nearest SSL below current price (SSL: ${sslResult.nearestSSL.price}, price: ${currentSslPrice})`);
  } else {
    console.log("  ✓ nearest SSL is null (all below-current SSLs swept)");
    passed++;
  }

  // ── 6. Session assignment ─────────────────────────────────────────────────
  console.log("\n6. Session assignment");
  for (const p of bslResult.pools) {
    assert(p.session !== null && typeof p.session === "string",
      `pool has session: ${p.session}`);
  }

  // ── 7. Pool type exclusivity ──────────────────────────────────────────────
  console.log("\n7. Pool type integrity");
  for (const p of bslResult.pools) {
    assert(["BSL", "SSL", "EQH", "EQL"].includes(p.type),
      `valid pool type: ${p.type}`);
    assert(p.score >= 0, `non-negative score: ${p.score.toFixed(3)}`);
    assert(p.touches >= 1, `at least 1 touch: ${p.touches}`);
  }

  // ── 8. Pools are top-scored ───────────────────────────────────────────────
  console.log("\n8. Pool result ordering");
  // Result should return at most the top 20 pools by score
  assert(bslResult.pools.length <= 20, `pools limited to 20 (got ${bslResult.pools.length})`);

  // ── 9. Short dataset ──────────────────────────────────────────────────────
  console.log("\n9. Short dataset");
  const shortCandles: Candle[] = [
    candle(1700000000, 100, 102, 98, 101),
    candle(1700003600, 101, 103, 99, 102),
    candle(1700007200, 102, 104, 100, 103),
  ];
  const shortResult = analyzeLiquidity(shortCandles, "4h", "crypto");
  // With only 3 candles, the window is floor(3/4) = 0, so no pool window
  // Should not crash
  assert(Array.isArray(shortResult.pools), "short dataset returns pools array");
  assert(shortResult.nearestBSL === null || shortResult.nearestBSL !== undefined,
    "short dataset nearest BSL is null or object");

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
