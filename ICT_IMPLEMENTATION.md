# ICT/SMC Implementation — SMC Pulse Predict

This document explains every ICT (Inner Circle Trader) concept implemented in the codebase: the trading definition, the detection algorithm, implementation details, known strengths, and current limitations.

---

## 1. Market Structure — Pivots (HH / HL / LH / LL)

### ICT Definition
Market structure is the foundation of SMC analysis. Price makes a series of swings — Higher Highs (HH), Higher Lows (HL) in an uptrend, and Lower Highs (LH), Lower Lows (LL) in a downtrend. These pivots define who is in control of the market.

### Algorithm (`structure.ts → findPivots()`)
1. Compute ATR(N) for each candle using a per-timeframe period (6 bars for 1m, 14 bars for 4h+)
2. For each candle `i` with lookback window `L` (2 bars for 1m, 5 bars for 4h+):
   - A candle is a **swing high** if its `high` is greater than all surrounding `high` values within ±L bars, minus an ATR noise filter (`0.5 × ATR`)
   - A candle is a **swing low** if its `low` is less than all surrounding `low` values, plus the noise filter
3. Pivots are classified as HH/HL/LH/LL by comparing the current high/low to the previous confirmed pivot of the same type

### Critical Correctness Decision
**ICT pivots are independent of candle colour.** A swing high can be formed by a bearish candle — what matters is only its price relative to its neighbours. The previous implementation incorrectly filtered pivots by candle colour, which suppressed many valid pivots. This was fixed.

### Strengths
- ATR-normalised noise filter adapts to each timeframe's volatility
- Per-timeframe lookback ensures short TFs don't miss fast pivots

### Limitations
- Binary window lookback — does not implement ICT's concept of "confirmed" vs "unconfirmed" pivots with the same rigour
- Does not account for wicks vs bodies in pivot classification

---

## 2. Break of Structure (BOS)

### ICT Definition
A BOS occurs when price closes beyond a recent swing high (bullish BOS) or swing low (bearish BOS) **in the direction of the existing trend**. It confirms the trend is continuing.

### Algorithm (`structure.ts → analyzeStructure()`)
After pivot detection, the algorithm classifies pivots as BOS or CHoCH based on their relationship to prior pivots:

- **Bullish BOS**: A new HH pivot whose price breaks above the last known LH (if one exists) — confirms bullish continuation after a prior bearish signal
- **Bearish BOS**: A new LL pivot whose price breaks below the last known HL (if one exists) — confirms bearish continuation after a prior bullish signal

This is more ICT-accurate than requiring a prior BOS — the first HH after seeing a LH that breaks above it IS a BOS (break of the LH resistance). Similarly the first LL after seeing a HL that breaks below it IS a BOS.

### Strengths
- Produces a timestamped `StructureBreak` for every BOS, enabling chart overlay of exact break bars
- Used as input to phase detection
- Correctly fires BOS on the first reversal break, not just on consecutive breaks

### Limitations
- In a pure trend (no opposing pivots), no BOS is generated — BOS requires at least one counter-trend pivot to break past
- Does not distinguish between a BOS that sweeps liquidity first (manipulation) and a clean continuation BOS

---

## 3. Change of Character (CHoCH / MSS)

### ICT Definition
A CHoCH (Change of Character), also called MSS (Market Structure Shift), occurs when price breaks a swing point **against the existing trend direction**. It signals a potential reversal of the current narrative.

### Algorithm (`structure.ts → analyzeStructure()`)
CHoCH is detected from pivot classification, not a separate scan:

- **Bearish CHoCH**: A LH pivot is detected when a known HL existed from the prior uptrend — this signals potential trend reversal
- **Bullish CHoCH**: A HL pivot is detected when a known LH existed from the prior downtrend — this signals potential trend reversal

The algorithm enforces that CHoCH only fires when BOTH pivot types (trend + counter-trend) have been seen — a CHoCH is meaningless without the prior trend context.

### Strengths
- Precisely timestamps when the market character changed
- Used by `detectPhase()` to classify manipulation vs distribution
- Requires prior trend context (HL or LH must exist) before CHoCH can fire

### Limitations
- A single CHoCH without follow-through BOS is not confirmed continuation — the `detectPhase()` function accounts for this by distinguishing manipulation from continuation

---

## 4. Market Phase Detection

### ICT Definition
ICT describes a market cycle: Accumulation → Manipulation → Expansion → Distribution (then repeat). Identifying the phase tells the trader where in the cycle price is.

### Algorithm (`structure.ts → detectPhase()`)
Analyses the last 5 `StructureBreak` entries:
- **Expansion**: 2+ BOS in the direction of current bias (trend is running)
- **Continuation**: CHoCH immediately followed by BOS in bias direction (retraced, now resuming)
- **Manipulation**: Most recent break is a bullish CHoCH — price swept lows to wrong-foot bears before going up
- **Distribution**: Most recent break is a bearish CHoCH — smart money distributing, market about to drop
- **Accumulation**: No clear breaks or mixed — ranging, smart money building a position

### Output
`StructureResult.phase` — used in `deriveSessionState()`, `buildMarketNarrative()`, and displayed in the Intelligence Sheet.

---

## 5. Liquidity Pools — BSL / SSL / EQH / EQL

### ICT Definition
Liquidity pools are price levels where stop-loss orders cluster:
- **BSL (Buy-Side Liquidity)**: Above swing highs — short sellers have stops there
- **SSL (Sell-Side Liquidity)**: Below swing lows — long sellers have stops there
- **EQH (Equal Highs)**: Two or more swing highs at the same price — very dense BSL
- **EQL (Equal Lows)**: Two or more swing lows at the same price — very dense SSL

Institutions need to fill large orders. They drive price into these clusters to create the volume they need, then reverse.

### Algorithm (`liquidity.ts → analyzeLiquidity()`)

**Pool identification**:
1. Identify all swing highs from pivot detection → candidate BSL levels
2. Identify all swing lows → candidate SSL levels
3. Group levels within `equalLevelThreshold` (0.1% of price) → classify as EQH/EQL if multiple pivots cluster

**Scoring**: Each pool receives a score from:
- `touches`: Number of times price tested the level (more touches = higher score)
- `session`: Pools formed during London or NY overlap get a multiplier (1.5×)
- `recency`: Pools formed more recently get a decay bonus
- `wasSwept`: Swept pools are excluded from active set

**Probability of Sweep**: Each unswept pool gets a `probabilityOfSweep` value (0–1):
- Base: exponential decay by distance from current price
- Boosts: session weight (London/NY = +0.2), bias alignment (+0.15), recency (+0.1), touches (+0.05/touch)
- HTF bias alignment: if pool type matches HTF bias direction, +0.15

### Output
`LiquidityResult`:
- `pools[]` — all detected pools with full scoring
- `nearestBSL` — closest unswept BSL above current price
- `nearestSSL` — closest unswept SSL below current price

### Strengths
- Session-weighted scoring means NY session pools get higher priority (matching ICT's session-based approach)
- `probabilityOfSweep` gives a quantitative edge for comparing targets

### Limitations
- Cannot distinguish between "old" equal highs formed months ago vs recent — distance decay partially compensates but doesn't fully solve this
- Does not yet account for the "liquidity void" (gap of unfilled orders) between pools

---

## 6. Order Blocks (OB)

### ICT Definition
An Order Block is the last bearish candle before a significant bullish move (bullish OB), or the last bullish candle before a significant bearish move (bearish OB). It represents the candle where institutional buy/sell orders were placed. Price often returns to these zones for entry.

### Algorithm (`order-blocks.ts → analyzeOrderBlocks()`)

**Detection**:
1. Identify "displacement" moves — candles with above-average body size and volume spike (configurable)
2. Look backward `obLookForward` bars from the displacement candle
3. The last **bearish** candle before a bullish displacement = **Bullish OB**
4. The last **bullish** candle before a bearish displacement = **Bearish OB**

**OB Boundaries**:
- Bullish OB: `proximal = candle.open` (top of bearish body), `distal = candle.low`
- Bearish OB: `proximal = candle.open` (bottom of bullish body), `distal = candle.high`

> **Critical fix**: Bullish OB proximal was previously incorrectly set to `candle.close`. For a bearish candle (close < open), the upper boundary of the body is `open`. This is now correct.

**Mitigation**: An OB is mitigated (neutralised) when price closes beyond its distal level.

**Breaker Block**: A mitigated OB that price has since broken beyond — it flips polarity and acts as the opposite type.

**FVG Confluence**: If a FVG exists within 0.5% of the OB zone, `hasFvg = true` (institutional grade confluence).

**Confidence Scoring**:
| Factor | Effect |
|---|---|
| Displacement magnitude > 2× ATR | +0.20 |
| FVG confluence | +0.15 |
| Volume spike (crypto only) | +0.10 |
| Breaker block polarity | -0.10 |
| HTF bias alignment (applied in report.ts) | +0.12 |
| Counter-trend OB | -0.15 |

### Strengths
- Proximal/distal boundaries provide precise KZO (Key Zone) levels for chart overlay
- Confidence scoring separates high-probability OBs from weak ones

### Limitations
- Single-candle OBs only — ICT sometimes uses multi-candle OB zones (the "order block body")
- Volume spike requirement may suppress valid OBs in low-volume forex data

---

## 7. Fair Value Gaps (FVG)

### ICT Definition
A Fair Value Gap is a 3-candle pattern where there is a gap (imbalance) between candle 1's wick and candle 3's wick that candle 2's wick does not fill. It represents an area where price moved too fast for orders to be filled. Price often returns to "rebalance" the gap.

### Algorithm (`fvg.ts → analyzeFVG()`)

**Bullish FVG**: `candle[i-1].high < candle[i+1].low`
- `top = candle[i+1].low`
- `bottom = candle[i-1].high`

**Bearish FVG**: `candle[i-1].low > candle[i+1].high`
- `top = candle[i-1].low`
- `bottom = candle[i+1].high`

**Fill tracking**: `fillFraction` is updated by checking how much of the gap subsequent candles have entered. A gap is considered "filled" at `fillFraction ≥ 0.5` and removed from the active set.

**Inversion FVG**: When price completely fills an FVG and closes beyond it, the gap inverts polarity. A bullish FVG becomes a bearish level and vice versa. `isInversion = true`.

**Minimum size filter**: Gaps smaller than `fvgMinBodyRatio × ATR` are discarded as noise.

### Strengths
- Fill fraction tracking shows partial fills — a 30%-filled FVG is still a valid target
- Inversion detection identifies gap-to-resistance and gap-to-support flips

### Limitations
- Does not distinguish between "classic" FVG and "ICT macros" FVG at specific UTC times
- No volume-weighting to identify which gaps are more likely to be filled

---

## 8. Inversion FVG

### ICT Definition
When price completely fills a FVG and closes through the far side, the gap inverts. A bullish FVG that is fully filled and closes below its bottom becomes a bearish resistance level. This is called an Inversion FVG.

### Implementation
Detected within `analyzeFVG()` — when `fillFraction` reaches 1.0, the FVG is marked `isInversion = true` and retained in the dataset for overlay purposes.

---

## 9. Premium / Discount / Equilibrium (PD Array)

### ICT Definition
- **Premium**: Price is above the 50% (equilibrium) of the current dealing range — expensive; look to sell
- **Discount**: Price is below equilibrium — cheap; look to buy
- **Equilibrium**: Price is at the 50% level — neutral; avoid entries

ICT teaches to buy in discount and sell in premium, aligning with the macro bias.

### Algorithm (`pd-array.ts → analyzePdArray()`)

1. **Dealing Range**: The high and low of the last N significant candles (using the same pivot high/low detection)
2. **Equilibrium**: `(dealingRange.high + dealingRange.low) / 2`
3. **Current Bias**: 
   - `currentPrice > equilibrium + 1%` → premium
   - `currentPrice < equilibrium - 1%` → discount
   - Otherwise → equilibrium

### Output
`PdArrayResult` containing zones, equilibrium price, dealing range boundaries, and `currentBias`.

### Usage in System
- Injected into the system prompt for AI analysis
- Boosts OB/FVG confidence when price is in a zone aligned with the bias
- Shown in the footer bar and Intelligence Sheet

---

## 10. Daily Bias

### ICT Definition
The Daily Bias is the higher-timeframe direction set by the daily chart's structure. ICT teaches to only take trades in the direction of the daily bias — it acts as the HTF filter.

### Algorithm (`daily-bias.ts → analyzeDailyBias()`)

**Primary approach — Structure-based (0.55–0.88 strength)**:
1. Run the same pivot detection on 1D candles
2. If the last 3+ pivots form an HH/HL sequence → bullish bias (strength 0.55–0.75)
3. If the last 3+ pivots form an LH/LL sequence → bearish bias (strength 0.55–0.75)
4. Recent BOS confirmation boosts strength to 0.88

**Fallback — SMA-based (capped at 0.20 strength)**:
- If fewer than 6 daily candles or no clear pivot structure, use SMA(20) position as weak bias signal
- Strength capped at 0.20 to prevent a shallow MA signal from dominating

**Evidence**: The `evidence[]` array is populated with human-readable bullets:
- "3 consecutive bullish daily pivots"
- "BOS bullish on daily: confirms direction"

### Usage in System
- Feeds into `buildReport()` → applied to OB confidence scores (+0.12 aligned, -0.15 counter-trend)
- Injected into system prompt for AI
- Shown in footer and Intelligence Sheet

---

## 11. SMT Divergence

### ICT Definition
SMT (Smart Money Tool) Divergence occurs when two correlated instruments (e.g., BTC and ETH, EUR/USD and GBP/USD) make divergent swing highs or lows. While one makes a new high, the correlated instrument fails to confirm. Institutions use one instrument to run the stops of the other.

### Algorithm (`smt.ts → analyzeSMT()`)

1. Align the two candle arrays by timestamp (handles different bar counts)
2. Find recent swing highs and lows in both the primary and correlated series using ATR-based pivot detection
3. Identify divergence patterns:
   - **Bearish SMT**: Primary makes HH, correlated makes LH at approximately the same time window
   - **Bullish SMT**: Primary makes LL, correlated makes HL at the same time window
4. Compute confidence from:
   - **Magnitude**: Log-scale price divergence between the two highs/lows (larger = more significant)
   - **Timing score**: How close in bar-time the two diverging pivots occurred (closer = higher confidence)
   - **Minimum threshold**: Divergences < 0.1% magnitude are rejected as noise

### Output
`SmtDivergence`:
- `detected: boolean`
- `type: "bearish_smt" | "bullish_smt"`
- `confidence: number` (0–1)
- `time: number` — Unix timestamp of the divergence

### Strengths
- Magnitude and timing scoring filters out spurious correlations
- Injected into both the system prompt and the confluence scoring engine
- Correctly uses per-extreme prior comparison (`indexOf(ch/cl)`) — previously used `slice(0, -1)` which always fetched the second-to-last element, causing false SMT signals when both instruments moved in sync

### Limitations
- Only detects one divergence type at a time (most recent wins)
- Requires exactly two aligned instruments — does not handle basket divergence (EUR vs USD Index)

---

## 12. Draw on Liquidity (DOL)

### ICT Definition
The Draw on Liquidity is the next price objective that smart money is targeting. ICT teaches that price is always moving from one liquidity pool to the next. Identifying the correct DOL is the primary skill of the SMC trader.

### Algorithm (`report.ts → confluenceBoost() + draw target scoring`)

All potential targets are scored and ranked:

**Candidate targets**:
1. `nearestBSL` — closest unswept buy-side pool above price
2. `nearestSSL` — closest unswept sell-side pool below price
3. Each valid, unmitigated OB (up to 3)
4. Each unfilled FVG (fill < 50%, up to 3)

**Scoring formula** for each target:
```
baseScore = pool.score × proximity × biasScore
finalScore = baseScore × confluenceMultiplier
```

Where:
- `proximity = 1 / (1 + |target - currentPrice| / currentPrice × 100)` — inverse distance
- `biasScore = 1.5` if target direction matches bias, `0.8` otherwise
- `confluenceMultiplier` additions:
  - Nearby unmitigated OB within 0.5% → `+0.35 × ob.confidence`
  - FVG confluence → `+0.20`
  - Price in discount (bullish bias) or premium (bearish bias) → `+0.10`
  - SMT detected → `+0.08`

Targets are sorted descending by `finalScore`. The top 5 are returned as `draw[]`.

### Evidence
Each `DrawTarget` carries an `evidence[]` array listing which confluence factors contributed to its score, shown in the Intelligence Sheet.

---

## 13. Session Analysis

### ICT Definition
ICT divides the trading day into sessions with distinct institutional behaviour:
- **Asian Session (00:00–06:00 UTC)**: Range formation — institutions set the range for London to hunt
- **London Open (06:00–08:00 UTC)**: Liquidity sweep — London often sweeps the Asian range first
- **London Session (08:00–12:00 UTC)**: Primary expansion — the strongest directional move of the day
- **NY Open (12:00–14:00 UTC)**: London close + NY continuation or reversal
- **NY Session (14:00–17:00 UTC)**: Secondary expansion or retracement
- **PM Session (17:00–20:00 UTC)**: Distribution — smart money unwinding

### Implementation (`report.ts → deriveSessionState()`)

Combines current UTC hour with structure context:
- Hour 0–6 → "Asian Range Formation"
- Hour 6–8 + bullish bias + discount → "London Liquidity Sweep (Bullish Setup)"
- Hour 8–12 + expansion phase → "London Expansion — Bullish/Bearish"
- Hour 12–14 → "NY Open / London Close"
- Hour 14–17 + continuation phase → "NY Continuation — Bullish/Bearish"
- Hour 17–20 → "PM Distribution"

The session state is displayed as a badge in the dashboard header and Intelligence Sheet.

---

## Configuration Reference (`config.ts`)

| Parameter | Value | Purpose |
|---|---|---|
| `pivotLookback` | 5 (default), 2–5 per TF | Bars each side required to confirm a pivot |
| `atrPeriod` | 14 (default), 6–14 per TF | ATR smoothing period for noise filter |
| `equalLevelThreshold` | 0.001 (0.1%) | Price proximity to classify as equal highs/lows |
| `obRequireFvg` | true | Order blocks need an associated FVG to qualify |
| `fvgMinBodyRatio` | 0.5 | FVG must be at least 0.5× ATR in size |
| `volumeSpikeMin.crypto` | 1.5× | Volume spike multiplier required for OB displacement |
| `minTouches` | 2 (H1+), 1 (M15-) | Minimum pool touches to be counted |
| `sessionWeights.overlap` | 1.5× | London/NY overlap pools get highest weighting |
| `maxCandles` | 300 | Maximum OHLCV bars fetched per request |
| `maxDailyCandles` | 60 | Daily bars fetched for HTF bias |
