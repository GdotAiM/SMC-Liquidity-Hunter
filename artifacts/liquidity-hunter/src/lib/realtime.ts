import { useEffect, useRef, useState, useCallback } from "react";
import { apiUrl } from "./api";
import type { SmcReport } from "@workspace/api-client-react";

// ── Types ────────────────────────────────────────────────────────────────────────

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleUpdateEvent {
  type: "candle_update";
  symbol: string;
  timeframe: string;
  data: CandleData & { isClosed: boolean };
}

export interface CandleClosedEvent {
  type: "candle_closed";
  symbol: string;
  timeframe: string;
  data: CandleData;
}

export interface ReportUpdateEvent {
  type: "report_update";
  symbol: string;
  timeframe: string;
  data: SmcReport;
}

export interface ConnectedEvent {
  type: "connected";
  symbol: string;
  data: {
    clientId: string;
    symbol: string;
    timeframes: string[];
    snapshots: Record<string, {
      symbol: string;
      timeframe: string;
      candles: CandleData[];
      currentCandle: CandleData | null;
      updatedAt: number;
    }>;
  };
}

export type StreamEvent =
  | CandleUpdateEvent
  | CandleClosedEvent
  | ReportUpdateEvent
  | ConnectedEvent
  | { type: "error"; symbol: string; data?: unknown };

// ── Live price per timeframe ─────────────────────────────────────────────────────

export interface LiveTfData {
  currentPrice: number;
  currentCandle: CandleData | null;
  lastClosedCandle: CandleData | null;
  isLive: boolean;
}

// ── Hook ─────────────────────────────────────────────────────────────────────────

interface UseRealtimeStreamOptions {
  symbol: string;
  timeframes: string[];
  /** Called when a candle closes — use this to trigger a report refetch */
  onCandleClosed?: (symbol: string, timeframe: string) => void;
  /** Called when a report update is received from the server */
  onReportUpdate?: (timeframe: string, report: SmcReport) => void;
}

interface UseRealtimeStreamResult {
  /** Per-timeframe live price data */
  liveData: Record<string, LiveTfData>;
  /** Whether the SSE stream is connected */
  connected: boolean;
  /** Latest snapshot candles per timeframe (for chart updates) */
  candles: Record<string, CandleData[]>;
  /** Manually close and reconnect the stream */
  reconnect: () => void;
}

export function useRealtimeStream({
  symbol,
  timeframes,
  onCandleClosed,
  onReportUpdate,
}: UseRealtimeStreamOptions): UseRealtimeStreamResult {
  const [connected, setConnected] = useState(false);
  const [liveData, setLiveData] = useState<Record<string, LiveTfData>>({});
  const [candles, setCandles] = useState<Record<string, CandleData[]>>({});

  const onCandleClosedRef = useRef(onCandleClosed);
  onCandleClosedRef.current = onCandleClosed;
  const onReportUpdateRef = useRef(onReportUpdate);
  onReportUpdateRef.current = onReportUpdate;

  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const connect = useCallback(() => {
    if (!symbol) return;

    // Cancel previous connection
    if (abortRef.current) {
      abortRef.current.abort();
    }
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const tfsParam = timeframes.join(",");
    const url = apiUrl(`/stream/${encodeURIComponent(symbol)}?timeframes=${encodeURIComponent(tfsParam)}`);

    setConnected(false);

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          console.error("[realtime] Stream connection failed:", res.status);
          return;
        }

        setConnected(true);
        const reader = res.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            try {
              const event: StreamEvent = JSON.parse(trimmed.slice(6));
              handleEvent(event);
            } catch {
              // skip malformed events
            }
          }
        }
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") {
          console.error("[realtime] Stream error:", err);
        }
        setConnected(false);
      });

    return () => {
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframes.join(",")]);

  // Handle incoming SSE events
  function handleEvent(event: StreamEvent) {
    switch (event.type) {
      case "connected": {
        // Initialize state from server snapshots
        const newLiveData: Record<string, LiveTfData> = {};
        const newCandles: Record<string, CandleData[]> = {};

        for (const [tf, snap] of Object.entries(event.data.snapshots)) {
          newLiveData[tf] = {
            currentPrice: snap.currentCandle?.close ?? snap.candles[snap.candles.length - 1]?.close ?? 0,
            currentCandle: snap.currentCandle,
            lastClosedCandle: snap.candles.length > 0 ? snap.candles[snap.candles.length - 1] : null,
            isLive: !!snap.currentCandle,
          };
          newCandles[tf] = snap.candles;
        }

        setLiveData(newLiveData);
        setCandles(newCandles);
        break;
      }

      case "candle_update": {
        const tf = event.timeframe;
        setLiveData((prev) => ({
          ...prev,
          [tf]: {
            currentPrice: event.data.close,
            currentCandle: event.data,
            lastClosedCandle: prev[tf]?.lastClosedCandle ?? null,
            isLive: true,
          },
        }));
        // Update the current candle in the candle array
        setCandles((prev) => {
          const existing = prev[tf] ?? [];
          const lastIdx = existing.findIndex((c) => c.time === event.data.time);
          if (lastIdx >= 0) {
            const updated = [...existing];
            updated[lastIdx] = event.data;
            return { ...prev, [tf]: updated };
          }
          return { ...prev, [tf]: [...existing, event.data] };
        });
        break;
      }

      case "candle_closed": {
        const tf = event.timeframe;
        setLiveData((prev) => ({
          ...prev,
          [tf]: {
            ...prev[tf],
            lastClosedCandle: event.data,
            isLive: false, // no open candle until next update
          },
        }));
        // Update the closed candle in the array
        setCandles((prev) => {
          const existing = prev[tf] ?? [];
          const idx = existing.findIndex((c) => c.time === event.data.time);
          if (idx >= 0) {
            const updated = [...existing];
            updated[idx] = event.data;
            return { ...prev, [tf]: updated };
          }
          return { ...prev, [tf]: [...existing, event.data] };
        });
        // Notify parent that a candle closed (trigger refetch)
        onCandleClosedRef.current?.(event.symbol, tf);
        break;
      }

      case "report_update": {
        onReportUpdateRef.current?.(event.timeframe, event.data);
        break;
      }

      case "error": {
        console.error("[realtime] Server error:", event);
        break;
      }
    }
  }

  useEffect(() => {
    connect();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    connect();
  }, [connect]);

  return { liveData, connected, candles, reconnect };
}
