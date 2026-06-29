---
name: ICT engine architecture
description: SMC engine modules, critical correctness fixes, new fields added per module, and important design decisions.
---

## Module map

`artifacts/api-server/src/lib/smc/`

| File | Role | Key decisions |
|------|------|---------------|
| `types.ts` | All shared types | Source of truth; api-client-react schemas must be kept in sync manually (not codegen-triggered) |
| `structure.ts` | Pivots + BOS/CHoCH | **Critical fix**: pivot detection must NOT filter by candle colour — only use price position vs neighbours |
| `order-blocks.ts` | OB detection | **Critical fix**: bullish OB proximal = `candle.open` (NOT `candle.close`) |
| `liquidity.ts` | Liquidity pools | `probabilityOfSweep` is computed per-pool at scan time; HTF bias boost applied in report.ts |
| `smt.ts` | SMT divergence | Rejects divergences < 0.1% magnitude; uses log-scale magnitude + timing score |
| `daily-bias.ts` | HTF bias | Structure-primary (0.55–0.88 strength); SMA-only fallback capped at 0.20 |
| `fvg.ts` | FVG detection | Unchanged in this upgrade |
| `pd-array.ts` | Premium/Discount | Unchanged in this upgrade |
| `report.ts` | Assembles all modules | HTF bias applied to OB confidence here (where bias is known); narrative + sessionState built here |

## New fields added (ICT engine upgrade)

**StructureResult**: `phase`, `narrative`, `evidence[]`
**LiquidityPool**: `probabilityOfSweep`
**OrderBlock**: `confidence`, `confidenceFactors[]`
**DailyBiasResult**: `evidence[]`
**DrawTarget**: `evidence[]`
**SmcReport**: `narrative`, `sessionState`

## Critical correctness fixes

1. **Pivot colour filter bug** (structure.ts): Was `if (isHigh && c.close > c.open)` — this incorrectly rejects valid pivots. ICT pivots depend only on price structure, not candle colour. Fixed to `if (isHigh)`.

2. **Bullish OB proximal** (order-blocks.ts): Was `proximal = ob.close`. For a bearish candle (which is the last candle before a bullish impulse), the body's upper bound is `open`, not `close`. Fixed to `proximal = ob.open`.

## Phase detection logic
- Expansion: 2+ BOS same direction as bias
- Continuation: CHoCH → BOS in bias direction
- Manipulation: bullish CHoCH (sweep of lows)
- Distribution: bearish CHoCH (sweep of highs)
- Accumulation: mixed or no breaks

## Cache
`artifacts/api-server/src/routes/analysis.ts` has a 60s in-memory Map cache keyed by `market|symbol|tf|corrSym`. Auto-evicts at 500 entries.

## API client types
`lib/api-client-react/src/generated/api.schemas.ts` is manually maintained (not auto-generated). New fields added as optional to all affected interfaces. Dist files are built separately if needed.

**Why**: The generated types are loosely typed (string instead of enums), so manually extending them is safe and avoids regeneration overhead.
