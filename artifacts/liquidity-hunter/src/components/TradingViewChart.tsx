import { useEffect, useRef, useState, useCallback } from "react";
import { X, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { toTradingViewSymbol } from "@/lib/alpaca-url";

type Props = {
  symbol: string;
  onClose: () => void;
};

type Status = "loading" | "ready" | "error";

const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) console.log("[TV]", ...args);
}

/**
 * Full-screen TradingView Advanced Chart widget.
 *
 * Known failure modes (all surfaced via status + error UI):
 *  1. tv.js blocked by ad-blocker / firewall / CSP → "error" after script.onerror
 *  2. Container has 0×0 dimensions when script loads → ResizeObserver retries
 *  3. Widget iframe blocked (s.tradingview.com) → 15 s timeout → "error"
 *  4. Symbol unmapped → handled before mount (unsupported message)
 */
export function TradingViewChart({ symbol, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const creationAttemptedRef = useRef(false);
  const statusRef = useRef<Status>("loading");

  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const tvSymbol = toTradingViewSymbol(symbol);
  const label = tvSymbol ?? symbol;

  // ── widget factory ──────────────────────────────────────────────
  const createWidget = useCallback(
    (el: HTMLDivElement): boolean => {
      const rect = el.getBoundingClientRect();
      log("createWidget — rect:", { w: rect.width, h: rect.height, tvSymbol });

      if (rect.width === 0 || rect.height === 0) {
        log("→ deferring (zero dimensions)");
        return false;
      }

      if (!(window as any).TradingView) {
        log("→ TradingView global missing");
        return false;
      }

      try {
        widgetRef.current = new (window as any).TradingView.widget({
          container: el,
          symbol: tvSymbol,
          interval: "60",
          theme: "dark",
          style: "1", // candles
          locale: "en",
          toolbar_bg: "#111111",
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          save_image: true,
          width: rect.width,
          height: rect.height,
          studies: [
            "RSI@tv-basicstudies",
            "MASimple@tv-basicstudies",
            "MASimple@tv-basicstudies",
          ],
          loading_screen: { backgroundColor: "#0d0d0d", foregroundColor: "#888" },
          overrides: {
            "paneProperties.background": "#0d0d0d",
            "paneProperties.backgroundType": "solid",
            "paneProperties.vertGridProperties.color": "#1a1a1a",
            "paneProperties.horzGridProperties.color": "#1a1a1a",
            "mainSeriesProperties.candleStyle.upColor": "#26A69A",
            "mainSeriesProperties.candleStyle.downColor": "#EF5350",
            "mainSeriesProperties.candleStyle.wickUpColor": "#26A69A",
            "mainSeriesProperties.candleStyle.wickDownColor": "#EF5350",
            "mainSeriesProperties.candleStyle.borderUpColor": "#26A69A",
            "mainSeriesProperties.candleStyle.borderDownColor": "#EF5350",
            "scalesProperties.textColor": "#888888",
            "scalesProperties.lineColor": "#1f1f1f",
          },
          disabled_features: [
            "header_symbol_search",
            "header_compare",
            "display_market_status",
          ],
          enabled_features: [
            "side_toolbar_in_fullscreen_mode",
            "study_templates",
          ],
        });

        log("→ widget created");

        // Verify the iframe actually appears (s.tradingview.com can be blocked)
        const iframeCheckId = setTimeout(() => {
          if (!el.isConnected) return;
          const iframe = el.querySelector("iframe");
          if (iframe) {
            log("iframe detected:", iframe.src?.slice(0, 80));
          } else {
            log("WARNING: no iframe in container 2 s after widget creation");
          }
        }, 2000);

        return true;
      } catch (err) {
        log("→ widget constructor threw:", err);
        setErrorMsg(String(err));
        setStatus("error");
        statusRef.current = "error";
        return false;
      }
    },
    [tvSymbol],
  );

  // ── main effect ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !tvSymbol) return;

    const el = containerRef.current;
    creationAttemptedRef.current = false;
    statusRef.current = "loading";
    setStatus("loading");
    setErrorMsg("");

    log("mount — tvSymbol:", tvSymbol);

    // Clean up any previous widget
    if (widgetRef.current) {
      try { widgetRef.current.remove(); } catch {}
      widgetRef.current = null;
    }

    // ── helpers ──
    const tryCreate = () => {
      if (widgetRef.current) return true; // already created
      if (!el.isConnected) return false;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      creationAttemptedRef.current = true;
      const ok = createWidget(el);
      if (ok) {
        setStatus("ready");
        statusRef.current = "ready";
      }
      return ok;
    };

    // Active polling via rAF — ResizeObserver only fires on *changes*,
    // but the container may already be 0×0 when observed and never
    // change (absolute children inside flex-1 can collapse).  We poll
    // every frame for up to 2 s after the script arrives.
    let rafId = 0;
    let pollStart = 0;
    const MAX_POLL_MS = 2000;

    const startPolling = () => {
      if (tryCreate()) return; // success on first attempt
      pollStart = performance.now();
      log("starting rAF poll (dimensions are 0×0)");
      const poll = () => {
        if (!el.isConnected) return;
        if (tryCreate()) return;          // created
        if (performance.now() - pollStart < MAX_POLL_MS) {
          rafId = requestAnimationFrame(poll);
        } else {
          log("rAF poll exhausted — dimensions never materialised");
        }
      };
      rafId = requestAnimationFrame(poll);
    };

    const initWhenReady = () => {
      if (!tryCreate()) startPolling();
    };

    // ── script loading ──
    const existing = document.getElementById("tv-widget-script") as HTMLScriptElement | null;

    if ((window as any).TradingView) {
      log("TradingView global already present");
      initWhenReady();
    } else if (!existing) {
      log("appending tv.js script tag");
      const script = document.createElement("script");
      script.id = "tv-widget-script";
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = () => {
        log("tv.js onload fired");
        initWhenReady();
      };
      script.onerror = () => {
        log("tv.js onerror — network or blocker");
        setErrorMsg(
          "Failed to load TradingView library. It may be blocked by an ad blocker, firewall, or network policy.",
        );
        setStatus("error");
        statusRef.current = "error";
      };
      document.head.appendChild(script);
    } else if (existing.onload) {
      log("tv.js still loading — chaining onload");
      const prev = existing.onload;
      existing.onload = (e: Event) => {
        (prev as any)(e);
        initWhenReady();
      };
    } else {
      log("tv.js tag exists but onload is null — trying init");
      initWhenReady();
    }

    // ── ResizeObserver — keep widget sized to container ──
    const observer = new ResizeObserver(() => {
      if (!el.isConnected) return;
      const rect = el.getBoundingClientRect();
      if (widgetRef.current && rect.width > 0 && rect.height > 0) {
        try { widgetRef.current.resize(rect.width, rect.height); } catch {}
      }
    });
    observer.observe(el);

    // ── timeout guard (iframe blocked by ad-blocker / CSP) ──
    const timeout = setTimeout(() => {
      if (statusRef.current === "loading") {
        log("TIMEOUT — widget never materialised after 15 s");
        setErrorMsg(
          "Chart timed out. TradingView iframe may be blocked by an ad blocker, browser privacy setting, or firewall.",
        );
        setStatus("error");
        statusRef.current = "error";
      }
    }, 15_000);

    return () => {
      log("cleanup");
      clearTimeout(timeout);
      cancelAnimationFrame(rafId);
      observer.disconnect();
      if (widgetRef.current) {
        try { widgetRef.current.remove(); } catch {}
        widgetRef.current = null;
      }
    };
  }, [tvSymbol, createWidget]);

  // ── retry ───────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    if (!containerRef.current) return;
    setStatus("loading");
    statusRef.current = "loading";
    setErrorMsg("");
    creationAttemptedRef.current = false;

    if (widgetRef.current) {
      try { widgetRef.current.remove(); } catch {}
      widgetRef.current = null;
    }

    const ok = createWidget(containerRef.current);
    if (ok) {
      setStatus("ready");
      statusRef.current = "ready";
    }
  }, [createWidget]);

  // ── render ──────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] bg-[#0d0d0d] flex flex-col">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#1f1f1f] bg-[#111]/95 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-bold text-foreground tracking-tight">
            {label}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm border border-blue-500/30 bg-blue-500/10 text-blue-400 font-bold uppercase tracking-wider">
            TradingView
          </span>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            Indicators · Drawing tools · Multi-TF
          </span>
        </div>

        <button
          onClick={onClose}
          className="ml-auto p-1.5 hover:bg-[#1f1f1f] rounded-sm transition-colors"
          title="Close TradingView chart"
        >
          <X className="w-4 h-4 text-[#555]" />
        </button>
      </div>

      {/* ── Chart body ── */}
      <div className="flex-1 relative min-h-0">
        {tvSymbol ? (
          <>
            {/* The TradingView widget mounts into this div */}
            <div ref={containerRef} className="absolute inset-0 w-full h-full" />

            {/* Loading overlay */}
            {status === "loading" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d0d0d] z-10">
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                <span className="text-sm text-muted-foreground">
                  Loading TradingView chart…
                </span>
              </div>
            )}

            {/* Error overlay */}
            {status === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0d0d0d] z-10 px-6">
                <AlertTriangle className="w-8 h-8 text-amber-500" />
                <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
                  {errorMsg || "Failed to load chart."}
                </p>
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-2 px-4 py-2 rounded-sm border border-[#2a2a2a] bg-[#181818] text-[#888] hover:text-primary hover:border-primary/50 transition-colors text-xs font-bold uppercase tracking-wider"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            This symbol is not supported by TradingView.
          </div>
        )}
      </div>
    </div>
  );
}
