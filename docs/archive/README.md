# Archived Documents

Documents in this folder are superseded or replaced by newer work. They are kept for historical reference only.

## MCP-Related

- **`MCP_IMPLEMENTATION_REPORT.md`** — Original MCP design proposal that used `@anthropic-ai/mcp-sdk` with a separate `artifacts/mcp-server/` package and stdio transport. Superseded by the actual implementation documented in [`MCP_TIER3_IMPLEMENTATION.md`](../../MCP_TIER3_IMPLEMENTATION.md), which uses FastMCP v4.3.2 integrated directly into `artifacts/api-server/src/lib/mcp/`.

## AMD Deployment

- **`README-amd-deploy-v1.md`** — Original AMD Developer Cloud deployment README using Qwen2.5-VL-7B as the default model with `/health` endpoints. Superseded by the current [`deploy/amd-developer-cloud/README.md`](../../deploy/amd-developer-cloud/README.md), which switches to Gemma 4 26B A4B, adds vLLM tool-calling/reasoning parser flags, and uses `/api/healthz` healthchecks.
