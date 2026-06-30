import app from "./app";
import { logger } from "./lib/logger";
import { binanceWs } from "./lib/realtime/binance-ws.js";
import { forexWs } from "./lib/realtime/forex-ws.js";
// Side-effect: wires candleClosed → SMC engine → cache → SSE broadcast
import "./lib/realtime/analysis-bridge.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Subscribe to Binance WebSocket for the default crypto symbol on startup
  binanceWs.subscribe("BTCUSDT", ["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);

  // Start forex real-time for the default pair (Finnhub WS or Yahoo polling)
  forexWs.subscribe("EURUSD=X", ["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  binanceWs.shutdown();
  forexWs.shutdown();
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => {
    logger.warn("Forced shutdown after timeout");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
