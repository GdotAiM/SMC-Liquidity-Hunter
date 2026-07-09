# Roadmap — Post-Hackathon Cost & Scale

> **Status context (July 2026):** Inference already runs self-hosted on the
> AMD MI300X via vLLM (`LLM_PROVIDER=amd`), so the external LLM bill is
> already **zero**. Response compression is shipped (gzip on all JSON
> endpoints, SSE excluded). This document covers the remaining levers,
> prioritized by ROI and effort. It is deliberately honest about what is
> measured vs. estimated, and explicit about what we are choosing *not* to do.

---

## Already shipped (baseline)

| Area | State | Where |
|------|-------|-------|
| LLM inference | Self-hosted vLLM on MI300X — no external API spend | `deploy/amd-developer-cloud/docker-compose.yml` (`vllm` service), `artifacts/api-server/src/lib/llm/provider.ts` |
| Model warm-start | Gemma 4 weights persisted across restarts via `vllm-cache` + `hf-cache` volumes | `docker-compose.yml` |
| Response compression | gzip on all JSON responses ≥1 KB; SSE filtered out to preserve token streaming | `artifacts/api-server/src/app.ts` |
| Healthchecks | All four containers (frontend, api, db, vllm) report healthy | `Dockerfile`, `docker-compose.yml` |

---

## Priority 1 — Analytics tier → DuckDB (read-heavy queries)

**Problem.** Every analytics query — win rate by symbol, the performance
matrix, setup ranking — hits PostgreSQL. These are read-heavy, idempotent,
and scan large slices of the `trades` table. Postgres is optimized for
row-at-a-time OLTP, not columnar scans.

**Proposal.** Hybrid storage:
- **PostgreSQL stays canonical** for live trading state: orders, positions,
  account, and the append-mostly `trades` ledger. Small table, ACID matters.
- **DuckDB holds the analytics mirror**: backtest result sets and the
  performance matrix, imported via Arrow. In-process, columnar, ~10× faster
  for "win rate by symbol × setup subtype" style aggregations.
- Access both through the existing Drizzle layer via an adapter pattern, so
  callers don't care which store backs a given query.

**Effort:** ~2–3 hours. Add a DuckDB driver alongside Postgres; one Arrow
import path for backtest results.

**Expected win:** Analytics queries stop contending with live-trade writes on
Postgres, and Postgres can run on a smaller instance class. Magnitude is
**estimated, not measured** — instrument before committing to an instance
downgrade.

**Non-goal:** Do not migrate the trade ledger itself to DuckDB. It is the
canonical state of record and needs ACID.

---

## Priority 2 — Async backtest queue

**Problem.** Backtests run synchronously inside the request handler today.
One user kicking off a multi-asset, multi-timeframe backtest blocks a server
thread and spikes compute; ten concurrent users spike it tenfold.

**Proposal.** Postgres-backed job queue (BullMQ) with a worker pool:
- Request enqueues a backtest job, returns a job id immediately.
- Workers run jobs, ideally batched off-peak, and cache results.
- UI shows a `queued → running → results ready` state.

**Effort:** ~4 hours (worker, queue schema, UI state, result caching).

**Trade-off:** 2–4 min latency for backtest results. Acceptable for analysis
workloads; would not be acceptable for live signal generation, which stays
synchronous.

**Expected win:** Flattens compute spikes — instead of N concurrent
backtests at peak, 1–2 draining async. This is the main multi-user scaling
lever.

---

## Priority 3 — Measure, then decide on instance sizing

**Problem.** Right now there are no concrete cost numbers — the project runs
on AMD Developer Cloud GPU credits with self-hosted Postgres in a container.
There is no AWS RDS `db.m5.large` to downgrade, and no Fireworks line item to
cut. Optimization targets should follow measurement, not precede it.

**Proposal.** Before any instance/right-sizing change:
1. Instrument actual egress volume per endpoint (the compression win's real
   value is knowable, not guessed).
2. Record peak concurrent backtest depth and queue wait.
3. Measure Postgres query latency split by OLTP vs. analytics path.

Only then evaluate whether Priority 1's DuckDB split justifies a smaller
Postgres instance. **Do not quote percentage savings until they are
measured against this deployment.**

---

## Explicitly deferred (and why)

| Idea | Verdict | Reason |
|------|---------|--------|
| **Bun runtime** | Defer | The API is a long-running Express server (`node --enable-source-maps ./dist/index.mjs`). Bun's startup advantage is irrelevant to a persistent server, so the claimed compute saving does not follow. Would re-test only if we move to per-request serverless invocation. |
| **Swap React/Vite for a lighter framework** | Defer | Vite's bundle is already lean; DOM churn from the dashboard is not a cost driver. Not worth the rewrite risk. |
| **Parquet on the wire for backtests** | Reject | No HTTP endpoint serves a large backtest payload today (`BacktestRunner` writes to the ledger, not to the client). Solves a problem that doesn't exist. Browser-side Parquet is also a poor fit — Apache Arrow JS would be the real tool, and the complexity isn't justified. Compression (shipped) already covers the wire-size win. |
| **Drop the MCP tool-calling layer** | Reject | The tool-calling architecture is clean and is what makes the multi-provider LLM strategy possible. Migrating away would break that. |
| **Over-quantize Gemma 4 (4-bit)** | Defer | 4-bit works but adds ~30% latency. 8-bit is the sweet spot if memory pressure forces a step down; no reason to take the latency hit while the MI300X has headroom. |

---

## Sequencing

1. **Measure** (Priority 3 instrumentation) — cheap, unblocks honest decisions.
2. **DuckDB analytics split** (Priority 1) — the highest-leverage architectural
   change, but validate with the measurements first.
3. **Async backtest queue** (Priority 2) — ship when multi-user load is real,
   not before; the added latency is only worth it under contention.

Everything above is post-hackathon. The hackathon submission already reflects
the two immediate wins that mattered: zero external LLM cost (self-hosted
vLLM) and compressed responses.
