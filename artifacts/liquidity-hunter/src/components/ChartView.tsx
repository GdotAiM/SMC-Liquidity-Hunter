import { useEffect, useRef, useCallback, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineStyle,
  CrosshairMode,
  createSeriesMarkers,
} from "lightweight-charts";
import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { SmcReport } from "@workspace/api-client-react";
import { X } from "lucide-react";

type Market = "crypto" | "forex";
type CandleSeries = ISeriesApi<SeriesType>;

// ── Session colour config ──────────────────────────────────────────────────────

const SESSION_CONFIG: Record<
  string,
  { fill: string; label: string; labelColor: string }
> = {
  Asian:         { fill: "rgba(100,160,255,0.05)", label: "Asian",       labelColor: "rgba(140,190,255,0.85)" },
  London:        { fill: "rgba(255,165,80,0.05)",  label: "London",      labelColor: "rgba(255,185,110,0.85)" },
  "New York AM": { fill: "rgba(100,220,160,0.05)", label: "New York AM", labelColor: "rgba(120,220,160,0.85)" },
  "New York PM": { fill: "rgba(200,100,220,0.04)", label: "New York PM", labelColor: "rgba(210,130,225,0.85)" },
};

function getSessionName(unixSec: number): string | null {
  const h = new Date(unixSec * 1000).getUTCHours();
  if (h >= 0  && h < 6)  return "Asian";
  if (h >= 6  && h < 12) return "London";
  if (h >= 12 && h < 17) return "New York AM";
  if (h >= 17 && h < 20) return "New York PM";
  return null;
}

function buildSessionBlocks(candles: SmcReport["candles"]) {
  const blocks: Array<{ name: string; start: number; end: number }> = [];
  let cur: (typeof blocks)[0] | null = null;
  for (const c of candles) {
    const name = getSessionName(c.time);
    if (!name) { cur = null; continue; }
    if (cur && cur.name === name) { cur.end = c.time; }
    else { cur = { name, start: c.time, end: c.time }; blocks.push(cur); }
  }
  return blocks;
}

// ── Price format ───────────────────────────────────────────────────────────────

function fmtPrice(p: number, market: Market): string {
  if (market === "forex") return p.toFixed(5);
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1)     return p.toFixed(4);
  return p.toFixed(6);
}

function priceDecimals(price: number, market: Market): number {
  if (market === "forex") return 5;
  if (price >= 1000) return 2;
  if (price >= 1)    return 4;
  return 6;
}

// ── Overlay canvas drawing ─────────────────────────────────────────────────────

function drawOverlay(
  canvas: HTMLCanvasElement,
  chart: IChartApi,
  series: CandleSeries,
  rep: SmcReport,
  market: Market,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.width  / dpr;
  const H   = canvas.height / dpr;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  const ts  = chart.timeScale();
  const xOf = (t: number): number | null => ts.timeToCoordinate(t as never);
  const yOf = (p: number): number | null => series.priceToCoordinate(p);

  // ── Session bands ────────────────────────────────────────────────────────────
  const sessions = buildSessionBlocks(rep.candles);
  let lastLabel: string | null = null;
  for (const s of sessions) {
    const cfg = SESSION_CONFIG[s.name];
    if (!cfg) continue;
    const x1 = xOf(s.start);
    const x2 = xOf(s.end);
    if (x1 === null || x2 === null) continue;
    const rx1 = Math.max(0, x1);
    const rx2 = Math.min(W, x2 + 24);
    if (rx2 <= rx1) continue;
    ctx.fillStyle = cfg.fill;
    ctx.fillRect(rx1, 0, rx2 - rx1, H);
    if (s.name !== lastLabel) {
      ctx.fillStyle = cfg.labelColor;
      ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(s.name, rx1 + 4, 14);
      lastLabel = s.name;
    }
  }

  // ── FVG rectangles ───────────────────────────────────────────────────────────
  for (const fvg of rep.fvg.filter(g => g.fillFraction < 0.5)) {
    const x1 = xOf(fvg.time);
    if (x1 === null) continue;
    const y1 = yOf(fvg.top);
    const y2 = yOf(fvg.bottom);
    if (y1 === null || y2 === null) continue;
    const isBull = fvg.type === "bullish";
    const top  = Math.min(y1, y2);
    const boxH = Math.abs(y2 - y1);
    if (boxH < 1) continue;

    ctx.fillStyle = isBull ? "rgba(66,153,225,0.11)" : "rgba(237,100,166,0.11)";
    ctx.fillRect(x1, top, W - x1, boxH);
    ctx.strokeStyle = isBull ? "rgba(66,153,225,0.45)" : "rgba(237,100,166,0.45)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x1, top, W - x1, boxH);
    ctx.setLineDash([]);
    ctx.fillStyle = isBull ? "rgba(66,153,225,0.9)" : "rgba(237,100,166,0.9)";
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    if (boxH > 9) ctx.fillText("FVG", x1 + 3, top + 10);
    if (fvg.isInversion) {
      ctx.fillStyle = "rgba(236,201,75,0.7)";
      ctx.font = "8px monospace";
      ctx.fillText("INV", x1 + 3, top + boxH - 3);
    }
  }

  // ── Order Block rectangles ───────────────────────────────────────────────────
  for (const ob of rep.orderBlocks.filter(o => o.valid && !o.isMitigated)) {
    const x1 = xOf(ob.time);
    if (x1 === null) continue;
    const y1 = yOf(Math.max(ob.proximal, ob.distal));
    const y2 = yOf(Math.min(ob.proximal, ob.distal));
    if (y1 === null || y2 === null) continue;
    const isBull = ob.type === "bullish";
    const top  = Math.min(y1, y2);
    const boxH = Math.abs(y2 - y1);
    if (boxH < 1) continue;

    ctx.fillStyle = isBull ? "rgba(38,166,154,0.14)" : "rgba(239,83,80,0.14)";
    ctx.fillRect(x1, top, W - x1, boxH);
    ctx.strokeStyle = isBull ? "rgba(38,166,154,0.6)" : "rgba(239,83,80,0.6)";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([]);
    ctx.strokeRect(x1, top, W - x1, boxH);

    // KZO proximal dotted line
    const yProx = yOf(ob.proximal);
    if (yProx !== null) {
      ctx.strokeStyle = isBull ? "rgba(38,166,154,0.85)" : "rgba(239,83,80,0.85)";
      ctx.lineWidth = 0.9;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, yProx);
      ctx.lineTo(W, yProx);
      ctx.stroke();
      ctx.setLineDash([]);
      const decs  = priceDecimals(ob.proximal, market);
      const label = `KZO(${ob.proximal.toFixed(decs)})`;
      ctx.fillStyle = isBull ? "rgba(38,166,154,0.9)" : "rgba(239,83,80,0.9)";
      ctx.font = "8.5px 'JetBrains Mono', monospace";
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, W - tw - 4, yProx - 2.5);
    }

    // "OB" label + confidence
    if (boxH > 12) {
      ctx.fillStyle = isBull ? "rgba(38,166,154,0.95)" : "rgba(239,83,80,0.95)";
      ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText("OB", x1 + 4, top + 12);
      if (ob.confidence != null) {
        const confText = `${Math.round(ob.confidence * 100)}%`;
        ctx.font = "8px monospace";
        ctx.fillStyle = isBull ? "rgba(38,166,154,0.7)" : "rgba(239,83,80,0.7)";
        const cw = ctx.measureText(confText).width;
        ctx.fillText(confText, W - cw - 5, top + 12);
      }
    }
  }

  // ── BOS/CHoCH horizontal dashed lines ────────────────────────────────────────
  for (const b of rep.structure.breaks.slice(-8)) {
    const xB = xOf(b.time);
    if (xB === null) continue;
    const yB = yOf(b.price);
    if (yB === null) continue;
    const isBOS = b.type === "BOS";
    ctx.strokeStyle = isBOS ? "rgba(66,153,225,0.35)" : "rgba(236,201,75,0.35)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.max(0, xB), yB);
    ctx.lineTo(W, yB);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!isBOS) {
      ctx.fillStyle = "rgba(236,201,75,0.85)";
      ctx.font = "9px monospace";
      const offset = b.direction === "bullish" ? 11 : -3;
      ctx.fillText("CHoCH", Math.max(0, xB) + 2, yB + offset);
    }
  }

  ctx.restore();
}

// ── ChartView component ────────────────────────────────────────────────────────

interface Props {
  reports: Array<{ tf: string; report: SmcReport }>;
  market: Market;
  initialTf?: string;
  onClose: () => void;
}

const TF_LABEL: Record<string, string> = {
  "1m": "M1", "5m": "M5", "15m": "M15",
  "1h": "H1", "4h": "H4", "1d": "D1", "1w": "W1",
};

export function ChartView({ reports, market, initialTf, onClose }: Props) {
  const [activeTf, setActiveTf] = useState<string>(
    initialTf ?? reports[0]?.tf ?? "4h",
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<CandleSeries | null>(null);
  const reportRef    = useRef<SmcReport | null>(null);

  const activeReport = reports.find(r => r.tf === activeTf)?.report ?? null;
  reportRef.current = activeReport;

  const redraw = useCallback(() => {
    if (!canvasRef.current || !chartRef.current || !seriesRef.current || !reportRef.current) return;
    drawOverlay(canvasRef.current, chartRef.current, seriesRef.current, reportRef.current, market);
  }, [market]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    const rep       = reportRef.current;
    if (!container || !canvas || !rep) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = container.clientWidth;
    const H   = container.clientHeight;

    canvas.width        = W * dpr;
    canvas.height       = H * dpr;
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;

    // ── Create chart ────────────────────────────────────────────────────────
    const chart = createChart(container, {
      width:  W,
      height: H,
      layout: {
        background: { type: ColorType.Solid, color: "#0d0d0d" },
        textColor:  "#888888",
        fontSize:   10,
      },
      grid: {
        vertLines: { color: "#191919" },
        horzLines: { color: "#191919" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#555", labelBackgroundColor: "#1f1f1f" },
        horzLine: { color: "#555", labelBackgroundColor: "#1f1f1f" },
      },
      rightPriceScale: { borderColor: "#2a2a2a", textColor: "#777" },
      timeScale: {
        borderColor: "#2a2a2a",
        textColor: "#777",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale:  true,
    });

    chartRef.current = chart;

    // ── Candlestick series (v5 API) ─────────────────────────────────────────
    const series = chart.addSeries(CandlestickSeries, {
      upColor:       "#26a69a",
      downColor:     "#ef5350",
      borderVisible: false,
      wickUpColor:   "#26a69a",
      wickDownColor: "#ef5350",
    });
    seriesRef.current = series;

    // Candle data
    series.setData(
      [...rep.candles]
        .sort((a, b) => a.time - b.time)
        .map(c => ({ time: c.time as never, open: c.open, high: c.high, low: c.low, close: c.close })),
    );

    // ── Price lines ─────────────────────────────────────────────────────────
    const bslPools = rep.liquidity.pools
      .filter(p => p.type === "BSL" && !p.wasSwept && p.price > rep.currentPrice)
      .sort((a, b) => a.price - b.price);

    bslPools.forEach((p, i) => {
      series.createPriceLine({
        price:            p.price,
        color:            i === 0 ? "rgba(38,166,154,0.9)" : "rgba(38,166,154,0.3)",
        lineWidth:        1,
        lineStyle:        i === 0 ? LineStyle.Dashed : LineStyle.Dotted,
        axisLabelVisible: i === 0,
        title:            i === 0 ? `BSL  ${p.touches}×` : "",
      });
    });

    const sslPools = rep.liquidity.pools
      .filter(p => p.type === "SSL" && !p.wasSwept && p.price < rep.currentPrice)
      .sort((a, b) => b.price - a.price);

    sslPools.forEach((p, i) => {
      series.createPriceLine({
        price:            p.price,
        color:            i === 0 ? "rgba(239,83,80,0.9)" : "rgba(239,83,80,0.3)",
        lineWidth:        1,
        lineStyle:        i === 0 ? LineStyle.Dashed : LineStyle.Dotted,
        axisLabelVisible: i === 0,
        title:            i === 0 ? `SSL  ${p.touches}×` : "",
      });
    });

    series.createPriceLine({
      price: rep.pdArray.equilibrium,
      color: "rgba(120,120,200,0.35)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: "EQ",
    });

    // ── Markers (v5 API: createSeriesMarkers) ───────────────────────────────
    const pivotMarkers = rep.structure.pivots
      .filter(p => p.confirmed)
      .slice(-10)
      .map(p => ({
        time:     p.time as never,
        position: (p.type === "HH" || p.type === "LH" ? "aboveBar" : "belowBar") as "aboveBar" | "belowBar",
        color:    (p.type === "HH" || p.type === "HL") ? "rgba(38,166,154,0.55)" : "rgba(239,83,80,0.55)",
        shape:    "circle" as const,
        text:     p.type,
        size:     0.4,
      }));

    const breakMarkers = rep.structure.breaks
      .slice(-8)
      .map(b => ({
        time:     b.time as never,
        position: (b.direction === "bullish" ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
        color:    b.type === "BOS" ? "#4299e1" : "#ecc94b",
        shape:    (b.direction === "bullish" ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
        text:     b.type,
        size:     0.7,
      }));

    if (rep.smt?.detected && rep.smt.time) {
      breakMarkers.push({
        time:     rep.smt.time as never,
        position: (rep.smt.type === "bullish_smt" ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
        color:    "#a855f7",
        shape:    (rep.smt.type === "bullish_smt" ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
        text:     "SMT",
        size:     0.8,
      });
    }

    const allMarkers = [...pivotMarkers, ...breakMarkers]
      .sort((a, b) => (a.time as number) - (b.time as number));

    // v5: use createSeriesMarkers() instead of series.setMarkers()
    createSeriesMarkers(series, allMarkers);

    // ── Subscribe to redraw canvas on scroll/zoom ────────────────────────────
    chart.timeScale().subscribeVisibleTimeRangeChange(() => redraw());
    setTimeout(redraw, 80);

    // ── Resize observer ─────────────────────────────────────────────────────
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        chart.resize(width, height);
        canvas.width        = width  * dpr;
        canvas.height       = height * dpr;
        canvas.style.width  = `${width}px`;
        canvas.style.height = `${height}px`;
        redraw();
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport, market, redraw]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!activeReport) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground text-sm">No data for {activeTf}</p>
          <button onClick={onClose} className="text-xs text-primary underline">Close</button>
        </div>
      </div>
    );
  }

  const bias = activeReport.structure.bias;
  const biasColor =
    bias === "bullish" ? "text-[hsl(var(--bullish))] border-[hsl(var(--bullish))]/30 bg-[hsl(var(--bullish))]/10" :
    bias === "bearish" ? "text-destructive border-destructive/30 bg-destructive/10" :
    "text-muted-foreground border-border bg-muted";

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0d0d] flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#1f1f1f] bg-[#111]/95 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">{activeReport.symbol}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-bold uppercase border ${biasColor}`}>
            {bias}
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {fmtPrice(activeReport.currentPrice, market)}
          </span>
        </div>

        {/* TF selector */}
        <div className="flex rounded-sm overflow-hidden border border-[#2a2a2a] ml-2">
          {reports.map(({ tf }) => (
            <button
              key={tf}
              onClick={() => setActiveTf(tf)}
              className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                activeTf === tf
                  ? "bg-primary text-primary-foreground"
                  : "bg-[#181818] text-[#666] hover:text-[#aaa]"
              }`}
            >
              {TF_LABEL[tf] ?? tf.toUpperCase()}
            </button>
          ))}
        </div>

        {activeReport.narrative && (
          <span className="text-[10px] text-[#555] hidden lg:block flex-1 truncate">
            {activeReport.narrative}
          </span>
        )}
        {activeReport.sessionState && (
          <span className="text-[10px] text-primary/70 hidden md:block whitespace-nowrap">
            {activeReport.sessionState}
          </span>
        )}

        <button onClick={onClose} className="ml-auto p-1.5 hover:bg-[#1f1f1f] rounded-sm transition-colors">
          <X className="w-4 h-4 text-[#555]" />
        </button>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-b border-[#191919] bg-[#0f0f0f] shrink-0 overflow-x-auto">
        {[
          { color: "rgba(38,166,154,0.35)", stroke: "rgba(38,166,154,0.65)", label: "Bull OB" },
          { color: "rgba(239,83,80,0.35)",  stroke: "rgba(239,83,80,0.65)",  label: "Bear OB" },
          { color: "rgba(66,153,225,0.15)", stroke: "rgba(66,153,225,0.45)", label: "FVG" },
        ].map(({ color, stroke, label }) => (
          <div key={label} className="flex items-center gap-1.5 shrink-0">
            <div className="w-3 h-3 rounded-sm" style={{ background: color, border: `1px solid ${stroke}` }} />
            <span className="text-[10px] text-[#555]">{label}</span>
          </div>
        ))}
        {[
          { color: "rgba(38,166,154,0.8)", label: "BSL ─ ─" },
          { color: "rgba(239,83,80,0.8)",  label: "SSL ─ ─" },
          { color: "#4299e1",              label: "BOS ▲" },
          { color: "#ecc94b",              label: "CHoCH ◆" },
          { color: "#a855f7",              label: "SMT ⚡" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] font-bold" style={{ color }}>{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-4 border-t border-dashed border-[rgba(120,120,200,0.4)]" />
          <span className="text-[10px] text-[#444]">EQ</span>
        </div>
      </div>

      {/* ── Chart area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
      </div>
    </div>
  );
}
