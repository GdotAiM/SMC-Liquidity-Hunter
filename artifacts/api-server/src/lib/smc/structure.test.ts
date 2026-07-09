/**
 * Unit tests for the ICT market structure analyzer.
 *
 * Run with:
 *   npx tsx artifacts/api-server/src/lib/smc/structure.test.ts
 */

import { analyzeStructure } from "./structure.js";
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
 * Build flat preamble to seed a reasonable ATR value.
 * Without this, the first spike sets its own ATR which creates a huge
 * noise threshold that swallows nearby bars.
 */
function preamble(base: number, count: number): Candle[] {
  const candles: Candle[] = [];
  let t = 1700000000;
  for (let i = 0; i < count; i++) {
    candles.push(c(t, base, base + 0.3, base - 0.3, base + 0.1));
    t += 3600;
  }
  return candles;
}

/**
 * Pure staircase uptrend. Each step produces one HH (spike) and one HL
 * (pullback). 12 bars per step keeps consecutive pullback lows 12 bars
 * apart — just beyond the lookback‑5 (±5 = 11‑bar) window so they never
 * interfere with each other.
 *
 * Spike candle low sits ABOVE the pullback zone so it doesn't pollute
 * pullback-low pivot detection.
 */
function buildUptrend(steps: number): Candle[] {
  const candles = preamble(100, 30);
  let t = candles[candles.length - 1].time + 3600;
  let level = 100;

  for (let s = 0; s < steps; s++) {
    // 2 flat bars at current level
    candles.push(c(t, level, level + 0.3, level - 0.3, level + 0.1)); t += 3600;
    candles.push(c(t, level + 0.1, level + 0.4, level - 0.2, level + 0.15)); t += 3600;

    // 1 displacement spike → HH pivot (low well above pullback zone)
    const spike = level + 12;
    candles.push(c(t, level + 0.15, spike, level + 4.0, spike - 0.3)); t += 3600;

    // 1 deep pullback → HL pivot (the clear minimum in its window)
    candles.push(c(t, spike - 0.3, spike - 6, level - 3.0, level + 1.5)); t += 3600;

    // 8 recovery / consolidation bars — lows stay well above the pivot low
    candles.push(c(t, level + 1.5, level + 3.0, level + 1.0, level + 2.2)); t += 3600;
    candles.push(c(t, level + 2.2, level + 3.2, level + 1.3, level + 2.5)); t += 3600;
    candles.push(c(t, level + 2.5, level + 3.5, level + 1.8, level + 3.0)); t += 3600;
    candles.push(c(t, level + 3.0, level + 3.8, level + 2.0, level + 3.3)); t += 3600;
    candles.push(c(t, level + 3.3, level + 4.0, level + 2.5, level + 3.5)); t += 3600;
    candles.push(c(t, level + 3.5, level + 4.0, level + 2.8, level + 3.7)); t += 3600;
    candles.push(c(t, level + 3.7, level + 4.0, level + 3.0, level + 3.8)); t += 3600;
    candles.push(c(t, level + 3.8, level + 4.2, level + 3.3, level + 4.0)); t += 3600;

    level += 3;
    t += 3600;
  }
  return candles;
}

function buildDowntrend(steps: number): Candle[] {
  const candles = preamble(200, 30);
  let t = candles[candles.length - 1].time + 3600;
  let level = 200;

  for (let s = 0; s < steps; s++) {
    // 2 flat bars
    candles.push(c(t, level, level + 0.3, level - 0.3, level - 0.1)); t += 3600;
    candles.push(c(t, level - 0.1, level + 0.2, level - 0.4, level - 0.15)); t += 3600;

    // 1 displacement spike → LL pivot (high stays well below pullback zone)
    const spike = level - 12;
    candles.push(c(t, level - 0.15, level - 4.0, spike, spike + 0.3)); t += 3600;

    // 1 pullback → LH pivot (clear maximum in its window)
    candles.push(c(t, spike + 0.3, level + 3.0, spike + 6, level - 1.5)); t += 3600;

    // 8 recovery bars — highs stay below the pivot high
    candles.push(c(t, level - 1.5, level - 1.0, level - 3.0, level - 2.2)); t += 3600;
    candles.push(c(t, level - 2.2, level - 1.3, level - 3.2, level - 2.5)); t += 3600;
    candles.push(c(t, level - 2.5, level - 1.8, level - 3.5, level - 3.0)); t += 3600;
    candles.push(c(t, level - 3.0, level - 2.0, level - 3.8, level - 3.3)); t += 3600;
    candles.push(c(t, level - 3.3, level - 2.5, level - 4.0, level - 3.5)); t += 3600;
    candles.push(c(t, level - 3.5, level - 2.8, level - 4.0, level - 3.7)); t += 3600;
    candles.push(c(t, level - 3.7, level - 3.0, level - 4.0, level - 3.8)); t += 3600;
    candles.push(c(t, level - 3.8, level - 3.3, level - 4.2, level - 4.0)); t += 3600;

    level -= 3;
    t += 3600;
  }
  return candles;
}

function buildRanging(count: number): Candle[] {
  const candles = preamble(150, 30);
  let t = candles[candles.length - 1].time + 3600;
  for (let i = 0; i < count; i++) {
    const mid = 150 + Math.sin(i * 0.15) * 2;
    const o = mid + (Math.random() - 0.5) * 0.4;
    const cl = mid + (Math.random() - 0.5) * 0.4;
    candles.push(c(t, o, Math.max(o, cl) + 0.3, Math.min(o, cl) - 0.3, cl));
    t += 3600;
  }
  return candles;
}

/**
 * Reversal pattern: uptrend → CHoCH → bearish BOS.
 *
 * Phase 1: 3-step uptrend (HH → HL sequence)
 * Phase 2: LH forms (failed HH) → CHoCH bearish
 * Phase 3: LL breaks below last HL → BOS bearish
 */
function buildReversal(): Candle[] {
  const candles = preamble(100, 30);
  let t = candles[candles.length - 1].time + 3600;

  // ── Phase 1: 3-step uptrend (12 bars each, same as buildUptrend) ──────────
  let level = 100;
  for (let s = 0; s < 3; s++) {
    candles.push(c(t, level, level + 0.3, level - 0.3, level + 0.1)); t += 3600;
    candles.push(c(t, level + 0.1, level + 0.4, level - 0.2, level + 0.15)); t += 3600;
    const spike = level + 12;
    candles.push(c(t, level + 0.15, spike, level + 4.0, spike - 0.3)); t += 3600;
    candles.push(c(t, spike - 0.3, spike - 6, level - 3.0, level + 1.5)); t += 3600;
    candles.push(c(t, level + 1.5, level + 3.0, level + 1.0, level + 2.2)); t += 3600;
    candles.push(c(t, level + 2.2, level + 3.2, level + 1.3, level + 2.5)); t += 3600;
    candles.push(c(t, level + 2.5, level + 3.5, level + 1.8, level + 3.0)); t += 3600;
    candles.push(c(t, level + 3.0, level + 3.8, level + 2.0, level + 3.3)); t += 3600;
    candles.push(c(t, level + 3.3, level + 4.0, level + 2.5, level + 3.5)); t += 3600;
    candles.push(c(t, level + 3.5, level + 4.0, level + 2.8, level + 3.7)); t += 3600;
    candles.push(c(t, level + 3.7, level + 4.0, level + 3.0, level + 3.8)); t += 3600;
    candles.push(c(t, level + 3.8, level + 4.2, level + 3.3, level + 4.0)); t += 3600;
    level += 3;
  }
  // After uptrend: lastHH ≈ 118, lastHL ≈ 106 (level≈112-3=109, HL low≈109-3=106)

  // ── Phase 2: LH spike — failed to make new high (CHoCH bearish) ──────────
  candles.push(c(t, level, level + 0.3, level - 0.3, level + 0.1)); t += 3600;
  candles.push(c(t, level + 0.1, level + 0.4, level - 0.2, level + 0.15)); t += 3600;
  // LH peak well below last HH (~118) — this is the CHoCH trigger
  const lhPeak = level + 5;
  candles.push(c(t, level + 0.15, lhPeak, level + 3.0, lhPeak - 0.3)); t += 3600;
  // Pullback + continuation
  candles.push(c(t, lhPeak - 0.3, lhPeak - 4, level - 3.0, level + 0.5)); t += 3600;

  // ── Phase 3: LL spike — break below last HL (~106) → BOS bearish ──────────
  candles.push(c(t, level + 0.5, level + 1.5, level - 4.0, level - 2.0)); t += 3600;
  candles.push(c(t, level - 2.0, level - 0.5, level - 6.0, level - 4.0)); t += 3600;
  candles.push(c(t, level - 4.0, level - 2.0, level - 8.0, level - 5.0)); t += 3600;
  // Major LL spike — breaks well below last HL
  candles.push(c(t, level - 5.0, level - 2.0, level - 13.0, level - 10.0)); t += 3600;
  // Recovery after LL
  candles.push(c(t, level - 10.0, level - 6.0, level - 10.5, level - 7.0)); t += 3600;
  candles.push(c(t, level - 7.0, level - 4.0, level - 7.5, level - 5.0)); t += 3600;
  candles.push(c(t, level - 5.0, level - 3.0, level - 5.5, level - 4.0)); t += 3600;

  return candles;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("Structure analyzer test\n");

  // ── 1. Clear uptrend → bullish bias ───────────────────────────────────────
  console.log("1. Uptrend (12 steps + 30 preamble = ~150 bars)");
  const bullCandles = buildUptrend(12);
  const bull = analyzeStructure(bullCandles, "4h");
  console.log(`    bias=${bull.bias} conf=${bull.confidence.toFixed(3)} pivots=${bull.pivots.length} breaks=${bull.breaks.length} phase=${bull.phase}`);
  assert(bull.bias === "bullish", `uptrend bias (got: ${bull.bias})`);
  assert(bull.pivots.length > 0, `pivots detected (${bull.pivots.length})`);

  // ── 2. Clear downtrend → bearish bias ─────────────────────────────────────
  console.log("\n2. Downtrend (12 steps + preamble)");
  const bearCandles = buildDowntrend(12);
  const bear = analyzeStructure(bearCandles, "4h");
  console.log(`    bias=${bear.bias} conf=${bear.confidence.toFixed(3)} pivots=${bear.pivots.length} breaks=${bear.breaks.length} phase=${bear.phase}`);
  assert(bear.bias === "bearish", `downtrend bias (got: ${bear.bias})`);

  // ── 3. Ranging → neutral ──────────────────────────────────────────────────
  console.log("\n3. Ranging market");
  const rangingResult = analyzeStructure(buildRanging(120), "4h");
  console.log(`    trend=${rangingResult.trend} bias=${rangingResult.bias} conf=${rangingResult.confidence.toFixed(3)}`);
  assert(rangingResult.trend === "ranging" || rangingResult.bias === "neutral", "ranging detected");

  // ── 4. Short dataset resilience ────────────────────────────────────────────
  console.log("\n4. Short dataset");
  const short = analyzeStructure(buildUptrend(1), "4h");
  assert(short !== null, "doesn't crash on short data");

  // ── 5. Narratives are non-empty ────────────────────────────────────────────
  console.log("\n5. Narratives");
  assert(bull.narrative.length > 0, `bull: "${bull.narrative.slice(0, 70)}..."`);
  assert(bear.narrative.length > 0, `bear: "${bear.narrative.slice(0, 70)}..."`);

  // ── 6. Phase values are valid ──────────────────────────────────────────────
  console.log("\n6. Phase detection");
  const valid = ["accumulation","manipulation","expansion","distribution","continuation","unknown"];
  assert(valid.includes(bull.phase), `bull: ${bull.phase}`);
  assert(valid.includes(bear.phase), `bear: ${bear.phase}`);

  // ── 7. Evidence bullets ────────────────────────────────────────────────────
  console.log("\n7. Evidence bullets");
  assert(bull.evidence.length > 0, `bull: [${bull.evidence.join(", ")}]`);
  assert(bear.evidence.length > 0, `bear: [${bear.evidence.join(", ")}]`);

  // ── 8. Confidence bounds [0,1] ─────────────────────────────────────────────
  console.log("\n8. Confidence ∈ [0,1]");
  for (const r of [bull, bear, rangingResult]) {
    assert(r.confidence >= 0 && r.confidence <= 1, `${r.bias}: ${r.confidence.toFixed(3)}`);
  }

  // ── 9. 1m vs 1w pivot density ─────────────────────────────────────────────
  console.log("\n9. Timeframe pivot density");
  const tf = buildUptrend(10);
  const m1 = analyzeStructure(tf, "1m");
  const w1 = analyzeStructure(tf, "1w");
  console.log(`    1m: ${m1.pivots.length} pivots, 1w: ${w1.pivots.length} pivots`);
  assert(m1.pivots.length >= w1.pivots.length, `1m (${m1.pivots.length}) >= 1w (${w1.pivots.length})`);

  // ── 10. Pivot type validity ────────────────────────────────────────────────
  console.log("\n10. Pivot type validity");
  for (const p of [...bull.pivots, ...bear.pivots]) {
    assert(["HH","HL","LH","LL"].includes(p.type), `${p.type} @ ${p.price.toFixed(1)}`);
  }

  // ── 11. Price direction matches trend ──────────────────────────────────────
  console.log("\n11. Price direction");
  assert(bullCandles[bullCandles.length-1].close > bullCandles[0].close, "uptrend prices rise");
  assert(bearCandles[bearCandles.length-1].close < bearCandles[0].close, "downtrend prices fall");

  // ── 12. CHoCH/BOS detection (reversal pattern) ─────────────────────────────
  console.log("\n12. Reversal pattern (CHoCH + BOS)");
  const reversal = analyzeStructure(buildReversal(), "4h");
  console.log(`    bias=${reversal.bias} pivots=${reversal.pivots.length} breaks=${reversal.breaks.length} phase=${reversal.phase}`);
  const breakList = reversal.breaks.map(b => `${b.type}_${b.direction}`);
  console.log(`    breaks: [${breakList.join(", ")}]`);
  assert(reversal.pivots.length > 0, "reversal pattern has pivots");
  // A reversal should produce some breaks (CHoCH and/or BOS)
  assert(reversal.breaks.length > 0, `reversal has breaks: ${breakList.join(", ")}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
