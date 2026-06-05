import { useMemo, useState } from "react";
import { Activity, AlertCircle, ChevronDown, ChevronUp, Minus, TrendingDown, TrendingUp, Zap } from "lucide-react";
import {
  getAnalyzeCryptoQueryKey,
  getAnalyzeForexQueryKey,
  type SmcReport,
  useAnalyzeCrypto,
  useAnalyzeForex,
  useListSymbols,
} from "@workspace/api-client-react";
import { ConfluenceCard } from "@/components/ConfluenceCard";
import { IntelligenceSheet } from "@/components/IntelligenceSheet";

type Market = "crypto" | "forex";

const ALL_TFS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;
type Tf = (typeof ALL_TFS)[number];

/* Higher number = higher timeframe */
const TF_WEIGHT: Record<Tf, number> = {
  "1m": 1, "5m": 2, "15m": 3, "1h": 4, "4h": 5, "1d": 6, "1w": 7,
};

const TF_ROLE_LABELS = ["BIAS SETTER", "CONFIRMATION", "ENTRY TRIGGER"] as const;

const TRADING_STYLES: Array<{ label: string; desc: string; timeframes: Tf[] }> = [
  { label: "Scalp",    desc: "1m · 5m · 15m",  timeframes: ["1m",  "5m",  "15m"] },
  { label: "Intraday", desc: "15m · 1h · 4h",  timeframes: ["15m", "1h",  "4h"]  },
  { label: "Swing",    desc: "4h · 1D · 1W",   timeframes: ["4h",  "1d",  "1w"]  },
  { label: "All",      desc: "Full TF stack",  timeframes: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] },
];

function fmtPrice(p: number, market: Market): string {
  if (market === "forex") return p.toFixed(5);
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function getConfidence(r: SmcReport): number {
  return Math.round(((r.structure.confidence + r.dailyBias.strength) / 2) * 100);
}

function getBias(r: SmcReport): "bullish" | "bearish" | "neutral" {
  const sb = r.structure.bias;
  const db = r.dailyBias.bias;
  if (sb !== "neutral") return sb as "bullish" | "bearish";
  if (db !== "neutral") return db as "bullish" | "bearish";
  return "neutral";
}

function BiasIcon({ bias, className = "" }: { bias: string; className?: string }) {
  if (bias === "bullish") return <TrendingUp className={`text-[hsl(var(--bullish))] ${className}`} />;
  if (bias === "bearish") return <TrendingDown className={`text-destructive ${className}`} />;
  return <Minus className={`text-muted-foreground ${className}`} />;
}

const TF_LABEL_MAP: Record<string, string> = {
  "1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4", "1d": "D1", "1w": "W1",
};
function TfLabel({ tf }: { tf: string }) {
  return <>{TF_LABEL_MAP[tf] ?? tf.toUpperCase()}</>;
}

/* ─── Role assignment ─── */
function getRoles(tfs: Tf[]): Record<Tf, string> {
  const sorted = [...tfs].sort((a, b) => TF_WEIGHT[b] - TF_WEIGHT[a]); // highest first
  const roles: Partial<Record<Tf, string>> = {};
  sorted.forEach((tf, i) => {
    if (i === 0) roles[tf] = "BIAS SETTER";
    else if (i === sorted.length - 1) roles[tf] = "ENTRY TRIGGER";
    else roles[tf] = "CONFIRMATION";
  });
  return roles as Record<Tf, string>;
}

/* ─── TF Agent Card ─── */
function TfAgentCard({
  tf, report, market, isLoading, error, onOpen,
  role, anchorBias, isAnchor,
}: {
  tf: Tf; report: SmcReport | undefined; market: Market;
  isLoading: boolean; error: unknown; onOpen: () => void;
  role?: string; anchorBias?: string; isAnchor?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="rounded-sm border border-border bg-card p-4 animate-pulse space-y-3 min-h-[180px]">
        <div className="flex items-center justify-between">
          <div className="h-4 w-10 bg-muted rounded-sm" />
          <div className="h-4 w-16 bg-muted rounded-sm" />
        </div>
        <div className="h-3 w-24 bg-muted rounded-sm" />
        <div className="h-7 w-3/4 bg-muted rounded-sm" />
        <div className="h-2 w-full bg-muted rounded-full" />
        <div className="h-3 w-2/3 bg-muted rounded-sm" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="rounded-sm border border-destructive/20 bg-destructive/5 p-4 flex items-start gap-2 min-h-[180px]">
        <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-bold"><TfLabel tf={tf} /></p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {tf === "1m" || tf === "5m"
              ? "Intraday data unavailable (market closed or provider limit)"
              : "Data unavailable"}
          </p>
        </div>
      </div>
    );
  }

  const bias    = getBias(report);
  const conf    = getConfidence(report);
  const topDraw = report.draw[0];
  const altDraw = report.draw[1];

  /* Alignment with anchor */
  const aligned = anchorBias && !isAnchor
    ? bias === anchorBias
    : null;

  const borderColor =
    bias === "bullish" ? "border-[hsl(var(--bullish))]/35" :
    bias === "bearish" ? "border-destructive/35" : "border-border";
  const bgGrad =
    bias === "bullish" ? "from-[hsl(var(--bullish))]/6 to-transparent" :
    bias === "bearish" ? "from-destructive/6 to-transparent" : "from-muted/15 to-transparent";
  const biasColor =
    bias === "bullish" ? "text-[hsl(var(--bullish))]" :
    bias === "bearish" ? "text-destructive" : "text-primary";
  const biasBg =
    bias === "bullish" ? "bg-[hsl(var(--bullish))]/15 border-[hsl(var(--bullish))]/20" :
    bias === "bearish" ? "bg-destructive/15 border-destructive/20" : "bg-muted border-border";
  const confBar =
    conf > 65 ? "bg-[hsl(var(--bullish))]" : conf > 40 ? "bg-primary" : "bg-destructive";

  return (
    <button
      onClick={onOpen}
      className={`rounded-sm border ${borderColor} bg-gradient-to-b ${bgGrad} p-4 text-left
                  hover:opacity-90 active:scale-[0.98] transition-all w-full space-y-2.5 group`}
    >
      {/* Row 1: TF label + role + bias */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-muted-foreground tracking-widest"><TfLabel tf={tf} /></span>
          <Activity className="w-3 h-3 text-primary/60" />
          {role && (
            <span className={`text-[9px] px-1 py-0.5 rounded-sm font-bold uppercase tracking-wider
              ${isAnchor
                ? "bg-primary/20 text-primary border border-primary/30"
                : "bg-muted text-muted-foreground border border-border/50"}`}>
              {role}
            </span>
          )}
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-bold uppercase border ${biasColor} ${biasBg}`}>
          {bias}
        </span>
      </div>

      {/* Row 2: Alignment badge */}
      {aligned !== null && (
        <div className={`flex items-center gap-1 text-[10px] font-semibold ${aligned ? "text-[hsl(var(--bullish))]" : "text-yellow-400"}`}>
          {aligned ? (
            <><span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--bullish))] shrink-0" />Aligned with {TF_LABEL_MAP[anchorBias ? tf : tf]} · {anchorBias?.toUpperCase()}</>
          ) : (
            <><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />⚠ Counter-trend — caution</>
          )}
        </div>
      )}
      {isAnchor && role && (
        <div className="text-[10px] text-primary/70 font-medium">
          Sets direction for lower TFs ↓
        </div>
      )}

      {/* Row 3: Draw target */}
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Next Draw on Liquidity</p>
        {topDraw ? (
          <div className="flex items-center gap-1">
            {topDraw.direction === "long"
              ? <ChevronUp  className={`w-5 h-5 ${biasColor} shrink-0`} />
              : <ChevronDown className={`w-5 h-5 ${biasColor} shrink-0`} />}
            <span className={`text-xl font-bold font-mono leading-none ${biasColor}`}>
              {fmtPrice(topDraw.price, market)}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No clear target</p>
        )}
      </div>

      {/* Row 4: Confidence */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Conf {conf}%</span>
          {report.smt.detected && <span className="text-primary font-semibold">SMT ⚡</span>}
        </div>
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${confBar} transition-all`} style={{ width: `${conf}%` }} />
        </div>
      </div>

      {altDraw && (
        <div className="border-t border-border/40 pt-2 flex items-center gap-1.5 text-[10px]">
          <span className="text-muted-foreground">Alt Target</span>
          <span className="font-mono text-muted-foreground">{fmtPrice(altDraw.price, market)}</span>
        </div>
      )}

      <p className="text-[10px] text-primary/50 group-hover:text-primary/80 transition-colors text-right">
        Tap for Intelligence Sheet →
      </p>
    </button>
  );
}

/* ─── Per-TF data hook — called unconditionally ─── */
function useTfData(market: Market, symbol: string, tf: Tf, corrSym: string | undefined, enabled: boolean) {
  const params = { symbol, timeframe: tf, correlatedSymbol: corrSym };
  const crypto = useAnalyzeCrypto(params, {
    query: {
      enabled: market === "crypto" && !!symbol && enabled,
      queryKey: getAnalyzeCryptoQueryKey(params),
      staleTime: 60_000,
    },
  });
  const forex = useAnalyzeForex(params, {
    query: {
      enabled: market === "forex" && !!symbol && enabled,
      queryKey: getAnalyzeForexQueryKey(params),
      staleTime: 60_000,
    },
  });
  return market === "crypto" ? crypto : forex;
}

/* ─── Dashboard ─── */
export default function Dashboard() {
  const [market,   setMarket]   = useState<Market>("crypto");
  const [symbol,   setSymbol]   = useState("BTCUSDT");
  const [corrSym,  setCorrSym]  = useState("ETHUSDT");
  const [smtOn,    setSmtOn]    = useState(true);
  const [styleIdx, setStyleIdx] = useState(1);
  const [sheet,    setSheet]    = useState<{ tf: Tf; report: SmcReport } | null>(null);

  const { data: symbols } = useListSymbols();

  const symbolOptions = useMemo(
    () => (market === "crypto" ? symbols?.crypto ?? [] : symbols?.forex ?? []),
    [market, symbols],
  );
  const corrOptions = useMemo(
    () => symbolOptions.filter(s => s.symbol !== symbol),
    [symbolOptions, symbol],
  );

  const activeStyle = TRADING_STYLES[styleIdx];
  const corrParam   = smtOn ? corrSym : undefined;

  function handleMarketSwitch(m: Market) {
    setMarket(m);
    setSheet(null);
    if (m === "crypto") { setSymbol("BTCUSDT");  setCorrSym("ETHUSDT");   }
    else                { setSymbol("EURUSD=X"); setCorrSym("GBPUSD=X"); }
  }

  /* ── All 7 hooks called unconditionally ── */
  const r1m  = useTfData(market, symbol, "1m",  corrParam, activeStyle.timeframes.includes("1m"));
  const r5m  = useTfData(market, symbol, "5m",  corrParam, activeStyle.timeframes.includes("5m"));
  const r15m = useTfData(market, symbol, "15m", corrParam, activeStyle.timeframes.includes("15m"));
  const r1h  = useTfData(market, symbol, "1h",  corrParam, activeStyle.timeframes.includes("1h"));
  const r4h  = useTfData(market, symbol, "4h",  corrParam, activeStyle.timeframes.includes("4h"));
  const r1d  = useTfData(market, symbol, "1d",  corrParam, activeStyle.timeframes.includes("1d"));
  const r1w  = useTfData(market, symbol, "1w",  corrParam, activeStyle.timeframes.includes("1w"));

  const tfMap: Record<Tf, typeof r1h> = {
    "1m": r1m, "5m": r5m, "15m": r15m, "1h": r1h, "4h": r4h, "1d": r1d, "1w": r1w,
  };

  /* ── Cascade computation ── */
  const cascade = useMemo(() => {
    const roles = getRoles(activeStyle.timeframes);

    // Anchor = highest TF with loaded data
    const sortedByWeight = [...activeStyle.timeframes].sort((a, b) => TF_WEIGHT[b] - TF_WEIGHT[a]);
    const anchorTf = sortedByWeight.find(tf => tfMap[tf].data) ?? sortedByWeight[0];
    const anchorReport = tfMap[anchorTf].data;
    const anchorBias = anchorReport ? getBias(anchorReport) : "neutral";

    return { roles, anchorTf, anchorBias };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r1m.data, r5m.data, r15m.data, r1h.data, r4h.data, r1d.data, r1w.data, activeStyle]);

  const confluenceReports = useMemo(() =>
    activeStyle.timeframes
      .map(tf => ({ tf, report: tfMap[tf].data }))
      .filter((x): x is { tf: Tf; report: SmcReport } => !!x.report),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [r1m.data, r5m.data, r15m.data, r1h.data, r4h.data, r1d.data, r1w.data, activeStyle],
  );

  const primaryReport = r4h.data ?? r1h.data ?? r1d.data ?? r15m.data;

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">

      {/* ─── Header ─── */}
      <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-screen-xl mx-auto px-4 py-2.5 flex flex-wrap items-center gap-2.5">

          <div className="flex items-center gap-2 mr-1">
            <Zap className="w-4 h-4 text-primary" />
            <span className="font-bold text-sm text-primary tracking-tight">SMC PULSE PREDICT</span>
          </div>

          {/* Market */}
          <div className="flex rounded-sm overflow-hidden border border-border">
            {(["crypto", "forex"] as Market[]).map(m => (
              <button key={m} onClick={() => handleMarketSwitch(m)}
                className={`px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors
                  ${market === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                {m}
              </button>
            ))}
          </div>

          {/* Symbol */}
          <select value={symbol} onChange={e => setSymbol(e.target.value)}
            className="bg-muted border border-border text-foreground text-xs rounded-sm px-2 py-1 font-semibold">
            {symbolOptions.map(s => <option key={s.symbol} value={s.symbol}>{s.label}</option>)}
          </select>

          {/* Trading Style */}
          <div className="flex rounded-sm overflow-hidden border border-border">
            {TRADING_STYLES.map((style, i) => (
              <button key={style.label} onClick={() => setStyleIdx(i)}
                className={`px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors
                  ${styleIdx === i ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                {style.label}
              </button>
            ))}
          </div>

          {/* SMT */}
          <div className="flex items-center gap-1.5">
            <button onClick={() => setSmtOn(!smtOn)}
              className={`text-xs px-2 py-1 rounded-sm border transition-colors
                ${smtOn ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}`}>
              SMT
            </button>
            {smtOn && (
              <select value={corrSym} onChange={e => setCorrSym(e.target.value)}
                className="bg-muted border border-border text-foreground text-xs rounded-sm px-2 py-1">
                {corrOptions.map(s => <option key={s.symbol} value={s.symbol}>{s.label}</option>)}
              </select>
            )}
          </div>

          {/* Price */}
          {primaryReport && (
            <div className="ml-auto text-right">
              <div className="text-base font-bold">{fmtPrice(primaryReport.currentPrice, market)}</div>
              <div className="text-[10px] text-muted-foreground">
                {symbol} · {new Date(primaryReport.generatedAt * 1000).toLocaleTimeString()}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ─── Main ─── */}
      <main className="max-w-screen-xl mx-auto px-4 py-5 space-y-5">

        {/* Confluence + cascade */}
        {confluenceReports.length > 0 && (
          <ConfluenceCard
            reports={confluenceReports}
            cascade={cascade}
            onSelect={tf => {
              const found = confluenceReports.find(r => r.tf === tf);
              if (found) setSheet({ tf: found.tf as Tf, report: found.report });
            }}
          />
        )}

        {/* Style label */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            {activeStyle.label} — Timeframe Agents
          </span>
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] text-muted-foreground">{activeStyle.desc}</span>
        </div>

        {/* TF Agent Cards */}
        <div className={`grid gap-4 ${
          activeStyle.timeframes.length <= 1 ? "grid-cols-1 max-w-sm" :
          activeStyle.timeframes.length === 2 ? "grid-cols-1 sm:grid-cols-2" :
          activeStyle.timeframes.length === 3 ? "grid-cols-1 sm:grid-cols-3" :
          "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        }`}>
          {activeStyle.timeframes.map(tf => {
            const q = tfMap[tf];
            const isAnchor = tf === cascade.anchorTf;
            return (
              <TfAgentCard
                key={tf}
                tf={tf}
                report={q.data}
                market={market}
                isLoading={q.isLoading}
                error={q.error}
                onOpen={() => q.data && setSheet({ tf, report: q.data })}
                role={cascade.roles[tf]}
                anchorBias={cascade.anchorBias}
                isAnchor={isAnchor}
              />
            );
          })}
        </div>

        {/* Session context footer */}
        {primaryReport && (
          <div className="border border-border/50 rounded-sm bg-muted/20 px-4 py-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-foreground">Daily Bias</span>
                <BiasIcon bias={primaryReport.dailyBias.bias} className="w-3.5 h-3.5" />
                <span className={
                  primaryReport.dailyBias.bias === "bullish" ? "text-[hsl(var(--bullish))]" :
                  primaryReport.dailyBias.bias === "bearish" ? "text-destructive" : "text-muted-foreground"
                }>{primaryReport.dailyBias.bias.toUpperCase()}</span>
                <span className="text-muted-foreground">({primaryReport.dailyBias.consecutiveDays}d)</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-foreground">PD</span>
                <span className={
                  primaryReport.pdArray.currentBias === "premium"  ? "text-destructive" :
                  primaryReport.pdArray.currentBias === "discount" ? "text-[hsl(var(--bullish))]" :
                  "text-primary"
                }>{primaryReport.pdArray.currentBias.toUpperCase()}</span>
              </div>

              {primaryReport.liquidity.nearestBSL && (
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-[hsl(var(--bullish))]">BSL</span>
                  <span className="font-mono text-muted-foreground">{fmtPrice(primaryReport.liquidity.nearestBSL.price, market)}</span>
                </div>
              )}
              {primaryReport.liquidity.nearestSSL && (
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-destructive">SSL</span>
                  <span className="font-mono text-muted-foreground">{fmtPrice(primaryReport.liquidity.nearestSSL.price, market)}</span>
                </div>
              )}
              {primaryReport.smt.detected && (
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-primary" />
                  <span className={primaryReport.smt.type === "bearish_smt" ? "text-destructive" : "text-[hsl(var(--bullish))]"}>
                    {primaryReport.smt.type?.replace("_", " ").toUpperCase()}
                  </span>
                </div>
              )}

              {/* Cascade summary in footer */}
              {confluenceReports.length > 1 && (
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-muted-foreground">Cascade anchor:</span>
                  <span className="font-bold text-primary">{TF_LABEL_MAP[cascade.anchorTf]}</span>
                  <span className={
                    cascade.anchorBias === "bullish" ? "text-[hsl(var(--bullish))]" :
                    cascade.anchorBias === "bearish" ? "text-destructive" : "text-muted-foreground"
                  }>{cascade.anchorBias.toUpperCase()}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Intelligence Sheet */}
      {sheet && (
        <IntelligenceSheet
          report={sheet.report}
          market={market}
          anchorTf={cascade.anchorTf}
          anchorBias={cascade.anchorBias}
          role={cascade.roles[sheet.tf]}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
