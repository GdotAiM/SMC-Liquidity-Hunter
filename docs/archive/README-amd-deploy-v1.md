# SMC Pulse Predict on AMD Developer Cloud (MI300X)

This directory contains everything needed to deploy the SMC Pulse Predict API
server **co-located with a local LLM** on an AMD MI300X GPU instance — no
external AI provider required. The stack runs vLLM (ROCm-accelerated) side by
side with the API server, with all inference staying on your hardware.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ AMD Developer Cloud VM (Ubuntu 22.04 + MI300X)               │
│                                                              │
│  ┌──────────────────┐     ┌──────────────────────────────┐   │
│  │ vLLM (ROCm)      │     │ SMC API Server               │   │
│  │ port 8000        │◄───►│ ports 3001 (REST),           │   │
│  │                  │     │        3002 (MCP)             │   │
│  │ GPU: MI300X      │     │                              │   │
│  │ Model: Gemma 4    │     │ LLM_PROVIDER=amd             │   │
│  │                  │     │ LLM_BASE_URL=vllm:8000/v1    │   │
│  └──────────────────┘     └──────────┬───────────────────┘   │
│                                      │                       │
│                         External AI agents                   │
│                         connect via MCP (:3002)              │
│                         Traders via REST (:3001)             │
└──────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **AMD Developer Cloud VM** with at least 1× MI300X (192 GB HBM3)
- **Ubuntu 22.04 LTS** (ROCm 6.x is assumed; 6.2+ recommended)
- **Docker** (will be installed by `setup.sh` if missing)

Gemma 4 model sizing (single MI300X, FP16 weights only):
| Variant | Weights | Min GPU | Notes |
|---|---|---|---|
| Gemma 4 E2B | ~18 GB | 1× MI300X | Lightweight, fast |
| Gemma 4 12B | ~27 GB | 1× MI300X | Good balance |
| **Gemma 4 26B A4B** | **~58 GB** | **1× MI300X** | **Default — strong MoE** |
| Gemma 4 31B | ~70 GB | 1× MI300X | Largest single-GPU option |

Add ~20 GB overhead for KV cache + ROCm runtime.  The 26B A4B MoE fits
comfortably on a single MI300X (192 GB HBM3).  Set `VLLM_TP_SIZE` to the GPU
count for multi-GPU tensor parallelism.

## Quick Start

### 1. Provision an AMD Developer Cloud VM

Launch an Ubuntu 22.04 VM with MI300X GPU(s) via the
[AMD Developer Cloud portal](https://developer.amd.com/).  SSH in as `ubuntu`.

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
# Edit .env if you want a different model, set API keys for live data, etc.
# The defaults work out of the box with an MI300X.
```

### 4. Launch

```bash
docker compose up -d
```

First launch downloads the model from HuggingFace (5-10 minutes, cached on
subsequent restarts).  Watch progress:

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
| `VLLM_PORT` | `8000` | vLLM API port (internal) |
| `VLLM_MAX_MODEL_LEN` | `8192` | Max context length |
| `VLLM_GPU_MEM_UTIL` | `0.92` | Fraction of GPU memory for vLLM |
| `VLLM_TP_SIZE` | `1` | Tensor-parallel size (set to GPU count) |
| `API_PORT` | `3001` | API server REST port |
| `MCP_PORT` | `3002` | MCP endpoint for external AI agents |
| `HSA_OVERRIDE_GFX_VERSION` | `9.4.2` | ROCm target: MI300X = gfx942 |
| `BINANCE_API_KEY` | (optional) | Live crypto market data |
| `FINNHUB_API_KEY` | (optional) | Live forex market data |
| `DATABASE_URL` | (optional) | PostgreSQL for user state persistence |

## How It Uses AMD Infrastructure

1. **Inference on MI300X GPU** — vLLM runs with ROCm acceleration, served via
   the standard OpenAI-compatible `/v1` endpoint.  `LLM_PROVIDER=amd` tells the
   API server to skip API-key auth (vLLM is auth-free on private infra) and
   point at `http://vllm:8000/v1`.

2. **Co-located on a single VM** — No data leaves the instance.  The API server
   talks to vLLM over the Docker network.  Inference latency is sub-10ms for
   7B models since both containers share the same physical host.

3. **ROCm device passthrough** — `/dev/kfd` and `/dev/dri` are mapped into the
   vLLM container, giving it direct access to the MI300X compute and render
   devices.  `HSA_OVERRIDE_GFX_VERSION=9.4.2` ensures PyTorch/ROCm targets the
   correct GPU architecture (gfx942).

4. **Multi-GPU ready** — Set `VLLM_TP_SIZE` to the number of MI300X GPUs for
   tensor-parallel inference across multiple devices.  AMD Developer Cloud
   offers instances with up to 8× MI300X.

## Troubleshooting

**vLLM fails with "hipErrorNoBinaryForGpu"**
→ The model may not have a precompiled ROCm binary.  Add `--enforce-eager` to
the vLLM command (already in docker-compose.yml).  If it persists, try a model
known to work with vLLM+ROCm like `mistralai/Mistral-7B-Instruct-v0.3`.

**"No GPU found" in vLLM logs**
→ Verify `/dev/kfd` and `/dev/dri` are mapped.  Run `rocminfo` on the host.  If
ROCm isn't installed, re-run `setup.sh`.

**API server can't reach vLLM**
→ Check `docker compose logs api`.  If you see connection refused to
`http://vllm:8000`, vLLM may still be loading the model.  Wait for
`Uvicorn running on http://0.0.0.0:8000` in the vLLM logs.

**Model download is slow**
→ The first launch pulls the model weights from HuggingFace.  This is cached in
the `hf-cache` Docker volume.  Subsequent restarts are instant.

## Stopping

```bash
docker compose down          # stop containers, keep volumes (model cache)
docker compose down -v       # stop and delete everything (re-download model)
```
