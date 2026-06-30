import WebSocket from "ws";
import https from "https";
import { logger } from "../logger.js";
import { candleStore, type CandleUpdate } from "./candle-store.js";
import type { Candle } from "../smc/types.js";

// ── Types ────────────────────────────────────────────────────────────────────────

interface BinanceKlineEvent {
  e: "kline";
  E: number;
  s: string;  // symbol, uppercase
  k: {
    t: number;   // kline start time (ms)
    T: number;   // kline close time (ms)
    s: string;   // symbol
    i: string;   // interval
    o: string;   // open
    c: string;   // close
    h: string;   // high
    l: string;   // low
    v: string;   // base asset volume
    n: number;   // number of trades
    x: boolean;  // is the kline closed (final)?
  };
}

// Binance endpoints — tried in order until one works
// REST mirrors WS: index 0 = US, index 1 = global
const WS_ENDPOINTS = [
  "wss://stream.binance.us:9443/ws",
  "wss://stream.binance.com:9443/ws",
];

const REST_ENDPOINTS = [
  "https://api.binance.us",
  "https://api.binance.com",
];

const TF_TO_BINANCE: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m",
  "1h": "1h", "4h": "4h",
  "1d": "1d", "1w": "1w",
};

// ── Historical backfill ──────────────────────────────────────────────────────────

/**
 * Fetch historical closed klines from Binance REST API.
 * Returns up to `limit` candles sorted oldest→newest, excluding the current
 * forming candle (the one whose time matches the WebSocket's open candle).
 */
async function fetchHistoricalKlines(
  symbol: string,
  timeframe: string,
  limit = 300,
): Promise<Candle[]> {
  const binanceInterval = TF_TO_BINANCE[timeframe];
  if (!binanceInterval) return [];

  // Try REST endpoints in order (same index strategy as WS)
  for (let i = 0; i < REST_ENDPOINTS.length; i++) {
    try {
      const base = REST_ENDPOINTS[i];
      const url = `${base}/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${binanceInterval}&limit=${limit}`;

      const data = await restGet(url);
      if (!data || !Array.isArray(data)) continue;

      const candles: Candle[] = [];
      let lastCloseTime = 0;
      for (const row of data) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const openTime = Number(row[0]);
        lastCloseTime = Number(row[6]);

        candles.push({
          time: Math.floor(openTime / 1000),
          open: parseFloat(row[1] as string),
          high: parseFloat(row[2] as string),
          low: parseFloat(row[3] as string),
          close: parseFloat(row[4] as string),
          volume: parseFloat(row[5] as string),
        });
      }

      // Exclude the last candle if it's still forming (closeTime in the future).
      // Binance REST returns the current forming candle last; we want WS to handle it.
      if (candles.length > 0 && lastCloseTime > Date.now()) {
        candles.pop();
      }

      logger.info({
        symbol,
        timeframe,
        count: candles.length,
        endpoint: base,
      }, "Historical klines fetched");

      return candles;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ symbol, timeframe, endpoint: REST_ENDPOINTS[i], err: msg }, "Historical fetch failed, trying next endpoint");
    }
  }

  logger.warn({ symbol, timeframe }, "All historical kline endpoints failed");
  return [];
}

/** Simple HTTPS GET returning parsed JSON */
function restGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000 }, (res) => {
      // 451 = geo-restricted, try next endpoint
      if (res.statusCode === 451) {
        reject(new Error("HTTP 451"));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// ── Manager ──────────────────────────────────────────────────────────────────────

class BinanceWsManager {
  private ws: WebSocket | null = null;
  /** All active symbols and their timeframes. Key = uppercase symbol. */
  private activeSymbols: Map<string, Set<string>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30_000;
  private isShutdown = false;
  private endpointIndex = 0;

  /**
   * Subscribe to real-time kline data for a symbol + timeframes.
   * Multiple symbols share a single WebSocket connection via combined streams.
   * Triggers historical backfill on first subscription for a symbol.
   */
  subscribe(symbol: string, timeframes: string[]): void {
    if (this.isShutdown) return;

    const sym = symbol.toUpperCase();
    const existing = this.activeSymbols.get(sym);
    const isNew = !existing || existing.size === 0;

    // Merge timeframes
    if (!existing) {
      this.activeSymbols.set(sym, new Set(timeframes));
    } else {
      for (const tf of timeframes) existing.add(tf);
    }

    // Reconnect with the expanded stream list
    this.reconnectDelay = 100; // short delay when adding symbols
    this.connect();

    // Backfill historical data for new symbols
    if (isNew) {
      for (const tf of timeframes) {
        fetchHistoricalKlines(sym, tf)
          .then((candles) => {
            if (candles.length > 0) candleStore.seedCandles(sym, tf, candles);
          })
          .catch((err) => {
            logger.warn({ err, symbol: sym, tf }, "Backfill failed, continuing with WS data only");
          });
      }
    }
  }

  /**
   * Unsubscribe a symbol (e.g., when last SSE client for that symbol disconnects).
   */
  unsubscribe(symbol: string): void {
    const sym = symbol.toUpperCase();
    this.activeSymbols.delete(sym);

    if (this.activeSymbols.size === 0) {
      this.disconnect();
    } else {
      // Reconnect without this symbol's streams
      this.connect();
    }
  }

  private connect(): void {
    if (this.isShutdown) return;

    // Build combined stream URL for all active symbols
    const streams: string[] = [];
    for (const [symbol, tfs] of this.activeSymbols) {
      for (const tf of tfs) {
        if (TF_TO_BINANCE[tf]) {
          streams.push(`${symbol.toLowerCase()}@kline_${TF_TO_BINANCE[tf]}`);
        }
      }
    }

    if (streams.length === 0) {
      logger.info("No active streams, skipping WS connect");
      return;
    }

    const base = WS_ENDPOINTS[this.endpointIndex % WS_ENDPOINTS.length];
    const url = `${base}/${streams.join("/")}`;
    const symbols = [...this.activeSymbols.keys()];

    logger.info({ url, symbols, streamCount: streams.length }, "Binance WS connecting");

    // Close existing connection
    this.disconnect();

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      logger.info({ symbols, endpoint: base }, "Binance WS connected");
      this.reconnectDelay = 1000;
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const raw = JSON.parse(data.toString()) as BinanceKlineEvent;
        if (raw.e !== "kline") return;

        const k = raw.k;
        const tf = this.binanceTfToApp(k.i);
        if (!tf) return;

        const update: CandleUpdate = {
          symbol: k.s.toUpperCase(),
          timeframe: tf,
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isClosed: k.x,
        };

        candleStore.applyUpdate(update);
      } catch {
        // skip malformed messages
      }
    });

    this.ws.on("close", (code, reason) => {
      logger.warn({ code, reason: reason.toString() }, "Binance WS closed");
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, endpoint: base }, "Binance WS error");

      if (msg.includes("451") && this.endpointIndex + 1 < WS_ENDPOINTS.length) {
        this.endpointIndex++;
        logger.info({ nextEndpoint: WS_ENDPOINTS[this.endpointIndex] }, "Switching Binance endpoint due to 451");
        this.reconnectDelay = 100;
        this.scheduleReconnect();
        return;
      }

      this.ws?.close();
    });

    this.ws.on("unexpected-response", (_req, res) => {
      logger.error({ status: res.statusCode }, "Binance WS unexpected response");
      if (res.statusCode === 451 && this.endpointIndex + 1 < WS_ENDPOINTS.length) {
        this.endpointIndex++;
        logger.info({ nextEndpoint: WS_ENDPOINTS[this.endpointIndex] }, "Switching Binance endpoint due to 451");
        this.reconnectDelay = 100;
        this.scheduleReconnect();
      }
    });
  }

  /** Graceful shutdown */
  shutdown(): void {
    this.isShutdown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.disconnect();
    logger.info("Binance WS manager shut down");
  }

  private disconnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isShutdown || this.activeSymbols.size === 0) return;
    if (this.reconnectTimer) return;

    logger.info({ delay: this.reconnectDelay }, "Scheduling Binance WS reconnect");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isShutdown && this.activeSymbols.size > 0) {
        this.connect();
      }
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private binanceTfToApp(interval: string): string | null {
    for (const [appTf, binTf] of Object.entries(TF_TO_BINANCE)) {
      if (binTf === interval) return appTf;
    }
    return null;
  }
}

// Also remove the old StreamConfig interface and update exports
// ── Singleton ─────────────────────────────────────────────────────────────────────

export const binanceWs = new BinanceWsManager();
