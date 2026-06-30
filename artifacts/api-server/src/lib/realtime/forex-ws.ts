/**
 * Forex WebSocket Manager — Finnhub WS (tick data) + REST polling (candles).
 *
 * Two modes:
 *   WITH FINNHUB_API_KEY:  Finnhub WS for live price ticks + Finnhub REST for candles.
 *   WITHOUT KEY (fallback): Enhanced Yahoo polling (15s) for all candle data.
 *
 * Both paths feed into the shared candleStore, which triggers the analysis-bridge
 * to rebuild SMC reports and push them to browsers via SSE.
 */

import WebSocket from "ws";
import https from "https";
import { logger } from "../logger.js";
import { candleStore, type CandleUpdate } from "./candle-store.js";
import { fetchYahooCandles, fetchYahooDailyCandles } from "../fetchers/yahoo.js";
import type { Candle } from "../smc/types.js";

// ── Symbol mapping ───────────────────────────────────────────────────────────────

/** Yahoo symbol → Finnhub forex symbol. Only major pairs mapped. */
const YAHOO_TO_FINNHUB: Record<string, string> = {
  "EURUSD=X": "OANDA:EUR_USD",
  "GBPUSD=X": "OANDA:GBP_USD",
  "USDJPY=X": "OANDA:USD_JPY",
  "AUDUSD=X": "OANDA:AUD_USD",
  "USDCAD=X": "OANDA:USD_CAD",
  "USDCHF=X": "OANDA:USD_CHF",
  "NZDUSD=X": "OANDA:NZD_USD",
  "EURJPY=X": "OANDA:EUR_JPY",
  "GBPJPY=X": "OANDA:GBP_JPY",
  "XAUUSD=X": "OANDA:XAU_USD",
};

function toFinnhubSymbol(yahooSymbol: string): string | null {
  return YAHOO_TO_FINNHUB[yahooSymbol.toUpperCase()] ?? null;
}

// Timeframe → Finnhub resolution & poll interval
const TF_POLL_CONFIG: Record<string, { resolution: string; intervalMs: number }> = {
  "1m":  { resolution: "1",  intervalMs: 15_000  },
  "5m":  { resolution: "5",  intervalMs: 30_000  },
  "15m": { resolution: "15", intervalMs: 60_000  },
  "1h":  { resolution: "60", intervalMs: 120_000 },
  "4h":  { resolution: "60", intervalMs: 300_000 }, // Finnhub doesn't have 4h, use 60 + aggregate
  "1d":  { resolution: "D",  intervalMs: 600_000 },
  "1w":  { resolution: "W",  intervalMs: 900_000 },
};

const FINNHUB_REST_BASE = "https://finnhub.io/api/v1";

// ── Manager ──────────────────────────────────────────────────────────────────────

class ForexWsManager {
  private finnhubWs: WebSocket | null = null;
  private activeSymbols: Map<string, Set<string>> = new Map(); // yahooSymbol → timeframes
  private lastKnownTime: Map<string, number> = new Map();       // "SYMBOL|TF" → last candle end time
  private currentPrices: Map<string, number> = new Map();       // symbol → latest tick price
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();  // "SYMBOL|TF" → timer
  private isShutdown = false;
  private apiKey: string | null;

  constructor() {
    this.apiKey = process.env.FINNHUB_API_KEY?.trim() || null;
    if (this.apiKey) {
      logger.info("Finnhub API key found — using Finnhub WS + REST for forex");
    } else {
      logger.info("No FINNHUB_API_KEY — using enhanced Yahoo polling for forex (15s)");
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  subscribe(yahooSymbol: string, timeframes: string[]): void {
    if (this.isShutdown) return;

    const sym = yahooSymbol.toUpperCase();
    const existing = this.activeSymbols.get(sym);
    const isNew = !existing || existing.size === 0;

    if (!existing) {
      this.activeSymbols.set(sym, new Set(timeframes));
    } else {
      for (const tf of timeframes) existing.add(tf);
    }

    // Connect Finnhub WS for live ticks (if API key available and new symbol)
    if (this.apiKey && isNew) {
      this.connectFinnhubWs();
    }

    // Start polling for candle data
    for (const tf of timeframes) {
      this.schedulePoll(sym, tf);
    }

    // Backfill historical data immediately
    if (isNew) {
      this.backfillHistory(sym);
    }

    // Immediate first poll for all TFs
    for (const tf of timeframes) {
      this.pollCandles(sym, tf);
    }
  }

  unsubscribe(yahooSymbol: string): void {
    const sym = yahooSymbol.toUpperCase();
    this.activeSymbols.delete(sym);

    // Cancel poll timers for this symbol
    for (const [key, timer] of this.pollTimers) {
      if (key.startsWith(`${sym}|`)) {
        clearTimeout(timer);
        this.pollTimers.delete(key);
      }
    }

    // Update Finnhub WS subscriptions
    if (this.apiKey) {
      this.connectFinnhubWs();
    }

    if (this.activeSymbols.size === 0) {
      this.disconnectFinnhub();
    }
  }

  shutdown(): void {
    this.isShutdown = true;
    this.disconnectFinnhub();
    for (const timer of this.pollTimers.values()) {
      clearTimeout(timer);
    }
    this.pollTimers.clear();
    logger.info("Forex WS manager shut down");
  }

  // ── Finnhub WebSocket (live ticks only) ───────────────────────────────────────

  private connectFinnhubWs(): void {
    if (!this.apiKey) return;

    // Close existing connection
    this.disconnectFinnhub();

    const url = `wss://ws.finnhub.io?token=${this.apiKey}`;

    try {
      this.finnhubWs = new WebSocket(url);

      this.finnhubWs.on("open", () => {
        logger.info({ symbols: [...this.activeSymbols.keys()] }, "Finnhub WS connected");
        // Subscribe to all active forex symbols
        for (const yahooSym of this.activeSymbols.keys()) {
          const fhSym = toFinnhubSymbol(yahooSym);
          if (fhSym) {
            this.finnhubWs?.send(JSON.stringify({ type: "subscribe", symbol: fhSym }));
          }
        }
      });

      this.finnhubWs.on("message", (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "trade" && Array.isArray(msg.data)) {
            for (const trade of msg.data) {
              this.handleFinnhubTick(trade);
            }
          }
        } catch {
          // skip malformed
        }
      });

      this.finnhubWs.on("close", () => {
        logger.info("Finnhub WS closed");
        this.finnhubWs = null;
      });

      this.finnhubWs.on("error", (err) => {
        logger.warn({ err: (err as Error).message }, "Finnhub WS error");
        this.finnhubWs = null;
      });
    } catch (err) {
      logger.warn({ err }, "Failed to connect Finnhub WS");
      this.finnhubWs = null;
    }
  }

  private disconnectFinnhub(): void {
    if (this.finnhubWs) {
      try {
        for (const yahooSym of this.activeSymbols.keys()) {
          const fhSym = toFinnhubSymbol(yahooSym);
          if (fhSym) {
            this.finnhubWs.send(JSON.stringify({ type: "unsubscribe", symbol: fhSym }));
          }
        }
      } catch { /* ignore */ }
      this.finnhubWs.removeAllListeners();
      this.finnhubWs.close();
      this.finnhubWs = null;
    }
  }

  private handleFinnhubTick(trade: { s?: string; p?: number; t?: number }): void {
    if (!trade.s || trade.p == null || trade.t == null) return;

    // Reverse-map Finnhub symbol → Yahoo symbol
    const yahooSym = this.finnhubToYahoo(trade.s);
    if (!yahooSym || !this.activeSymbols.has(yahooSym)) return;

    const price = trade.p;
    this.currentPrices.set(yahooSym, price);

    // Update 1m forming candle in candleStore (live price only)
    const candleTime = Math.floor(trade.t / 60000) * 60; // round to minute
    const existing = candleStore.getSnapshot(yahooSym, "1m");

    if (existing.currentCandle && existing.currentCandle.time === candleTime) {
      // Update the existing forming candle
      candleStore.applyUpdate({
        symbol: yahooSym,
        timeframe: "1m",
        time: candleTime,
        open: existing.currentCandle.open,
        high: Math.max(existing.currentCandle.high, price),
        low: Math.min(existing.currentCandle.low, price),
        close: price,
        volume: existing.currentCandle.volume,
        isClosed: false,
      });
    } else {
      // New minute candle started by the tick
      candleStore.applyUpdate({
        symbol: yahooSym,
        timeframe: "1m",
        time: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        isClosed: false,
      });
    }
  }

  private finnhubToYahoo(fhSymbol: string): string | null {
    for (const [yahoo, fh] of Object.entries(YAHOO_TO_FINNHUB)) {
      if (fh === fhSymbol) return yahoo;
    }
    return null;
  }

  // ── REST polling (candle data for all TFs) ────────────────────────────────────

  private schedulePoll(symbol: string, tf: string): void {
    const key = `${symbol}|${tf}`;
    if (this.pollTimers.has(key)) return;

    const config = TF_POLL_CONFIG[tf] ?? { resolution: "1", intervalMs: 60_000 };
    // Use longer intervals when Finnhub REST is active (rate limits)
    const interval = this.apiKey ? Math.max(config.intervalMs, 60_000) : 15_000;

    const doPoll = () => {
      if (this.isShutdown || !this.activeSymbols.has(symbol)) return;
      this.pollCandles(symbol, tf);
      // Re-schedule
      const next = setTimeout(doPoll, interval);
      this.pollTimers.set(key, next);
    };

    const initial = setTimeout(doPoll, 500); // first poll after 500ms
    this.pollTimers.set(key, initial);
  }

  private async pollCandles(symbol: string, tf: string): Promise<void> {
    try {
      const key = `${symbol}|${tf}`;
      const lastKnown = this.lastKnownTime.get(key) ?? 0;
      const candles = await this.fetchCandles(symbol, tf);

      if (candles.length === 0) return;

      // On first poll, seed all historical data
      if (lastKnown === 0) {
        candleStore.seedCandles(symbol, tf, candles);
        this.lastKnownTime.set(key, candles[candles.length - 1].time);
        return;
      }

      // Feed new candles (those after lastKnown) into candleStore
      for (const c of candles) {
        if (c.time > lastKnown) {
          candleStore.applyUpdate({
            symbol,
            timeframe: tf,
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            isClosed: true,
          });
          this.lastKnownTime.set(key, c.time);
        }
      }
    } catch (err) {
      logger.debug({ err, symbol, tf }, "Forex poll failed");
    }
  }

  private async fetchCandles(symbol: string, tf: string): Promise<Candle[]> {
    if (this.apiKey) {
      return this.fetchFinnhubCandles(symbol, tf);
    }
    return fetchYahooCandles(symbol, tf);
  }

  private async fetchFinnhubCandles(symbol: string, tf: string): Promise<Candle[]> {
    const fhSym = toFinnhubSymbol(symbol);
    if (!fhSym) return [];

    const config = TF_POLL_CONFIG[tf] ?? { resolution: "1", intervalMs: 60_000 };
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400; // last 24 hours

    const url = `${FINNHUB_REST_BASE}/forex/candle?symbol=${encodeURIComponent(fhSym)}&resolution=${config.resolution}&from=${from}&to=${now}&token=${this.apiKey}`;

    const data = await restGet(url) as {
      s?: string;
      o?: number[];
      h?: number[];
      l?: number[];
      c?: number[];
      v?: number[];
      t?: number[];
    };

    if (data.s !== "ok" || !data.t || !data.o) return [];

    const candles: Candle[] = [];
    for (let i = 0; i < data.t.length; i++) {
      if (data.o[i] == null || data.c[i] == null) continue;
      candles.push({
        time: data.t[i],
        open: data.o[i],
        high: data.h?.[i] ?? data.o[i],
        low: data.l?.[i] ?? data.o[i],
        close: data.c[i],
        volume: data.v?.[i] ?? 0,
      });
    }
    return candles;
  }

  private async backfillHistory(symbol: string): Promise<void> {
    const tfs = this.activeSymbols.get(symbol);
    if (!tfs) return;

    for (const tf of tfs) {
      try {
        const candles = await this.fetchCandles(symbol, tf);
        if (candles.length > 0) {
          candleStore.seedCandles(symbol, tf, candles);
          this.lastKnownTime.set(`${symbol}|${tf}`, candles[candles.length - 1].time);
        }
      } catch {
        // backfill is best-effort
      }
    }
  }
}

// ── HTTPS helper ─────────────────────────────────────────────────────────────────

function restGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10_000 }, (res) => {
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
    }).on("error", reject).on("timeout", function(this: https.ClientRequest) { this.destroy(); reject(new Error("timeout")); });
  });
}

// ── Singleton ─────────────────────────────────────────────────────────────────────

export const forexWs = new ForexWsManager();
