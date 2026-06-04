import { useState, useMemo } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertCircle, ChevronUp, ChevronDown, Activity, Target, Layers, BarChart2, Zap } from "lucide-react";
import {
  useListSymbols,
  useAnalyzeCrypto,
  useAnalyzeForex,
  getAnalyzeCryptoQueryKey,
  getAnalyzeForexQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";

type Market = "crypto" | "forex";
type Timeframe = "1h" | "4h" | "1d";

const TIMEFRAMES: Timeframe[] = ["1h", "4h", "1d"];

function fmtPrice(p: number, market: Market): string {
  if (market === "forex") return p.toFixed(5);
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function BiasIcon({ bias }: { bias: string }) {
  if (bias === "bullish") return <TrendingUp className="w-3.5 h-3.5 text-[hsl(var(--bullish))]" />;
  if (bias === "bearish") return <TrendingDown className="w-3.5 h-3.5 text-destructive" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

function BiasLabel({ bias, className = "" }: { bias: string; className?: string }) {
  const color =
    bias === "bullish" ? "text-[hsl(var(--bullish))]" :
    bias === "bearish" ? "text-destructive" :
    "text-muted-foreground";
  return <span className={`font-semibold uppercase text-xs tracking-wider ${color} ${className}`}>{bias}</span>;
}

function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(value * 100);
  const color = pct > 65 ? "bg-[hsl(var(--bullish))]" : pct > 40 ? "bg-primary" : "bg-destructive";
  return (
    <div className="flex items-center gap-2 w-full">
      {label && <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>}
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

function ScoreBar({ value, max = 5 }: { value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{value.toFixed(2)}</span>
    </div>
  );
}

function Panel({ title, icon: Icon, children, className = "" }: { title: string; icon: React.ElementType; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-border rounded-sm ${className}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-xs text-muted-foreground italic">{message}</p>;
}

export default function Dashboard() {
  const [market, setMarket] = useState<Market>("crypto");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("4h");
  const [correlatedSymbol, setCorrelatedSymbol] = useState("ETHUSDT");
  const [smtEnabled, setSmtEnabled] = useState(true);

  const { data: symbols } = useListSymbols();

  const symbolOptions = useMemo(
    () => (market === "crypto" ? symbols?.crypto ?? [] : symbols?.forex ?? []),
    [market, symbols],
  );

  function handleMarketSwitch(m: Market) {
    setMarket(m);
    if (m === "crypto") {
      setSymbol("BTCUSDT");
      setCorrelatedSymbol("ETHUSDT");
    } else {
      setSymbol("EURUSD=X");
      setCorrelatedSymbol("GBPUSD=X");
    }
  }

  const cryptoParams = {
    symbol,
    timeframe,
    correlatedSymbol: smtEnabled ? correlatedSymbol : undefined,
  };
  const forexParams = {
    symbol,
    timeframe,
    correlatedSymbol: smtEnabled ? correlatedSymbol : undefined,
  };

  const {
    data: cryptoReport,
    isLoading: cryptoLoading,
    error: cryptoError,
    refetch: refetchCrypto,
  } = useAnalyzeCrypto(cryptoParams, {
    query: {
      enabled: market === "crypto" && !!symbol,
      queryKey: getAnalyzeCryptoQueryKey(cryptoParams),
      staleTime: 60_000,
    },
  });

  const {
    data: forexReport,
    isLoading: forexLoading,
    error: forexError,
    refetch: refetchForex,
  } = useAnalyzeForex(forexParams, {
    query: {
      enabled: market === "forex" && !!symbol,
      queryKey: getAnalyzeForexQueryKey(forexParams),
      staleTime: 60_000,
    },
  });

  const report = market === "crypto" ? cryptoReport : forexReport;
  const isLoading = market === "crypto" ? cryptoLoading : forexLoading;
  const error = market === "crypto" ? cryptoError : forexError;
  const refetch = market === "crypto" ? refetchCrypto : refetchForex;

  const corrOptions = useMemo(
    () => symbolOptions.filter((s) => s.symbol !== symbol),
    [symbolOptions, symbol],
  );

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 mr-2">
            <Zap className="w-4 h-4 text-primary" />
            <span className="font-bold text-sm text-primary tracking-tight">LIQUIDITY HUNTER</span>
          </div>

          {/* Market toggle */}
          <div className="flex rounded-sm overflow-hidden border border-border" data-testid="market-toggle">
            {(["crypto", "forex"] as Market[]).map((m) => (
              <button
                key={m}
                onClick={() => handleMarketSwitch(m)}
                className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  market === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`market-btn-${m}`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Symbol selector */}
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-muted border border-border text-foreground text-xs rounded-sm px-2 py-1 font-semibold"
            data-testid="symbol-select"
          >
            {symbolOptions.map((s) => (
              <option key={s.symbol} value={s.symbol}>{s.label}</option>
            ))}
          </select>

          {/* Timeframe */}
          <div className="flex rounded-sm overflow-hidden border border-border" data-testid="timeframe-toggle">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 text-xs font-semibold uppercase transition-colors ${
                  timeframe === tf ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tf-btn-${tf}`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* SMT correlated */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSmtEnabled(!smtEnabled)}
              className={`text-xs px-2 py-1 rounded-sm border transition-colors ${
                smtEnabled ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"
              }`}
              data-testid="smt-toggle"
            >
              SMT
            </button>
            {smtEnabled && (
              <select
                value={correlatedSymbol}
                onChange={(e) => setCorrelatedSymbol(e.target.value)}
                className="bg-muted border border-border text-foreground text-xs rounded-sm px-2 py-1"
                data-testid="correlated-select"
              >
                {corrOptions.map((s) => (
                  <option key={s.symbol} value={s.symbol}>{s.label}</option>
                ))}
              </select>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {report && (
              <div className="text-right">
                <div className="text-base font-bold text-foreground" data-testid="current-price">
                  {fmtPrice(report.currentPrice, market)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {report.symbol} · {report.timeframe} · {new Date(report.generatedAt * 1000).toLocaleTimeString()}
                </div>
              </div>
            )}
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
              data-testid="refresh-btn"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
              REFRESH
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-screen-2xl mx-auto px-4 py-4">
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-40 bg-card border border-border rounded-sm animate-pulse" />
            ))}
          </div>
        )}

        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <div className="text-sm text-muted-foreground text-center max-w-md">
              Failed to load analysis for <strong>{symbol}</strong>. The data provider may be temporarily unavailable.
            </div>
            <button
              onClick={() => refetch()}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-sm text-xs font-semibold"
            >
              Try Again
            </button>
          </div>
        )}

        {report && !isLoading && (
          <div className="space-y-3">
            {/* Top row — structure + daily bias + draw targets */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Structure */}
              <Panel title="Market Structure" icon={Activity}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BiasIcon bias={report.structure.trend} />
                      <span className="text-sm font-bold">{report.structure.trend.toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Bias:</span>
                      <BiasLabel bias={report.structure.bias} />
                    </div>
                  </div>
                  <ConfidenceBar value={report.structure.confidence} label="Confidence" />

                  {report.structure.breaks.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Recent Breaks</p>
                      {report.structure.breaks.slice(-4).reverse().map((b, i) => (
                        <div key={i} className="flex items-center justify-between text-xs" data-testid={`structure-break-${i}`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold ${
                              b.type === "BOS" ? "bg-primary/20 text-primary" : "bg-yellow-500/20 text-yellow-400"
                            }`}>{b.type}</span>
                            <BiasLabel bias={b.direction} />
                          </div>
                          <span className="text-muted-foreground font-mono">{fmtPrice(b.price, market)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {report.structure.pivots.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Recent Pivots</p>
                      <div className="flex flex-wrap gap-1">
                        {report.structure.pivots.slice(-8).map((p, i) => (
                          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-sm font-bold ${
                            p.type === "HH" ? "bg-[hsl(var(--bullish))]/20 text-[hsl(var(--bullish))]" :
                            p.type === "HL" ? "bg-[hsl(var(--bullish))]/10 text-[hsl(var(--bullish))]/70" :
                            p.type === "LH" ? "bg-destructive/10 text-destructive/70" :
                            "bg-destructive/20 text-destructive"
                          }`}>{p.type}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Panel>

              {/* Daily Bias */}
              <Panel title="Daily Bias" icon={TrendingUp}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BiasIcon bias={report.dailyBias.bias} />
                      <span className="text-lg font-bold">
                        <BiasLabel bias={report.dailyBias.bias} className="text-base" />
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Consecutive</div>
                      <div className="text-sm font-bold">{report.dailyBias.consecutiveDays}d</div>
                    </div>
                  </div>
                  <ConfidenceBar value={report.dailyBias.strength} label="Strength" />
                  {report.dailyBias.referencedSwing && (
                    <div className="bg-muted/50 rounded-sm px-2 py-1.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Swing Reference</p>
                      <p className="text-xs font-mono">{report.dailyBias.referencedSwing}</p>
                    </div>
                  )}
                </div>
              </Panel>

              {/* Draw Targets */}
              <Panel title="Draw on Liquidity" icon={Target}>
                <div className="space-y-2">
                  {report.draw.length === 0 && <EmptyState message="No high-probability targets identified" />}
                  {report.draw.map((d, i) => (
                    <div key={i} className="flex items-center justify-between gap-2" data-testid={`draw-target-${i}`}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        {d.direction === "long"
                          ? <ChevronUp className="w-3 h-3 text-[hsl(var(--bullish))] shrink-0" />
                          : <ChevronDown className="w-3 h-3 text-destructive shrink-0" />}
                        <span className="text-xs truncate" title={d.label}>{d.label}</span>
                      </div>
                      <ScoreBar value={d.score} max={3} />
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* Second row — liquidity + OBs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Liquidity */}
              <Panel title="Liquidity Pools" icon={Layers}>
                <div className="space-y-2">
                  {/* Nearest highlight */}
                  {(report.liquidity.nearestBSL || report.liquidity.nearestSSL) && (
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {report.liquidity.nearestBSL && (
                        <div className="bg-[hsl(var(--bullish))]/10 border border-[hsl(var(--bullish))]/20 rounded-sm p-2" data-testid="nearest-bsl">
                          <p className="text-[10px] text-[hsl(var(--bullish))] uppercase tracking-wider font-semibold">Nearest BSL</p>
                          <p className="text-sm font-bold font-mono">{fmtPrice(report.liquidity.nearestBSL.price, market)}</p>
                          <p className="text-[10px] text-muted-foreground">Score: {report.liquidity.nearestBSL.score.toFixed(2)}</p>
                        </div>
                      )}
                      {report.liquidity.nearestSSL && (
                        <div className="bg-destructive/10 border border-destructive/20 rounded-sm p-2" data-testid="nearest-ssl">
                          <p className="text-[10px] text-destructive uppercase tracking-wider font-semibold">Nearest SSL</p>
                          <p className="text-sm font-bold font-mono">{fmtPrice(report.liquidity.nearestSSL.price, market)}</p>
                          <p className="text-[10px] text-muted-foreground">Score: {report.liquidity.nearestSSL.score.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {report.liquidity.pools.length === 0 && <EmptyState message="No liquidity pools detected" />}
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {report.liquidity.pools.map((pool, i) => (
                      <div key={i} className={`flex items-center gap-2 text-xs py-1 border-b border-border/50 last:border-0 ${pool.wasSwept ? "opacity-50" : ""}`} data-testid={`pool-${i}`}>
                        <span className={`text-[10px] font-bold w-8 shrink-0 ${pool.type === "BSL" || pool.type === "EQH" ? "text-[hsl(var(--bullish))]" : "text-destructive"}`}>{pool.type}</span>
                        <span className="font-mono flex-1">{fmtPrice(pool.price, market)}</span>
                        <span className="text-muted-foreground">{pool.touches}x</span>
                        {pool.session && <span className="text-[10px] text-muted-foreground">{pool.session}</span>}
                        {pool.wasSwept && <span className="text-[10px] text-yellow-400 font-semibold">SWEPT</span>}
                        <ScoreBar value={pool.score} max={5} />
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>

              {/* Order Blocks */}
              <Panel title="Order Blocks" icon={BarChart2}>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {report.orderBlocks.length === 0 && <EmptyState message="No order blocks detected" />}
                  {report.orderBlocks.map((ob, i) => (
                    <div key={i} className={`flex items-center gap-2 text-xs py-1.5 border-b border-border/50 last:border-0 ${ob.isMitigated && !ob.isBreaker ? "opacity-40" : ""}`} data-testid={`ob-${i}`}>
                      <span className={`text-[10px] font-bold shrink-0 ${ob.type === "bullish" ? "text-[hsl(var(--bullish))]" : "text-destructive"}`}>
                        {ob.type === "bullish" ? "BULL" : "BEAR"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono">{fmtPrice(ob.proximal, market)} → {fmtPrice(ob.distal, market)}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {ob.hasFvg && <span className="text-[10px] bg-primary/20 text-primary px-1 rounded-sm">FVG</span>}
                        {ob.isBreaker && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1 rounded-sm">BRK</span>}
                        {ob.isMitigated && !ob.isBreaker && <span className="text-[10px] bg-muted text-muted-foreground px-1 rounded-sm">MIT</span>}
                        {ob.valid && !ob.isMitigated && <span className="text-[10px] bg-[hsl(var(--bullish))]/20 text-[hsl(var(--bullish))] px-1 rounded-sm">LIVE</span>}
                      </div>
                      <ScoreBar value={ob.strength} max={3} />
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* Third row — FVG + PD Array + SMT */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* FVG */}
              <Panel title="Fair Value Gaps" icon={Activity}>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {report.fvg.length === 0 && <EmptyState message="No fair value gaps detected" />}
                  {report.fvg.slice(-10).reverse().map((gap, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/50 last:border-0" data-testid={`fvg-${i}`}>
                      <span className={`text-[10px] font-bold shrink-0 ${gap.type === "bullish" ? "text-[hsl(var(--bullish))]" : "text-destructive"}`}>
                        {gap.type === "bullish" ? "BULL" : "BEAR"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[10px]">{fmtPrice(gap.bottom, market)} – {fmtPrice(gap.top, market)}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${gap.fillFraction >= 1 ? "bg-muted-foreground" : "bg-primary"}`}
                              style={{ width: `${Math.round(gap.fillFraction * 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground">{Math.round(gap.fillFraction * 100)}%</span>
                        </div>
                      </div>
                      {gap.isInversion && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1 rounded-sm shrink-0">INV</span>}
                    </div>
                  ))}
                </div>
              </Panel>

              {/* PD Array */}
              <Panel title="PD Array" icon={Layers}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Current Position</span>
                    <span className={`text-xs font-bold uppercase ${
                      report.pdArray.currentBias === "premium" ? "text-destructive" :
                      report.pdArray.currentBias === "discount" ? "text-[hsl(var(--bullish))]" :
                      "text-primary"
                    }`}>{report.pdArray.currentBias}</span>
                  </div>

                  <div className="bg-muted/40 rounded-sm p-2 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Range ({report.pdArray.dealingRange.timeframe})</span>
                      <span className="font-mono">{fmtPrice(report.pdArray.dealingRange.low, market)} – {fmtPrice(report.pdArray.dealingRange.high, market)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Equilibrium</span>
                      <span className="font-mono text-primary">{fmtPrice(report.pdArray.equilibrium, market)}</span>
                    </div>
                  </div>

                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {report.pdArray.zones.map((zone, i) => (
                      <div key={i} className="flex items-center justify-between text-xs" data-testid={`pd-zone-${i}`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            zone.type === "premium" ? "bg-destructive" :
                            zone.type === "discount" ? "bg-[hsl(var(--bullish))]" : "bg-primary"
                          }`} />
                          <span className="text-muted-foreground truncate text-[10px]">{zone.label}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground ml-1">{zone.timeframe.split("(")[1]?.replace(")", "") ?? zone.timeframe}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>

              {/* SMT */}
              <Panel title="SMT Divergence" icon={Zap}>
                <div className="space-y-3">
                  <div className={`flex items-center gap-2 p-2 rounded-sm border ${
                    report.smt.detected
                      ? report.smt.type === "bearish_smt" ? "border-destructive/30 bg-destructive/10" : "border-[hsl(var(--bullish))]/30 bg-[hsl(var(--bullish))]/10"
                      : "border-border bg-muted/30"
                  }`} data-testid="smt-status">
                    {report.smt.detected
                      ? <Zap className={`w-4 h-4 ${report.smt.type === "bearish_smt" ? "text-destructive" : "text-[hsl(var(--bullish))]"}`} />
                      : <Minus className="w-4 h-4 text-muted-foreground" />
                    }
                    <div>
                      <p className={`text-xs font-bold uppercase ${
                        report.smt.detected
                          ? report.smt.type === "bearish_smt" ? "text-destructive" : "text-[hsl(var(--bullish))]"
                          : "text-muted-foreground"
                      }`}>
                        {report.smt.detected ? report.smt.type?.replace("_", " ") : "No Divergence"}
                      </p>
                      {report.smt.detected && report.smt.time && (
                        <p className="text-[10px] text-muted-foreground">{fmtTime(report.smt.time)}</p>
                      )}
                    </div>
                  </div>

                  {report.smt.detected && (
                    <ConfidenceBar value={report.smt.confidence} label="Confidence" />
                  )}

                  <div className="space-y-1 text-xs">
                    {report.smt.primarySymbol && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Primary</span>
                        <span className="font-mono">{report.smt.primarySymbol}</span>
                      </div>
                    )}
                    {report.smt.correlatedSymbol && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Correlated</span>
                        <span className="font-mono">{report.smt.correlatedSymbol}</span>
                      </div>
                    )}
                    {!smtEnabled && (
                      <p className="text-[10px] text-muted-foreground italic">Enable SMT toggle to activate divergence analysis</p>
                    )}
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
