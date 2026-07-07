import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Target, Shield, Flag, Clock, Calendar, ExternalLink } from "lucide-react";
import { fmtAssetPrice, formatTimestamp } from "@/lib/format";
import { alpacaChartUrl } from "@/lib/alpaca-url";

// ─── Types ───

export interface SignalDetail {
  id: string;
  symbol: string;
  asset_class: string;
  setup_type: string;
  setup_subtype: string;
  entry_price: string | number;
  stop_loss: string | number;
  take_profit: string | number;
  risk_reward_ratio: string | number;
  confidence_score: number;
  execution_mode: string;
  created_at: string;
  signal_timestamp?: string;
  closed_at?: string | null;
  outcome?: {
    win: boolean;
    pnl: number;
    pnl_percent: number;
    exit_reason: string;
    bars_to_exit: number;
    actual_entry_price?: number;
    actual_exit_price?: number;
    closed_at?: string;
  } | null;
  analysis_context?: {
    timeframe_cascade?: { macro: string; intermediate: string; execution: string };
    market_regime?: string;
    session_context?: string;
    htf_bias?: string;
    confluence_factors?: Record<string, boolean>;
  };
  rationale?: {
    structure_confluence?: string;
    liquidity_quality?: string;
    session_context_reason?: string;
  };
  structure_confluence?: number;
  liquidity_quality?: number;
  confluence_count?: number;
}

interface Props {
  signal: SignalDetail | null;
  open: boolean;
  onClose: () => void;
}

// ─── Helpers ───

function getPrice(signal: SignalDetail, field: "entry_price" | "stop_loss" | "take_profit"): number {
  const v = signal[field];
  return typeof v === "string" ? parseFloat(v) : (v ?? 0);
}

function getRR(signal: SignalDetail): number {
  const v = signal.risk_reward_ratio;
  return typeof v === "string" ? parseFloat(v) : (v ?? 0);
}

function getDirection(signal: SignalDetail): "long" | "short" {
  const entry = getPrice(signal, "entry_price");
  const tp = getPrice(signal, "take_profit");
  return tp > entry ? "long" : "short";
}

function getGrade(confidence: number, confluence: number): { grade: string; color: string } {
  if (confidence >= 70 && confluence >= 4) return { grade: "A", color: "text-[hsl(var(--bullish))]" };
  if (confidence >= 55 && confluence >= 3) return { grade: "B", color: "text-primary" };
  if (confidence >= 40 && confluence >= 2) return { grade: "C", color: "text-yellow-500" };
  return { grade: "WAIT", color: "text-destructive" };
}

// ─── Component ───

export function SignalDetailSheet({ signal, open, onClose }: Props) {
  if (!signal) return null;

  const direction = getDirection(signal);
  const entry = getPrice(signal, "entry_price");
  const stop = getPrice(signal, "stop_loss");
  const target = getPrice(signal, "take_profit");
  const rr = getRR(signal);
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const entryLow = direction === "long" ? entry - risk * 0.1 : entry;
  const entryHigh = direction === "long" ? entry : entry + risk * 0.1;
  const ctx = signal.analysis_context ?? {};
  const confluence = signal.confluence_count ?? 0;
  const { grade, color: gradeColor } = getGrade(signal.confidence_score, confluence);

  const isLong = direction === "long";
  const borderColor = isLong ? "border-[hsl(var(--bullish))]/30" : "border-destructive/30";
  const bgColor = isLong ? "bg-[hsl(var(--bullish))]/5" : "bg-destructive/5";
  const dirColor = isLong ? "text-[hsl(var(--bullish))]" : "text-destructive";
  const confBarColor =
    signal.confidence_score > 65 ? "bg-[hsl(var(--bullish))]"
    : signal.confidence_score > 40 ? "bg-primary"
    : "bg-destructive";

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto border-border bg-card text-foreground font-mono">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            {isLong ? (
              <TrendingUp className="w-4 h-4 text-[hsl(var(--bullish))]" />
            ) : (
              <TrendingDown className="w-4 h-4 text-destructive" />
            )}
            <span className={dirColor}>{direction.toUpperCase()} SIGNAL</span>
            <Badge variant="outline" className={`text-xs ${gradeColor}`}>
              GRADE {grade}
            </Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-4 text-xs">
          {/* ── Header info ── */}
          <div className={`rounded-sm border ${borderColor} ${bgColor} p-3`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">{signal.symbol}</span>
                {alpacaChartUrl(signal.symbol) && (
                  <a
                    href={alpacaChartUrl(signal.symbol)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open full chart in Alpaca TradingView (paper trading)"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-border bg-muted text-[10px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors font-bold uppercase tracking-wider"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    Alpaca Chart
                  </a>
                )}
              </div>
              <div className="flex gap-1.5">
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {signal.setup_type}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {signal.setup_subtype}
                </Badge>
              </div>
            </div>

            {/* Price grid */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Entry Zone</p>
                <p className="text-sm font-bold font-mono tabular-nums">
                  {fmtAssetPrice(entryLow, signal.asset_class)} – {fmtAssetPrice(entryHigh, signal.asset_class)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  <Shield className="w-3 h-3 inline mr-0.5" />Stop Loss
                </p>
                <p className="text-sm font-bold font-mono tabular-nums text-destructive">
                  {fmtAssetPrice(stop, signal.asset_class)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  <Flag className="w-3 h-3 inline mr-0.5" />Target
                </p>
                <p className="text-sm font-bold font-mono tabular-nums text-[hsl(var(--bullish))]">
                  {fmtAssetPrice(target, signal.asset_class)}
                </p>
              </div>
            </div>

            {/* R:R + Confidence */}
            <div className="flex items-center gap-4 mb-2">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">R:R</span>
                <span className="ml-1.5 font-bold">{rr.toFixed(1)}:1</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-muted-foreground uppercase">Confidence</span>
                  <span className="text-[10px] font-bold">{signal.confidence_score}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${confBarColor}`}
                    style={{ width: `${signal.confidence_score}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Confluence Checklist ── */}
          {ctx.confluence_factors && Object.keys(ctx.confluence_factors).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                Confluence Factors
              </p>
              {Object.entries(ctx.confluence_factors).map(([key, pass]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className={`text-xs ${pass ? dirColor : "text-muted-foreground"}`}>
                    {pass ? "✓" : "✗"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── Context ── */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-sm border border-border bg-muted/30">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">TF Cascade</p>
              <p className="text-xs font-mono">
                {ctx.timeframe_cascade?.macro ?? "?"} → {ctx.timeframe_cascade?.intermediate ?? "?"} → {ctx.timeframe_cascade?.execution ?? "?"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Market Regime</p>
              <p className="text-xs">{ctx.market_regime ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Session</p>
              <p className="text-xs">{ctx.session_context ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">HTF Bias</p>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  ctx.htf_bias === "BULLISH"
                    ? "text-[hsl(var(--bullish))]"
                    : ctx.htf_bias === "BEARISH"
                      ? "text-destructive"
                      : ""
                }`}
              >
                {ctx.htf_bias ?? "—"}
              </Badge>
            </div>
          </div>

          {/* ── Rationale ── */}
          {signal.rationale && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">Rationale</p>
              {signal.rationale.structure_confluence && (
                <p className="text-[10px] text-muted-foreground">
                  <Target className="w-3 h-3 inline mr-1" />
                  {signal.rationale.structure_confluence}
                </p>
              )}
              {signal.rationale.liquidity_quality && (
                <p className="text-[10px] text-muted-foreground">
                  <Shield className="w-3 h-3 inline mr-1" />
                  {signal.rationale.liquidity_quality}
                </p>
              )}
            </div>
          )}

          {/* ── Outcome (if closed) ── */}
          {signal.outcome && (
            <div className={`rounded-sm border p-3 ${
              signal.outcome.win
                ? "border-[hsl(var(--bullish))]/30 bg-[hsl(var(--bullish))]/5"
                : "border-destructive/30 bg-destructive/5"
            }`}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-2">
                Outcome
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Result</p>
                  <Badge
                    variant={signal.outcome.win ? "default" : "destructive"}
                    className={signal.outcome.win ? "bg-[hsl(var(--bullish))] text-xs" : "text-xs"}
                  >
                    {signal.outcome.win ? "WIN" : "LOSS"}
                  </Badge>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">P&L</p>
                  <p className={`text-sm font-bold font-mono ${
                    signal.outcome.pnl >= 0 ? "text-[hsl(var(--bullish))]" : "text-destructive"
                  }`}>
                    {signal.outcome.pnl >= 0 ? "+" : ""}{fmtAssetPrice(Math.abs(signal.outcome.pnl), signal.asset_class)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Exit Reason</p>
                  <p className="text-xs font-mono">{signal.outcome.exit_reason}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Entry Price</p>
                  <p className="text-xs font-mono">
                    {fmtAssetPrice(signal.outcome.actual_entry_price ?? entry, signal.asset_class)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Exit Price</p>
                  <p className="text-xs font-mono">
                    {fmtAssetPrice(signal.outcome.actual_exit_price ?? target, signal.asset_class)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Bars Held</p>
                  <p className="text-xs font-mono">{signal.outcome.bars_to_exit}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">P&L %</p>
                  <p className={`text-xs font-mono ${
                    signal.outcome.pnl_percent >= 0 ? "text-[hsl(var(--bullish))]" : "text-destructive"
                  }`}>
                    {signal.outcome.pnl_percent >= 0 ? "+" : ""}{signal.outcome.pnl_percent.toFixed(2)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Execution Info ── */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1">
            <Badge variant="outline" className="text-[10px]">
              {signal.execution_mode}
            </Badge>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatTimestamp(signal.signal_timestamp ?? signal.created_at)}
            </span>
            {signal.closed_at && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Closed {formatTimestamp(signal.closed_at)}
              </span>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
