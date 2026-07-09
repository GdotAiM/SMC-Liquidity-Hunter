/**
 * SMC Pulse Predict — MCP Server Factory
 *
 * Creates a FastMCP server that wraps the SMC engine, candle store, and
 * real-time pipeline as MCP tools, resources, and prompts. Runs in-process
 * with the Express API server on the same port via HTTP streaming transport.
 */

import { FastMCP } from "fastmcp";
import { registerStructureTool } from "./tools/structure.js";
import { registerLiquidityTool } from "./tools/liquidity.js";
import { registerOrderBlocksTool } from "./tools/order-blocks.js";
import { registerFvgTool } from "./tools/fvg.js";
import { registerPdArrayTool } from "./tools/pd-array.js";
import { registerDailyBiasTool } from "./tools/daily-bias.js";
import { registerSmtTool } from "./tools/smt.js";
import { registerDrawTargetsTool } from "./tools/draw-targets.js";
import { registerFullReportTool } from "./tools/full-report.js";
import { registerLiveCandlesTool } from "./tools/live-candles.js";
import { registerScanAllTool } from "./tools/scan-all.js";
import { registerCandleResource } from "./resources/candles.js";
import { registerStatusResource } from "./resources/status.js";
import { registerSmcAnalysisPrompt } from "./prompts/analysis.js";

export function createSmcMcpServer(): FastMCP {
  const server = new FastMCP({
    name: "SMC Pulse Predict — Liquidity Hunter",
    version: "1.0.0",
  });

  // ── Tools (11) ────────────────────────────────────────────────────────────
  registerStructureTool(server);
  registerLiquidityTool(server);
  registerOrderBlocksTool(server);
  registerFvgTool(server);
  registerPdArrayTool(server);
  registerDailyBiasTool(server);
  registerSmtTool(server);
  registerDrawTargetsTool(server);
  registerFullReportTool(server);
  registerLiveCandlesTool(server);
  registerScanAllTool(server);

  // ── Resources (2) ─────────────────────────────────────────────────────────
  registerCandleResource(server);
  registerStatusResource(server);

  // ── Prompts (1) ───────────────────────────────────────────────────────────
  registerSmcAnalysisPrompt(server);

  return server;
}
