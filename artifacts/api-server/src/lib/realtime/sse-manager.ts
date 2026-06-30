import type { Response } from "express";
import { logger } from "../logger.js";
import { candleStore, type CandleUpdate, type CandleSnapshot } from "./candle-store.js";
import type { SmcReport } from "../smc/types.js";

// ── Types ────────────────────────────────────────────────────────────────────────

interface SseClient {
  id: string;
  res: Response;
  symbol: string;
  timeframes: string[];
  connectedAt: number;
}

interface SseEvent {
  type: "candle_update" | "candle_closed" | "report_update" | "connected" | "error";
  symbol: string;
  timeframe?: string;
  data?: unknown;
}

// ── Manager ───────────────────────────────────────────────────────────────────────

class SseManager {
  /** Map of clientId → SseClient */
  private clients: Map<string, SseClient> = new Map();
  private idCounter = 0;

  constructor() {
    // Listen to candle store events and broadcast to clients
    candleStore.on("candleUpdate", (evt: { symbol: string; timeframe: string; candle: CandleUpdate }) => {
      this.broadcast({
        type: "candle_update",
        symbol: evt.symbol,
        timeframe: evt.timeframe,
        data: evt.candle,
      });
    });

    candleStore.on("candleClosed", (evt: { symbol: string; timeframe: string; candle: CandleUpdate }) => {
      this.broadcast({
        type: "candle_closed",
        symbol: evt.symbol,
        timeframe: evt.timeframe,
        data: evt.candle,
      });
    });
  }

  // ── Client lifecycle ────────────────────────────────────────────────────────

  /** Register a new SSE client. Returns the client ID for the SSE stream. */
  addClient(res: Response, symbol: string, timeframes: string[]): string {
    const id = `sse_${++this.idCounter}`;
    const client: SseClient = {
      id,
      res,
      symbol: symbol.toUpperCase(),
      timeframes,
      connectedAt: Date.now(),
    };

    this.clients.set(id, client);

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send initial connected event with current snapshots
    this.sendToClient(client, {
      type: "connected",
      symbol: client.symbol,
      data: {
        clientId: id,
        symbol: client.symbol,
        timeframes: client.timeframes,
        snapshots: this.buildInitialSnapshots(client.symbol, client.timeframes),
      },
    });

    // Clean up on client disconnect
    res.on("close", () => {
      this.clients.delete(id);
      logger.info({ clientId: id, symbol: client.symbol }, "SSE client disconnected");
    });

    logger.info({ clientId: id, symbol: client.symbol, tfs: timeframes }, "SSE client connected");
    return id;
  }

  /** Remove a client by ID */
  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      client.res.end();
      this.clients.delete(id);
    }
  }

  // ── Broadcasting ────────────────────────────────────────────────────────────

  /** Broadcast an event to all clients subscribed to the given symbol */
  broadcast(event: SseEvent): void {
    const clientsForSymbol = [...this.clients.values()].filter(
      (c) => c.symbol === event.symbol.toUpperCase(),
    );

    for (const client of clientsForSymbol) {
      // Filter by timeframe if specified
      if (event.timeframe && !client.timeframes.includes(event.timeframe)) {
        continue;
      }
      this.sendToClient(client, event);
    }
  }

  /**
   * Broadcast a full SMC report update (called when the server recomputes
   * analysis after a candle close).
   */
  broadcastReport(symbol: string, timeframe: string, report: SmcReport): void {
    this.broadcast({
      type: "report_update",
      symbol,
      timeframe,
      data: report,
    });
  }

  /** Get the number of connected clients */
  getClientCount(): number {
    return this.clients.size;
  }

  /** Get a summary of connected clients */
  getStatus(): Array<{ id: string; symbol: string; timeframes: string[]; connectedAt: number }> {
    return [...this.clients.values()].map((c) => ({
      id: c.id,
      symbol: c.symbol,
      timeframes: c.timeframes,
      connectedAt: c.connectedAt,
    }));
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private sendToClient(client: SseClient, event: SseEvent): void {
    try {
      client.res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected — will be cleaned up on 'close' event
    }
  }

  private buildInitialSnapshots(symbol: string, timeframes: string[]): Record<string, CandleSnapshot> {
    const snapshots: Record<string, CandleSnapshot> = {};
    for (const tf of timeframes) {
      snapshots[tf] = candleStore.getSnapshot(symbol, tf);
    }
    return snapshots;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────────

export const sseManager = new SseManager();
