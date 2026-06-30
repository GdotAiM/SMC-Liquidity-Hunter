import { EventEmitter } from "events";
import { logger } from "../logger.js";
import type { Candle } from "../smc/types.js";

// ── Types ────────────────────────────────────────────────────────────────────────

export interface CandleUpdate {
  symbol: string;
  timeframe: string;
  time: number;       // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;  // true = kline finalized, false = still forming
}

export interface CandleSnapshot {
  symbol: string;
  timeframe: string;
  candles: Candle[];           // closed candles + current forming candle
  currentCandle: Candle | null; // the currently-forming candle (same as last if isClosed=false)
  updatedAt: number;           // unix ms
}

type StoreKey = string; // `${symbol}|${timeframe}`

// ── Store ────────────────────────────────────────────────────────────────────────

class CandleStore extends EventEmitter {
  /** Closed candles per symbol|timeframe (sorted by time ascending) */
  private closed: Map<StoreKey, Candle[]> = new Map();

  /** Currently-forming (open) candle per symbol|timeframe */
  private openCandle: Map<StoreKey, Candle> = new Map();

  /** Max closed candles to retain per stream */
  private maxCandles = 500;

  /** Track active symbols for status reporting */
  private activeSymbols: Set<string> = new Set();

  // ── Apply an update from the WebSocket ──────────────────────────────────────

  applyUpdate(update: CandleUpdate): void {
    const key = this.key(update.symbol, update.timeframe);
    const candle = this.toCandle(update);
    this.activeSymbols.add(update.symbol);

    if (update.isClosed) {
      // Kline finalized — move from open → closed
      this.openCandle.delete(key);

      const closedList = this.closed.get(key) ?? [];
      // Replace or append
      const existingIdx = closedList.findIndex((c) => c.time === candle.time);
      if (existingIdx >= 0) {
        closedList[existingIdx] = candle;
      } else {
        closedList.push(candle);
        // Keep sorted
        closedList.sort((a, b) => a.time - b.time);
        // Trim
        while (closedList.length > this.maxCandles) closedList.shift();
      }
      this.closed.set(key, closedList);

      this.emit("candleClosed", { symbol: update.symbol, timeframe: update.timeframe, candle });
    } else {
      // Kline still forming
      this.openCandle.set(key, candle);
      this.emit("candleUpdate", { symbol: update.symbol, timeframe: update.timeframe, candle });
    }
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  /** Get all candles for a symbol/timeframe (closed + current open) */
  getCandles(symbol: string, timeframe: string): Candle[] {
    const key = this.key(symbol, timeframe);
    const closed = this.closed.get(key) ?? [];
    const open = this.openCandle.get(key);

    if (open) {
      // Check if the open candle is already in the closed list
      const lastClosed = closed[closed.length - 1];
      if (lastClosed && lastClosed.time === open.time) {
        // Already in closed list, just return closed
        return closed;
      }
      return [...closed, open];
    }
    return closed;
  }

  /** Get a complete snapshot for a symbol/timeframe */
  getSnapshot(symbol: string, timeframe: string): CandleSnapshot {
    const key = this.key(symbol, timeframe);
    return {
      symbol,
      timeframe,
      candles: this.getCandles(symbol, timeframe),
      currentCandle: this.openCandle.get(key) ?? null,
      updatedAt: Date.now(),
    };
  }

  /** Get all active symbols currently being tracked */
  getActiveSymbols(): string[] {
    return [...this.activeSymbols];
  }

  /** Check if we have any data for a symbol */
  hasData(symbol: string): boolean {
    for (const [key] of this.closed) {
      if (key.startsWith(`${symbol}|`)) return true;
    }
    for (const [key] of this.openCandle) {
      if (key.startsWith(`${symbol}|`)) return true;
    }
    return false;
  }

  /** Clear all data for a specific symbol (e.g., when switching symbols) */
  clearSymbol(symbol: string): void {
    const prefix = `${symbol}|`;
    for (const key of this.closed.keys()) {
      if (key.startsWith(prefix)) this.closed.delete(key);
    }
    for (const key of this.openCandle.keys()) {
      if (key.startsWith(prefix)) this.openCandle.delete(key);
    }
    this.activeSymbols.delete(symbol);
  }

  /**
   * Bulk-load historical closed candles for a symbol/timeframe.
   * Used to backfill from REST API before the WebSocket stream starts.
   * Deduplicates against existing candles by time.
   */
  seedCandles(symbol: string, timeframe: string, candles: Candle[]): void {
    if (candles.length === 0) return;

    const key = this.key(symbol, timeframe);
    const existing = this.closed.get(key) ?? [];
    const existingTimes = new Set(existing.map((c) => c.time));

    // Merge: add new candles not already present
    const merged = [...existing];
    for (const c of candles) {
      if (!existingTimes.has(c.time)) {
        merged.push(c);
      }
    }

    // Sort and trim
    merged.sort((a, b) => a.time - b.time);
    while (merged.length > this.maxCandles) merged.shift();

    this.closed.set(key, merged);
    this.activeSymbols.add(symbol);

    logger.info({
      symbol,
      timeframe,
      added: merged.length - existing.length,
      total: merged.length,
    }, "Candle store seeded from historical backfill");
  }

  /** Return a report of what's being tracked */
  getStatus(): Record<string, { closedCount: number; hasOpen: boolean; latestTime?: number }> {
    const status: Record<string, { closedCount: number; hasOpen: boolean; latestTime?: number }> = {};
    const allKeys = new Set([...this.closed.keys(), ...this.openCandle.keys()]);
    for (const key of allKeys) {
      const closed = this.closed.get(key) ?? [];
      const open = this.openCandle.get(key);
      status[key] = {
        closedCount: closed.length,
        hasOpen: !!open,
        latestTime: open?.time ?? closed[closed.length - 1]?.time,
      };
    }
    return status;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private key(symbol: string, timeframe: string): StoreKey {
    return `${symbol}|${timeframe}`;
  }

  private toCandle(u: CandleUpdate): Candle {
    return {
      time: u.time,
      open: u.open,
      high: u.high,
      low: u.low,
      close: u.close,
      volume: u.volume,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────────

export const candleStore = new CandleStore();
