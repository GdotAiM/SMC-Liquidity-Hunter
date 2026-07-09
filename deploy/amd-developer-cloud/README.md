# SMC Pulse Predict on AMD Developer Cloud (MI300X)

This directory contains everything needed to deploy the SMC Pulse Predict API
server **co-located with a self-hosted LLM** on an AMD MI300X GPU instance — no
external AI provider required. The stack runs vLLM (ROCm-accelerated) side by
side with the API server inside Docker, with all inference staying on your
hardware.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              AMD Developer Cloud VM (MI300X)                  │
│                                                              │
│  ┌──────────────────────┐      ┌────────────────────────────┐│
│  │  vLLM (ROCm)          │      │  SMC API Server            ││
│  │  port 8000            │◄────►│  port 3001 — REST + SSE    ││
│  │  Model: configurable  │      │  port 3002 — MCP           ││
│  │  via LLM_MODEL        │      │                            ││
│  │  GPU: MI300X          │      │  LLM_PROVIDER=amd          ││
│  │  /dev/kfd, /dev/dri   │      │  LLM_BASE_URL=vllm:8000/v1 ││
│  └──────────────────────┘      └─────────────┬──────────────┘│
│                                               │              │
│                          External AI agents connect via MCP   │
│                          (e.g. agentic trading layers)        │
│                          Traders via REST (:3001)             │
└──────────────────────────────────────────────────────────────┘
```

Both containers are defined in `docker-compose.yml` and run co-located on a
single AMD Developer Cloud VM. The API server talks to vLLM over the Docker
network — no traffic leaves the instance.

## How It Uses AMD Infrastructure

### 1. Self-hosted inference via vLLM on MI300X

The API server's LLM calls — the 4-agent SMC analysis pipeline and the MCP
tool-calling agent (`/api/agents/ask-mcp`) — are routed through a **provider
abstraction**, not hardcoded to any single vendor:

```ts
// artifacts/api-server/src/lib/llm/provider.ts
LLM_PROVIDER=amd               // switches base URL, skips API-key auth
LLM_BASE_URL=http://vllm:8000/v1
LLM_MODEL=google/gemma-4-26B-A4B-it   // default (see sizing table below)
```

When `LLM_PROVIDER=amd`, `resolveLlmConfig()` routes every chat completion —
streaming and non-streaming — to the local vLLM endpoint instead of Fireworks,
with no other code changes required. Fireworks remains the default; AMD is
opt-in. The same abstraction also supports OpenAI and arbitrary
OpenAI-compatible BYOK endpoints.

### 2. Why Gemma 4 26B A4B (MoE)

Google's Gemma 4 has day-one vLLM support and is explicitly optimized for AMD
ROCm. We chose the 26B A4B (Mixture-of-Experts) variant because:

- **Efficient inference**: only ~4B parameters activated per token, giving
  near-31B-dense reasoning quality at lower per-call latency — important
  because the MCP agent loop makes repeated tool-calling round trips, not one
  long generation.
- **Native function-calling**: lines up directly with the tool-registry
  pattern the MCP server already uses.
- **vLLM-native tool/ reasoning parsers**: the vLLM service is configured with
  `--tool-call-parser gemma4 --reasoning-parser gemma4 --enable-auto-tool-choice`.

Other Gemma 4 sizes (`gemma-4-12b-it`, `gemma-4-31b-it`) are drop-in swaps via
the `LLM_MODEL` variable.

### 3. ROCm device passthrough

`/dev/kfd` and `/dev/dri` are mapped into the vLLM container, giving it direct
access to the MI300X compute and render devices.
`HSA_OVERRIDE_GFX_VERSION=9.4.2` ensures PyTorch/ROCm targets the correct GPU
architecture (gfx942). The vLLM service also passes `--trust-remote-code` and
`--enforce-eager` for maximum compatibility on ROCm.

### 4. Multi-GPU ready

Set `VLLM_TP_SIZE` to the number of MI300X GPUs for tensor-parallel inference
across multiple devices. AMD Developer Cloud offers instances with up to
8× MI300X.

## Prerequisites

- **AMD Developer Cloud VM** with at least 1× MI300X (192 GB HBM3)
- **Ubuntu 22.04 LTS** (ROCm 6.x is assumed; 6.2+ recommended)
- **Docker** (installed by `setup.sh` if missing)

## Model Sizing

Gemma 4 variants on a single MI300X (FP16 weights only):

| Variant | Weights | Min GPU | Notes |
|---|---|---|---|
| Gemma 4 E2B | ~18 GB | 1× MI300X | Lightweight, fast |
| Gemma 4 12B | ~27 GB | 1× MI300X | Good balance |
| **Gemma 4 26B A4B** | **~58 GB** | **1× MI300X** | **Default — strong MoE** |
| Gemma 4 31B | ~70 GB | 1× MI300X | Largest single-GPU option |

Add ~20 GB overhead for KV cache + ROCm runtime. The 26B A4B MoE fits
comfortably on a single MI300X (192 GB HBM3). To switch models, change
`LLM_MODEL` in `.env` and restart.

> **⚠ Non-Gemma models**: if you switch to a non-Gemma model (Mistral, Llama,
> Qwen, etc.), you must also change `LLM_TOOL_PARSER` in `.env` to the
> appropriate parser or clear it.  See the [vLLM Flags](#vllm-flags-docker-composeyml)
> section for supported parser names.

## Quick Start

### 1. Provision an AMD Developer Cloud VM

Launch an Ubuntu 22.04 VM with MI300X GPU(s) via the
[AMD Developer Cloud portal](https://developer.amd.com/). SSH in as `ubuntu`.

### 2. Clone & setup

```bash
git clone <your-repo-url> smc-pulse-predict
cd smc-pulse-predict/deploy/amd-developer-cloud

# One-time: install Docker, verify ROCm, pull vLLM image
chmod +x setup.sh
./setup.sh
```

### 3. Configure

```bash
cp .env.amd .env
# Edit .env to change the model, set API keys for live market data, etc.
# The defaults work out of the box with an MI300X.
```

### 4. Launch

```bash
docker compose up -d
```

First launch downloads the model from HuggingFace (5–10 minutes; cached on
subsequent restarts). Watch progress:

```bash
docker compose logs -f vllm
# Wait for: "Uvicorn running on http://0.0.0.0:8000"
```

### 5. Verify

```bash
# vLLM is serving
curl http://localhost:8000/v1/models

# API server is up
curl http://localhost:3001/api/healthz

# MCP endpoint is accepting connections (external AI agents)
curl http://localhost:3002/mcp

# End-to-end: ask the AI a question (streams SSE)
curl -N http://localhost:3001/api/agents/ask-mcp \
  -H "Content-Type: application/json" \
  -d '{"question":"What is the current BTC structure on the 4h timeframe?"}'
```

## Environment Reference

| Variable | Default | Notes |
|---|---|---|
| `LLM_MODEL` | `google/gemma-4-26B-A4B-it` | Any HF model vLLM+ROCm can serve |
| `LLM_TOOL_PARSER` | `gemma4` | vLLM parser name for tool calling — see vLLM Flags section |
| `LLM_PROVIDER` | `amd` | Overridable via `.env` (fireworks / openai / custom) |
| `VLLM_PORT` | `8000` | vLLM API port (internal) |
| `VLLM_MAX_MODEL_LEN` | `8192` | Max context length |
| `VLLM_GPU_MEM_UTIL` | `0.92` | Fraction of GPU memory for vLLM |
| `VLLM_TP_SIZE` | `1` | Tensor-parallel size (set to GPU count) |
| `VLLM_DTYPE` | `auto` | Model dtype |
| `API_PORT` | `3001` | API server REST port |
| `MCP_PORT` | `3002` | MCP endpoint for external AI agents |
| `CORS_ORIGINS` | `*` | CORS allowed origins (`*` = any, or comma-separated list) |
| `HSA_OVERRIDE_GFX_VERSION` | `9.4.2` | ROCm target: MI300X = gfx942 |
| `BINANCE_API_KEY` | (optional) | Live crypto market data |
| `FINNHUB_API_KEY` | (optional) | Live forex market data |
| `DATABASE_URL` | (optional) | PostgreSQL for user state persistence |

## vLLM Flags (docker-compose.yml)

The vLLM service is launched with these flags. All flags are configurable via
environment variables — no flags are hardcoded:

| Flag | Value | Notes |
|---|---|---|
| `--model` | `$LLM_MODEL` | Defaults to `google/gemma-4-26B-A4B-it` |
| `--tool-call-parser` | `$LLM_TOOL_PARSER` | Defaults to `gemma4`.  Supported values: `gemma4`, `hermes`, `mistral`, `llama3_json`, `pythonic`, or empty (disabled). |
| `--reasoning-parser` | `$LLM_TOOL_PARSER` | Defaults to `gemma4`.  Same values as tool-call-parser. |
| `--enable-auto-tool-choice` | — | Let the model decide when to call tools |
| `--trust-remote-code` | — | See security note below |
| `--enforce-eager` | — | Avoids `hipErrorNoBinaryForGpu` on ROCm |
| `--max-model-len` | `$VLLM_MAX_MODEL_LEN` | Defaults to 8192 |
| `--gpu-memory-utilization` | `$VLLM_GPU_MEM_UTIL` | Defaults to 0.92 |
| `--tensor-parallel-size` | `$VLLM_TP_SIZE` | Defaults to 1 |
| `--dtype` | `$VLLM_DTYPE` | Defaults to auto |

### Security note: `--trust-remote-code`

This flag tells vLLM to execute arbitrary Python code from the HuggingFace
model repository at load time (e.g., custom `modeling_*.py`,
`configuration_*.py`). This is a **supply-chain risk** — a compromised or
malicious model repo can run code inside the container with GPU device access.

It is currently required for Gemma 4 models on ROCm because they ship custom
modeling code. If you switch to a model that does not bundle custom code
(e.g., many Llama and Mistral variants), remove this flag to eliminate the
risk. Always verify the provenance of any model you load with
`--trust-remote-code` enabled.

## Relevant Source Files

| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/llm/provider.ts` | Provider abstraction (Fireworks / AMD / OpenAI / custom) |
| `artifacts/api-server/src/routes/agents-mcp.ts` | MCP tool-calling agent, provider-agnostic |
| `deploy/amd-developer-cloud/docker-compose.yml` | Dual-service stack definition |
| `deploy/amd-developer-cloud/setup.sh` | One-time VM provisioning script |
| `deploy/amd-developer-cloud/.env.amd` | Default environment values |

## Troubleshooting

**vLLM fails with "hipErrorNoBinaryForGpu"**
→ `--enforce-eager` is already in docker-compose.yml. If it persists, try a
model known to work with vLLM+ROCm like `mistralai/Mistral-7B-Instruct-v0.3`.
**If you switch to a non-Gemma model, also clear `LLM_TOOL_PARSER` in `.env`** —
the Gemma 4 parser flags will break tool calling on other model families.

**"No GPU found" in vLLM logs**
→ Verify `/dev/kfd` and `/dev/dri` are mapped. Run `rocminfo` on the host. If
ROCm isn't installed, re-run `setup.sh`.

**API server can't reach vLLM**
→ Check `docker compose logs api`. If you see connection refused to
`http://vllm:8000`, vLLM may still be loading the model. Wait for
`Uvicorn running on http://0.0.0.0:8000` in the vLLM logs.

**Model download is slow**
→ The first launch pulls model weights from HuggingFace. This is cached in the
`hf-cache` Docker volume. Subsequent restarts are instant.

**Wrong model or healthcheck path?**
→ This README reflects the current defaults (Gemma 4 26B A4B, `/api/healthz`).
If you're coming from an older version of this repo, see
`docs/archive/README-amd-deploy-v1.md` for the previous Qwen2.5-based config.

## Stopping

```bash
docker compose down          # stop containers, keep volumes (model cache)
docker compose down -v       # stop and delete everything (re-download model)
```

## Verified Working

- **MCP server**: boots and correctly answers a real `initialize` JSON-RPC
  handshake, returning tool/resource/prompt capabilities.
- **Docker Compose config**: structurally sound (valid healthchecks, correct
  device mappings, correct env wiring to `provider.ts`).
- **API server image**: builds successfully from the repo root `Dockerfile`.
- **TypeScript**: compiles cleanly (`tsc --noEmit` passes with zero errors).
- **End-to-end on MI300X**: ✅ validated on live AMD Developer Cloud hardware — the full stack (vLLM + Gemma 4 26B + API server + frontend + DB) runs end-to-end on an MI300X GPU instance.
