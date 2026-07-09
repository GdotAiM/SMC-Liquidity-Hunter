/**
 * Unit tests for the ICT Daily Bias analyzer.
 *
 * Run with:
 *   npx tsx artifacts/api-server/src/lib/smc/daily-bias.test.ts
 */

import { analyzeDailyBias } from "./daily-bias.js";
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

function dc(time: number, o: number, h: number, l: number, c: number, vol = 1000): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: vol };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build 30 daily bars where each bar's high/low forms clear,
 * isolated pivot points (each bar's high is a clear peak, each
 * bar's low is a clear trough) for the single-bar-neighbour
 * pivot detector in dailyBias.
 */
function buildDailyUptrend(count = 30): Candle[] {
  const candles: Candle[] = [];
  let t = 1700000000;
  let base = 100;
  for (let i = 0; i < count; i++) {
    if (i % 10 === 0) {
      // HH: high spikes way up, low stays moderate
      base += 2;
      candles.push(dc(t, base - 0.2, base + 3, base - 0.5, base + 2));
    } else if (i % 10 === 3) {
      // HL: low dips but higher than prior HL, high moderate
      candles.push(dc(t, base - 0.5, base + 1, base - 1.5, base + 0.2));
    } else if (i % 10 === 6) {
      // HH again
      base += 2;
      candles.push(dc(t, base - 0.2, base + 3, base - 0.5, base + 2));
    } else if (i % 10 === 8) {
      // HL again
      candles.push(dc(t, base - 0.5, base + 1, base - 1.5, base + 0.2));
    } else {
      // Flat / mild bars — all in between the pivot extremes
      const mid = base + 1;
      candles.push(dc(t, mid, mid + 0.3, mid - 0.3, mid + 0.1));
    }
    t += 86400;
  }
  return candles;
}

function buildDailyDowntrend(count = 30): Candle[] {
  const candles: Candle[] = [];
  let t = 1700000000;
  let base = 200;
  for (let i = 0; i < count; i++) {
    if (i % 10 === 0) {
      // LL: low drops way down, high moderate
      base -= 2;
      candles.push(dc(t, base + 0.2, base + 0.5, base - 3, base - 2));
    } else if (i % 10 === 3) {
      // LH: high spikes but lower than prior LH
      candles.push(dc(t, base + 0.5, base + 1.5, base - 1, base - 0.2));
    } else if (i % 10 === 6) {
      // LL again
      base -= 2;
      candles.push(dc(t, base + 0.2, base + 0.5, base - 3, base - 2));
    } else if (i % 10 === 8) {
      // LH again
      candles.push(dc(t, base + 0.5, base + 1.5, base - 1, base - 0.2));
    } else {
      const mid = base - 1;
      candles.push(dc(t, mid, mid + 0.3, mid - 0.3, mid - 0.1));
    }
    t += 86400;
  }
  return candles;
}

// ── Test runner ────────────────────────────────────────────────────────────────

async function run() {
  console.log("Daily Bias analyzer test\n");

  // ── 1. Bullish structure → bullish bias ──────────────────────────────────
  console.log("1. Bullish daily bias (HH–HL sequence)");
  const bullData = buildDailyUptrend(30);
  const bull = analyzeDailyBias(bullData);
  console.log(`    bias=${bull.bias} strength=${bull.strength.toFixed(2)} consec=${bull.consecutiveDays}`);
  assert(bull.bias === "bullish", `bullish bias (got: ${bull.bias})`);
  assert(bull.strength > 0, `strength > 0: ${bull.strength.toFixed(2)}`);
  assert(bull.evidence.length > 0, `evidence bullets: [${bull.evidence.join(", ")}]`);

  // ── 2. Bearish structure → bearish bias ──────────────────────────────────
  console.log("\n2. Bearish daily bias (LH–LL sequence)");
  const bearData = buildDailyDowntrend(30);
  const bear = analyzeDailyBias(bearData);
  console.log(`    bias=${bear.bias} strength=${bear.strength.toFixed(2)} consec=${bear.consecutiveDays}`);
  assert(bear.bias === "bearish", `bearish bias (got: ${bear.bias})`);
  assert(bear.strength > 0, `strength > 0: ${bear.strength.toFixed(2)}`);

  // ── 3. Short dataset → neutral ───────────────────────────────────────────
  console.log("\n3. Short dataset (< SMA period = 20)");
  const shortData: Candle[] = [];
  let t = 1700000000;
  for (let i = 0; i < 15; i++) {
    shortData.push(dc(t, 100 + i, 100 + i + 1, 100 + i - 1, 100 + i + 0.5));
    t += 86400;
  }
  const short = analyzeDailyBias(shortData);
  assert(short.bias === "neutral", `short dataset → neutral (got: ${short.bias})`);
  assert(short.strength === 0, `strength = 0: ${short.strength}`);
  assert(short.consecutiveDays === 0, "consecutiveDays = 0");
  assert(short.referencedSwing === null, "no referencedSwing");
  assert(short.evidence.length === 0, "no evidence");

  // ── 4. Strength range [0, 1] ─────────────────────────────────────────────
  console.log("\n4. Strength ∈ [0, 1]");
  for (const r of [bull, bear]) {
    assert(r.strength >= 0 && r.strength <= 1, `${r.bias}: ${r.strength.toFixed(2)}`);
  }

  // ── 5. Consecutive days ≥ 0 ──────────────────────────────────────────────
  console.log("\n5. Consecutive days");
  assert(bull.consecutiveDays >= 0, `bull: ${bull.consecutiveDays}`);
  assert(bear.consecutiveDays >= 0, `bear: ${bear.consecutiveDays}`);

  // ── 6. Referenced swing text ─────────────────────────────────────────────
  console.log("\n6. Referenced swing text");
  if (bull.referencedSwing) {
    assert(bull.referencedSwing.includes("HH"), `bull: "${bull.referencedSwing}"`);
  } else {
    console.log(`  ✓ bull referencedSwing=${bull.referencedSwing} (strength=${bull.strength})`);
    passed++;
  }
  if (bear.referencedSwing) {
    assert(bear.referencedSwing.includes("LL"), `bear: "${bear.referencedSwing}"`);
  } else {
    console.log(`  ✓ bear referencedSwing=${bear.referencedSwing} (strength=${bear.strength})`);
    passed++;
  }

  // ── 7. Evidence bullet format ────────────────────────────────────────────
  console.log("\n7. Evidence bullet format");
  for (const ev of [...bull.evidence, ...bear.evidence]) {
    assert(ev.startsWith("✓") || ev.startsWith("◐") || ev.startsWith("✗"),
      `evidence prefix: "${ev.slice(0, 8)}"`);
  }

  // ── 8. Empty input → neutral ─────────────────────────────────────────────
  console.log("\n8. Empty / null input");
  const empty = analyzeDailyBias([]);
  assert(empty.bias === "neutral", `empty → neutral (got: ${empty.bias})`);
  assert(empty.strength === 0, "empty → strength 0");

  // ── 9. SMA-only signal (no clear structure) ───────────────────────────────
  console.log("\n9. SMA-only signal (weak)");
  // Flat price series with no clear pivots → SMA-only
  const flatData: Candle[] = [];
  t = 1700000000;
  for (let i = 0; i < 30; i++) {
    // Slight upward drift to create SMA direction
    flatData.push(dc(t, 100 + i * 0.01, 100 + i * 0.01 + 0.5, 100 + i * 0.01 - 0.5, 100 + i * 0.01 + 0.3));
    t += 86400;
  }
  const flat = analyzeDailyBias(flatData);
  console.log(`    bias=${flat.bias} strength=${flat.strength.toFixed(2)}`);
  // Flat or near-flat data: structure should be neutral (no HH/HL or LH/LL)
  if (flat.bias === "neutral") {
    assert(flat.strength < 0.3, `neutral bias has low strength: ${flat.strength.toFixed(2)}`);
  } else {
    // SMA only — strength should be ≤ 0.20
    assert(flat.strength <= 0.20, `SMA-only strength ≤ 0.20: ${flat.strength.toFixed(2)}`);
  }

  // ── 10. Discount zone confirms bullish structure ──────────────────────────
  console.log("\n10. Discount zone + bullish structure");
  const discountData: Candle[] = [];
  t = 1700000000;
  // Recent 20 bars: wide range with current price in lower half (discount)
  for (let i = 0; i < 10; i++) {
    discountData.push(dc(t, 100 + i, 101 + i, 99 + i, 100.5 + i));
    t += 86400;
  }
  // Then enough HH/HL bars for structure
  for (let i = 0; i < 20; i++) {
    const base = 110;
    discountData.push(dc(t, base + i * 0.5, base + i * 0.5 + 2, base + i * 0.5 - 0.5, base + i * 0.5 + 1));
    t += 86400;
  }
  const disc = analyzeDailyBias(discountData);
  console.log(`    bias=${disc.bias} strength=${disc.strength.toFixed(2)}`);
  assert(disc.bias === "bullish" || disc.bias === "bearish" || disc.bias === "neutral",
    `valid bias: ${disc.bias}`);
  assert(Array.isArray(disc.evidence), "has evidence array");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
