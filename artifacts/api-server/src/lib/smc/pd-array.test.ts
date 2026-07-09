/**
 * Unit tests for the ICT Premium/Discount array analyzer.
 *
 * Run with:
 *   npx tsx artifacts/api-server/src/lib/smc/pd-array.test.ts
 */

import { analyzePdArray } from "./pd-array.js";
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

function c(time: number, o: number, h: number, l: number, cl: number): Candle {
  return { time, open: o, high: h, low: l, close: cl, volume: 1000 };
}

// ── Test runner ────────────────────────────────────────────────────────────────

async function run() {
  console.log("PD Array analyzer test\n");

  // ── 1. Premium bias when price is above equilibrium ───────────────────────
  console.log("1. Premium bias (price above equilibrium)");
  const premiumCandles: Candle[] = [];
  let t = 1700000000;
  // Range 100-200, current price near the top (~190)
  for (let i = 0; i < 50; i++) {
    const mid = 150;
    premiumCandles.push(c(t, mid, mid + 55, mid - 40, mid + 10));
    t += 3600;
  }
  // Last candles near top
  for (let i = 0; i < 10; i++) {
    premiumCandles.push(c(t, 190, 192, 188, 191));
    t += 3600;
  }
  const premium = analyzePdArray(premiumCandles, "4h");
  assert(premium.currentBias === "premium",
    `bias = premium (got: ${premium.currentBias})`);

  // ── 2. Discount bias when price is below equilibrium ─────────────────────
  console.log("\n2. Discount bias (price below equilibrium)");
  const discountCandles: Candle[] = [];
  t = 1700000000;
  for (let i = 0; i < 200; i++) {
    // Wide range bars (H=200, L=100) mixed with flat ones to push session eq up
    discountCandles.push(c(t, 150, 200, 100, 150));
    t += 3600;
  }
  // Price near the very bottom of the wide range → discount
  for (let i = 0; i < 60; i++) {
    discountCandles.push(c(t, 105, 110, 102, 104));
    t += 3600;
  }
  const discount = analyzePdArray(discountCandles, "4h");
  assert(discount.currentBias === "discount",
    `bias = discount (got: ${discount.currentBias})`);

  // ── 3. Equilibrium when price is near midpoint ────────────────────────────
  console.log("\n3. Equilibrium bias (price near midpoint)");
  const eqCandles: Candle[] = [];
  t = 1700000000;
  for (let i = 0; i < 50; i++) {
    eqCandles.push(c(t, 150, 200, 100, 150));
    t += 3600;
  }
  for (let i = 0; i < 10; i++) {
    eqCandles.push(c(t, 150, 152, 148, 150));
    t += 3600;
  }
  const eq = analyzePdArray(eqCandles, "4h");
  assert(eq.currentBias === "equilibrium",
    `bias = equilibrium (got: ${eq.currentBias})`);

  // ── 4. Zone count and labels ─────────────────────────────────────────────
  console.log("\n4. Zone count and labels");
  assert(premium.zones.length === 6, `6 zones total (got ${premium.zones.length})`);
  const labels = premium.zones.map(z => z.label);
  assert(labels.includes("Session Premium"), "has Session Premium");
  assert(labels.includes("Session Discount"), "has Session Discount");
  assert(labels.includes("Swing Premium"), "has Swing Premium");
  assert(labels.includes("Swing Discount"), "has Swing Discount");
  assert(labels.includes("Session Equilibrium"), "has Session Equilibrium");
  assert(labels.includes("Swing Equilibrium"), "has Swing Equilibrium");

  // ── 5. Zone geometry ─────────────────────────────────────────────────────
  console.log("\n5. Zone geometry");
  for (const z of premium.zones) {
    assert(z.top > z.bottom, `${z.label}: top (${z.top.toFixed(2)}) > bottom (${z.bottom.toFixed(2)})`);
    assert(["premium", "discount", "equilibrium"].includes(z.type),
      `${z.label}: valid type (${z.type})`);
    assert(z.timeframe.length > 0, "timeframe non-empty");
  }

  // ── 6. Dealing range properties ──────────────────────────────────────────
  console.log("\n6. Dealing range");
  assert(premium.dealingRange.high >= premium.dealingRange.low,
    "high >= low");
  assert(premium.dealingRange.high > 0, "high > 0");
  assert(premium.dealingRange.low > 0, "low > 0");
  assert(premium.dealingRange.timeframe.length > 0, "timeframe non-empty");

  // ── 7. Equilibrium calculation ────────────────────────────────────────────
  console.log("\n7. Equilibrium");
  const expectedEq = (premium.dealingRange.high + premium.dealingRange.low) / 2;
  assert(Math.abs(premium.equilibrium - expectedEq) < 0.01,
    `equilibrium ≈ (high+low)/2: ${premium.equilibrium.toFixed(2)} ≈ ${expectedEq.toFixed(2)}`);

  // ── 8. Short dataset ─────────────────────────────────────────────────────
  console.log("\n8. Short dataset");
  const shortCandles: Candle[] = [
    c(1700000000, 100, 102, 98, 101),
    c(1700003600, 101, 103, 99, 102),
  ];
  const short = analyzePdArray(shortCandles, "1h");
  assert(Array.isArray(short.zones), "zones is array");
  assert(short.zones.length > 0, "still produces zones");
  assert(short.dealingRange.high >= short.dealingRange.low, "range valid");

  // ── 9. Single candle — uses entire array as range ────────────────────────
  console.log("\n9. Single candle");
  const single = analyzePdArray([c(1700000000, 100, 105, 95, 102)], "1m");
  // Single candle with range: high=105, low=95, eq=100, close=102 > eq+buffer → premium
  assert(["premium", "discount", "equilibrium"].includes(single.currentBias),
    `valid bias: ${single.currentBias}`);
  assert(single.dealingRange.high >= single.dealingRange.low, "valid range");
  assert(single.zones.length > 0, "zones produced");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
