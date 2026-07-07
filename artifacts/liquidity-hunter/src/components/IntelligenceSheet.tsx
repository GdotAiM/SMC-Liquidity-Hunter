import { useState } from "react";
import { X, TrendingUp, TrendingDown, Minus, Layers, BarChart2, Activity, Zap, ChevronUp, ChevronDown, Target, Check, AlertTriangle, Copy, ClipboardCheck, Radio, BrainCircuit, ExternalLink } from "lucide-react";
import { alpacaChartUrl } from "@/lib/alpaca-url";
import type { SmcReport } from "@workspace/api-client-react";
import { AgentPipeline } from "./AgentPipeline";
import { AgentChat } from "./AgentChat";

type Market = "crypto" | "forex";

const TF_LABEL_MAP: Record<string, string> = {
  "1m": "M1", "5m": "M5", "15m": "M15",
  "1h": "H1", "4h": "H4", "1d": "D1", "1w": "W1",
};

type Props = {
  report: SmcReport;
  market: Market;
  onClose: () => void;
  anchorTf?: string;
  anchorBias?: string;
  role?: string;
};

function fmtPrice(p: number, market: Market): string {
  if (market === "forex") return p.toFixed(5);
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtRR(n: number): string {
  return `1 : ${n.toFixed(2)}`;
}

function BiasChip({ bias }: { bias: string }) {
  const [color, bg] =
    bias === "bullish" ? ["text-[hsl(var(--bullish))]", "bg-[hsl(var(--bullish))]/15 border-[hsl(var(--bullish))]/30"] :
    bias === "bearish" ? ["text-destructive", "bg-destructive/15 border-destructive/30"] :
    ["text-primary", "bg-primary/15 border-primary/30"];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${color} ${bg}`}>
      {bias === "bullish" ? <TrendingUp className="w-2.5 h-2.5" /> : bias === "bearish" ? <TrendingDown className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
      {bias}
    </span>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 pb-1 border-b border-border/60">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

function ConfBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(value * 100);
  const color = pct > 65 ? "bg-[hsl(var(--bullish))]" : pct > 40 ? "bg-primary" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[10px] text-muted-foreground w-16 shrink-0">{label}</span>}
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground w-7 text-right">{pct}%</span>
    </div>
  );
}

/* ─── Trade Setup derivation ─── */
function deriveSetup(report: SmcReport) {
  const bias = report.structure.bias !== "neutral" ? report.structure.bias : report.dailyBias.bias;
  const direction = bias === "bullish" ? "long" : bias === "bearish" ? "short" : null;

  const liveOBs      = report.orderBlocks.filter(ob => ob.valid && !ob.isMitigated);
  const unfilledFVGs = report.fvg.filter(g => g.fillFraction < 0.5);

  let entryLow: number | null  = null;
  let entryHigh: number | null = null;
  let entrySource = "";

  if (direction === "long") {
    const ob = liveOBs
      .filter(ob => ob.type === "bullish" && ob.proximal < report.currentPrice)
      .sort((a, b) => b.proximal - a.proximal)[0];
    const fvg = unfilledFVGs
      .filter(g => g.type === "bullish" && g.top < report.currentPrice)
      .sort((a, b) => b.top - a.top)[0];
    if (ob) {
      entryLow = Math.min(ob.proximal, ob.distal);
      entryHigh = Math.max(ob.proximal, ob.distal);
      entrySource = ob.hasFvg ? "OB + FVG" : "Order Block";
    } else if (fvg) {
      entryLow = fvg.bottom;
      entryHigh = fvg.top;
      entrySource = "FVG";
    }
  } else if (direction === "short") {
    const ob = liveOBs
      .filter(ob => ob.type === "bearish" && ob.proximal > report.currentPrice)
      .sort((a, b) => a.proximal - b.proximal)[0];
    const fvg = unfilledFVGs
      .filter(g => g.type === "bearish" && g.bottom > report.currentPrice)
      .sort((a, b) => a.bottom - b.bottom)[0];
    if (ob) {
      entryLow = Math.min(ob.proximal, ob.distal);
      entryHigh = Math.max(ob.proximal, ob.distal);
      entrySource = ob.hasFvg ? "OB + FVG" : "Order Block";
    } else if (fvg) {
      entryLow = fvg.bottom;
      entryHigh = fvg.top;
      entrySource = "FVG";
    }
  }

  /* Stop Loss */
  let stopLoss: number | null = null;
  let slSource = "";
  if (direction === "long") {
    const sslPrice = report.liquidity.nearestSSL?.price;
    if (sslPrice && sslPrice < report.currentPrice) { stopLoss = sslPrice * 0.9995; slSource = "Below SSL"; }
    else if (entryLow !== null) { stopLoss = entryLow * 0.9985; slSource = "Below entry zone"; }
  } else if (direction === "short") {
    const bslPrice = report.liquidity.nearestBSL?.price;
    if (bslPrice && bslPrice > report.currentPrice) { stopLoss = bslPrice * 1.0005; slSource = "Above BSL"; }
    else if (entryHigh !== null) { stopLoss = entryHigh * 1.0015; slSource = "Above entry zone"; }
  }

  /* Take-profit levels */
  const tp1 = report.draw[0] ?? null;
  const tp2 = report.draw[1] ?? null;

  /* R:R */
  let rrRatio: number | null = null;
  if (entryLow !== null && entryHigh !== null && stopLoss !== null && tp1 !== null) {
    const entryMid = (entryLow + entryHigh) / 2;
    const risk = Math.abs(entryMid - stopLoss);
    const reward = Math.abs(tp1.price - entryMid);
    if (risk > 0) rrRatio = reward / risk;
  }

  /* Checklist */
  const hasEntry = entryLow !== null && entryHigh !== null;
  const checklist = [
    { label: "Daily bias confirmed",                  pass: report.dailyBias.bias === bias && bias !== "neutral" },
    { label: "Structure aligns with direction",        pass: report.structure.bias === bias && bias !== "neutral" },
    { label: `Price in ${direction === "long" ? "discount" : "premium"} zone`,
      pass: direction === "long"
        ? report.pdArray.currentBias === "discount"
        : direction === "short"
          ? report.pdArray.currentBias === "premium"
          : false },
    { label: "OB / FVG entry zone identified",        pass: hasEntry },
    { label: "Clear liquidity draw target",           pass: tp1 !== null },
    { label: "SMT divergence supports direction",     pass: report.smt?.detected },
  ];

  const passCount = checklist.filter(c => c.pass).length;
  const grade: "A" | "B" | "C" | "wait" =
    passCount >= 5 ? "A" : passCount >= 4 ? "B" : passCount >= 3 ? "C" : "wait";

  return { direction, entryLow, entryHigh, entrySource, stopLoss, slSource, tp1, tp2, rrRatio, checklist, passCount, grade };
}

export function IntelligenceSheet({ report, market, onClose, anchorTf, anchorBias, role }: Props) {
  const bias      = report.structure.bias !== "neutral" ? report.structure.bias : report.dailyBias.bias;
  const lastBreak = report.structure.breaks.slice(-1)[0];
  const liveOBs   = report.orderBlocks.filter(ob => ob.valid && !ob.isMitigated);
  const unfilledFVGs = report.fvg.filter(g => g.fillFraction < 0.5);
  const bslPools  = report.liquidity.pools.filter(p => (p.type === "BSL" || p.type === "EQH") && !p.wasSwept);
  const sslPools  = report.liquidity.pools.filter(p => (p.type === "SSL" || p.type === "EQL") && !p.wasSwept);

  const confidenceDrivers: string[] = [];
  if (report.structure.confidence > 0.7)              confidenceDrivers.push("Strong structure alignment");
  if (report.liquidity.nearestBSL || report.liquidity.nearestSSL) confidenceDrivers.push("Nearby liquidity pool identified");
  if (liveOBs.some(ob => ob.hasFvg))                  confidenceDrivers.push("OB + FVG confluence detected");
  if (report.structure.breaks.length > 0)             confidenceDrivers.push("Recent BOS/MSS displacement");
  if (report.dailyBias.consecutiveDays >= 3)          confidenceDrivers.push(`${report.dailyBias.consecutiveDays}-day consecutive bias`);
  if (report.smt?.detected)                            confidenceDrivers.push(`SMT divergence: ${report.smt.type?.replace("_", " ")}`);
  if (report.pdArray.currentBias !== "equilibrium")   confidenceDrivers.push(`Price in ${report.pdArray.currentBias} zone`);
  if (confidenceDrivers.length === 0)                 confidenceDrivers.push("Insufficient confluence — wait for clearer setup");

  const setup = deriveSetup(report);
  const [copied, setCopied] = useState(false);

  function buildTradePlan(): string {
    const hr = "═".repeat(44);
    const ts = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const dirLabel = setup.direction === "long" ? "▲ LONG" : setup.direction === "short" ? "▼ SHORT" : "NEUTRAL";
    const gradeLabel = setup.grade === "wait" ? "WAIT" : `GRADE ${setup.grade}`;

    const lines: string[] = [
      hr,
      "  SMC PULSE PREDICT — Trade Plan",
      `  ${report.symbol} · ${report.timeframe.toUpperCase()} · ${ts}`,
      hr,
      "",
      `  DIRECTION : ${dirLabel}   |   ${gradeLabel} (${setup.passCount}/6 confluence)`,
      "",
      "─── LEVELS ───────────────────────────────",
    ];

    if (setup.entryLow !== null && setup.entryHigh !== null) {
      lines.push(`  Entry Zone  : ${fmtPrice(setup.entryLow, market)} – ${fmtPrice(setup.entryHigh, market)}  (${setup.entrySource})`);
    } else {
      lines.push("  Entry Zone  : No zone — wait for price to return to OB/FVG");
    }

    if (setup.stopLoss !== null) {
      lines.push(`  Stop Loss   : ${fmtPrice(setup.stopLoss, market)}  (${setup.slSource})`);
    } else {
      lines.push("  Stop Loss   : Pending entry zone confirmation");
    }

    if (setup.tp1) {
      const rrStr = setup.rrRatio !== null ? `  |  R:R 1:${setup.rrRatio.toFixed(2)}` : "";
      lines.push(`  Target 1    : ${fmtPrice(setup.tp1.price, market)}  (${setup.tp1.label})${rrStr}`);
    }
    if (setup.tp2) {
      lines.push(`  Target 2    : ${fmtPrice(setup.tp2.price, market)}  (${setup.tp2.label})`);
    }

    lines.push("");
    lines.push("─── ENTRY CHECKLIST ──────────────────────");
    for (const item of setup.checklist) {
      lines.push(`  ${item.pass ? "✓" : "✗"} ${item.label}`);
    }

    lines.push("");
    lines.push("─── CONFIDENCE DRIVERS ───────────────────");
    for (const d of confidenceDrivers) {
      lines.push(`  • ${d}`);
    }

    lines.push("");
    lines.push("─── MARKET CONTEXT ───────────────────────");
    lines.push(`  Structure   : ${bias.toUpperCase()}  |  Conf ${Math.round(report.structure.confidence * 100)}%`);
    lines.push(`  Daily Bias  : ${report.dailyBias.bias.toUpperCase()}  (${report.dailyBias.consecutiveDays}d consecutive)`);
    lines.push(`  PD Array    : ${report.pdArray.currentBias.toUpperCase()}`);
    if (report.liquidity.nearestBSL) lines.push(`  BSL Above   : ${fmtPrice(report.liquidity.nearestBSL.price, market)}`);
    if (report.liquidity.nearestSSL) lines.push(`  SSL Below   : ${fmtPrice(report.liquidity.nearestSSL.price, market)}`);
    if (report.smt?.detected) lines.push(`  SMT Signal  : ${report.smt.type?.replace("_", " ").toUpperCase() ?? "detected"}`);

    lines.push("");
    lines.push("  Generated by SMC Pulse Predict");
    lines.push(hr);

    return lines.join("\n");
  }

  function copyTradePlan() {
    const text = buildTradePlan();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  const gradeColor =
    setup.grade === "A" ? "text-[hsl(var(--bullish))] border-[hsl(var(--bullish))]/40 bg-[hsl(var(--bullish))]/10" :
    setup.grade === "B" ? "text-primary border-primary/40 bg-primary/10" :
    setup.grade === "C" ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" :
    "text-muted-foreground border-border bg-muted/30";

  const dirColor = setup.direction === "long"
    ? "text-[hsl(var(--bullish))]"
    : setup.direction === "short"
      ? "text-destructive"
      : "text-muted-foreground";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-2xl bg-background border-l border-border flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-bold">{report.symbol} · {report.timeframe}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <BiasChip bias={bias} />
                <span className="text-xs text-muted-foreground font-mono">{fmtPrice(report.currentPrice, market)}</span>
                {report.sessionState && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-primary/25 bg-primary/8 text-[10px] text-primary font-medium">
                    <Radio className="w-2 h-2" />
                    {report.sessionState}
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* Alpaca TradingView link */}
          {alpacaChartUrl(report.symbol) && (
            <a
              href={alpacaChartUrl(report.symbol)!}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full chart in Alpaca TradingView (paper trading)"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-border bg-muted text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors text-[10px] font-bold uppercase tracking-wider"
            >
              <ExternalLink className="w-3 h-3" />
              <span className="hidden sm:inline">Alpaca Chart</span>
            </a>
          )}

          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-sm transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-5">

            {/* ══ Market Narrative Banner ══ */}
            {report.narrative && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-sm border border-primary/20 bg-primary/5">
                <BrainCircuit className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-[11px] text-foreground/85 leading-relaxed">{report.narrative}</p>
              </div>
            )}

            {/* ══ 0. Trade Setup Summary ══ */}
            <Section title="Trade Setup Summary" icon={Target}>
              {/* Cascade context banner */}
              {anchorTf && anchorBias && role && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-sm border text-[11px] mb-2 ${
                  role === "BIAS SETTER"
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : bias === anchorBias
                      ? "bg-[hsl(var(--bullish))]/8 border-[hsl(var(--bullish))]/25 text-[hsl(var(--bullish))]"
                      : "bg-yellow-500/8 border-yellow-500/25 text-yellow-400"
                }`}>
                  <span className="font-bold uppercase tracking-wider">{role}</span>
                  <span className="text-muted-foreground">·</span>
                  {role === "BIAS SETTER" ? (
                    <span>{TF_LABEL_MAP[report.timeframe] ?? report.timeframe.toUpperCase()} sets the direction for lower timeframes</span>
                  ) : bias === anchorBias ? (
                    <span>Confirms {TF_LABEL_MAP[anchorTf] ?? anchorTf} {anchorBias} bias ✓</span>
                  ) : (
                    <span>⚠ Counter-trend vs {TF_LABEL_MAP[anchorTf] ?? anchorTf} anchor ({anchorBias}) — higher risk</span>
                  )}
                </div>
              )}

              {/* Grade badge + direction + copy */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-sm border ${gradeColor}`}>
                    {setup.grade === "wait" ? "WAIT" : `GRADE  ${setup.grade}`}
                  </span>
                  {setup.direction && (
                    <span className={`text-xs font-bold uppercase ${dirColor}`}>
                      {setup.direction === "long" ? "▲ LONG" : "▼ SHORT"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{setup.passCount}/6 confluence</span>
                  <button
                    onClick={copyTradePlan}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-[10px] font-semibold transition-all
                      ${copied
                        ? "border-[hsl(var(--bullish))]/50 bg-[hsl(var(--bullish))]/10 text-[hsl(var(--bullish))]"
                        : "border-border bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"}`}
                  >
                    {copied
                      ? <><ClipboardCheck className="w-3 h-3" /> Copied!</>
                      : <><Copy className="w-3 h-3" /> Copy Plan</>}
                  </button>
                </div>
              </div>

              {/* Entry / SL / TP table */}
              <div className="rounded-sm border border-border overflow-hidden">
                {/* Entry zone */}
                <div className="grid grid-cols-[110px_1fr] border-b border-border/60">
                  <div className="px-3 py-2.5 bg-muted/30 border-r border-border/60">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Entry Zone</p>
                    {setup.entrySource && <p className="text-[9px] text-primary/60 mt-0.5">{setup.entrySource}</p>}
                  </div>
                  <div className="px-3 py-2.5 flex items-center">
                    {setup.entryLow !== null && setup.entryHigh !== null ? (
                      <span className={`text-sm font-bold font-mono ${dirColor}`}>
                        {fmtPrice(setup.entryLow, market)}
                        <span className="text-muted-foreground mx-1.5">–</span>
                        {fmtPrice(setup.entryHigh, market)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No zone identified — wait for price to return to OB/FVG</span>
                    )}
                  </div>
                </div>

                {/* Stop Loss */}
                <div className="grid grid-cols-[110px_1fr] border-b border-border/60">
                  <div className="px-3 py-2.5 bg-muted/30 border-r border-border/60">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Stop Loss</p>
                    {setup.slSource && <p className="text-[9px] text-destructive/60 mt-0.5">{setup.slSource}</p>}
                  </div>
                  <div className="px-3 py-2.5 flex items-center gap-3">
                    {setup.stopLoss !== null ? (
                      <span className="text-sm font-bold font-mono text-destructive">
                        {fmtPrice(setup.stopLoss, market)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Pending entry zone</span>
                    )}
                  </div>
                </div>

                {/* TP 1 */}
                <div className={`grid grid-cols-[110px_1fr] ${setup.tp2 ? "border-b border-border/60" : ""}`}>
                  <div className="px-3 py-2.5 bg-muted/30 border-r border-border/60">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Target 1</p>
                    {setup.tp1 && <p className="text-[9px] text-[hsl(var(--bullish))]/60 mt-0.5 truncate">{setup.tp1.label}</p>}
                  </div>
                  <div className="px-3 py-2.5 flex items-center gap-3">
                    {setup.tp1 ? (
                      <>
                        <span className="text-sm font-bold font-mono text-[hsl(var(--bullish))]">
                          {fmtPrice(setup.tp1.price, market)}
                        </span>
                        {setup.rrRatio !== null && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-bold border ${
                            setup.rrRatio >= 3 ? "bg-[hsl(var(--bullish))]/15 border-[hsl(var(--bullish))]/30 text-[hsl(var(--bullish))]" :
                            setup.rrRatio >= 2 ? "bg-primary/15 border-primary/30 text-primary" :
                            "bg-muted border-border text-muted-foreground"
                          }`}>
                            R:R {fmtRR(setup.rrRatio)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No draw target</span>
                    )}
                  </div>
                </div>

                {/* TP 2 (optional) */}
                {setup.tp2 && (
                  <div className="grid grid-cols-[110px_1fr]">
                    <div className="px-3 py-2.5 bg-muted/30 border-r border-border/60">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Target 2</p>
                      <p className="text-[9px] text-[hsl(var(--bullish))]/60 mt-0.5 truncate">{setup.tp2.label}</p>
                    </div>
                    <div className="px-3 py-2.5 flex items-center">
                      <span className="text-sm font-bold font-mono text-[hsl(var(--bullish))]/70">
                        {fmtPrice(setup.tp2.price, market)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Confluence checklist */}
              <div className="mt-3 space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Entry Checklist</p>
                {setup.checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${item.pass ? "bg-[hsl(var(--bullish))]/20" : "bg-muted"}`}>
                      {item.pass
                        ? <Check className="w-2.5 h-2.5 text-[hsl(var(--bullish))]" />
                        : <AlertTriangle className="w-2.5 h-2.5 text-muted-foreground/50" />}
                    </span>
                    <span className={item.pass ? "text-foreground/80" : "text-muted-foreground/60 line-through decoration-muted-foreground/30"}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Grade explanation */}
              {setup.grade === "wait" && (
                <div className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/30 rounded-sm px-3 py-2 border border-border/50">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-yellow-400" />
                  <span>Fewer than 3 confluence factors present. Wait for clearer alignment before entering.</span>
                </div>
              )}
            </Section>

            {/* ══ 1. Structure ══ */}
            <Section title="Structure" icon={Activity}>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-muted/40 rounded-sm p-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Current Bias</p>
                  <BiasChip bias={bias} />
                </div>
                <div className="bg-muted/40 rounded-sm p-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Trend</p>
                  <span className="text-xs font-bold uppercase">{report.structure.trend}</span>
                </div>
                <div className="bg-muted/40 rounded-sm p-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Phase</p>
                  <span className={`text-[10px] font-bold uppercase tracking-wide ${
                    report.structure.phase === "expansion"    ? "text-[hsl(var(--bullish))]" :
                    report.structure.phase === "continuation" ? "text-primary" :
                    report.structure.phase === "manipulation" ? "text-yellow-400" :
                    report.structure.phase === "distribution" ? "text-destructive" :
                    "text-muted-foreground"
                  }`}>
                    {report.structure.phase ?? "—"}
                  </span>
                </div>
              </div>
              {lastBreak && (
                <div className="bg-muted/40 rounded-sm p-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Last {lastBreak.type}</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-sm ${lastBreak.type === "BOS" ? "bg-primary/20 text-primary" : "bg-yellow-500/20 text-yellow-400"}`}>{lastBreak.type}</span>
                    <span className="text-xs font-mono text-muted-foreground">@ {fmtPrice(lastBreak.price, market)}</span>
                    <BiasChip bias={lastBreak.direction} />
                  </div>
                </div>
              )}
              <ConfBar value={report.structure.confidence} label="Confidence" />
              {report.structure.evidence && report.structure.evidence.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {report.structure.evidence.map((ev, i) => (
                    <p key={i} className="text-[10px] text-muted-foreground">{ev}</p>
                  ))}
                </div>
              )}
            </Section>

            {/* ══ 2. Liquidity Map ══ */}
            <Section title="Liquidity Map" icon={Layers}>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-[hsl(var(--bullish))] font-semibold uppercase tracking-wider mb-1.5">BSL Above</p>
                  <div className="space-y-1">
                    {bslPools.slice(0, 4).map((p, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="font-mono">{fmtPrice(p.price, market)}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">{p.touches}x</span>
                          {p.probabilityOfSweep != null && p.probabilityOfSweep > 0 && (
                            <span className={`text-[10px] px-1 rounded-sm font-semibold ${
                              p.probabilityOfSweep > 0.6 ? "text-[hsl(var(--bullish))] bg-[hsl(var(--bullish))]/10" :
                              p.probabilityOfSweep > 0.35 ? "text-primary bg-primary/10" :
                              "text-muted-foreground bg-muted/50"
                            }`}>{Math.round(p.probabilityOfSweep * 100)}%</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {bslPools.length === 0 && <p className="text-[10px] text-muted-foreground italic">None identified</p>}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-destructive font-semibold uppercase tracking-wider mb-1.5">SSL Below</p>
                  <div className="space-y-1">
                    {sslPools.slice(0, 4).map((p, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="font-mono">{fmtPrice(p.price, market)}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">{p.touches}x</span>
                          {p.probabilityOfSweep != null && p.probabilityOfSweep > 0 && (
                            <span className={`text-[10px] px-1 rounded-sm font-semibold ${
                              p.probabilityOfSweep > 0.6 ? "text-destructive bg-destructive/10" :
                              p.probabilityOfSweep > 0.35 ? "text-primary bg-primary/10" :
                              "text-muted-foreground bg-muted/50"
                            }`}>{Math.round(p.probabilityOfSweep * 100)}%</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {sslPools.length === 0 && <p className="text-[10px] text-muted-foreground italic">None identified</p>}
                  </div>
                </div>
              </div>
              {report.liquidity.pools.filter(p => p.type === "EQH" || p.type === "EQL").slice(0, 4).map((p, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] bg-yellow-500/10 border border-yellow-500/20 rounded-sm px-2.5 py-1.5">
                  <span className="text-yellow-400 font-semibold">{p.type === "EQH" ? "Equal Highs" : "Equal Lows"}</span>
                  <span className="font-mono text-muted-foreground">{fmtPrice(p.price, market)}</span>
                  <span className="text-[10px] text-muted-foreground">Engineered target</span>
                </div>
              ))}
            </Section>

            {/* ══ 3. Imbalance Zones ══ */}
            <Section title="Imbalance Zones" icon={BarChart2}>
              {unfilledFVGs.length === 0 && <p className="text-xs text-muted-foreground italic">No significant unfilled FVGs</p>}
              <div className="space-y-1.5">
                {unfilledFVGs.slice(-6).reverse().map((g, i) => (
                  <div key={i} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-sm border text-[11px] ${g.type === "bullish" ? "border-[hsl(var(--bullish))]/20 bg-[hsl(var(--bullish))]/5" : "border-destructive/20 bg-destructive/5"}`}>
                    <span className={`font-bold text-[10px] ${g.type === "bullish" ? "text-[hsl(var(--bullish))]" : "text-destructive"}`}>{g.type.toUpperCase()} FVG</span>
                    <span className="font-mono text-muted-foreground flex-1">{fmtPrice(g.bottom, market)} – {fmtPrice(g.top, market)}</span>
                    <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round(g.fillFraction * 100)}%` }} />
                    </div>
                    {g.isInversion && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1 rounded-sm">INV</span>}
                  </div>
                ))}
              </div>
            </Section>

            {/* ══ 4. Order Flow ══ */}
            <Section title="Order Flow" icon={Activity}>
              <div className="space-y-1.5">
                {report.structure.breaks.slice(-5).reverse().map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold ${b.type === "BOS" ? "bg-primary/20 text-primary" : "bg-yellow-500/20 text-yellow-400"}`}>{b.type}</span>
                    <span className={`font-bold ${b.direction === "bullish" ? "text-[hsl(var(--bullish))]" : "text-destructive"}`}>{b.direction}</span>
                    <span className="font-mono text-muted-foreground">@ {fmtPrice(b.price, market)}</span>
                  </div>
                ))}
                {report.structure.breaks.length === 0 && <p className="text-xs text-muted-foreground italic">No recent structure breaks</p>}
              </div>
              {liveOBs.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Live Order Blocks</p>
                  {liveOBs.slice(0, 5).map((ob, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className={`text-[10px] font-bold ${ob.type === "bullish" ? "text-[hsl(var(--bullish))]" : "text-destructive"}`}>{ob.type === "bullish" ? "BULL" : "BEAR"}</span>
                      <span className="font-mono text-muted-foreground">{fmtPrice(ob.proximal, market)} → {fmtPrice(ob.distal, market)}</span>
                      {ob.hasFvg && <span className="text-[10px] bg-primary/20 text-primary px-1 rounded-sm">FVG</span>}
                      {ob.confidence != null && (
                        <span className={`text-[10px] px-1 rounded-sm font-semibold ml-auto ${
                          ob.confidence > 0.75 ? "text-[hsl(var(--bullish))] bg-[hsl(var(--bullish))]/10" :
                          ob.confidence > 0.5  ? "text-primary bg-primary/10" :
                          "text-muted-foreground bg-muted/50"
                        }`}>{Math.round(ob.confidence * 100)}%</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ══ 5. Confidence Drivers ══ */}
            <Section title="Confidence Drivers" icon={Zap}>
              <div className="space-y-1.5">
                {confidenceDrivers.map((driver, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span className="text-foreground/80">{driver}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1.5">
                <ConfBar value={report.structure.confidence} label="Structure" />
                <ConfBar value={report.dailyBias.strength} label="Daily Bias" />
                {report.smt?.detected && <ConfBar value={report.smt.confidence} label="SMT" />}
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Draw on Liquidity</p>
                {report.draw.slice(0, 3).map((d, i) => (
                  <div key={i} className="space-y-0.5">
                    <div className="flex items-center gap-2 text-[11px]">
                      {d.direction === "long" ? <ChevronUp className="w-3 h-3 text-[hsl(var(--bullish))] shrink-0" /> : <ChevronDown className="w-3 h-3 text-destructive shrink-0" />}
                      <span className="flex-1 truncate text-muted-foreground">{d.label}</span>
                      <span className="text-[10px] bg-muted px-1.5 rounded-sm">{d.score.toFixed(2)}</span>
                    </div>
                    {d.evidence && d.evidence.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-5">
                        {d.evidence.slice(0, 3).map((ev, j) => (
                          <span key={j} className="text-[9px] text-muted-foreground/70 bg-muted/40 px-1.5 py-0.5 rounded-sm">{ev}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>

            {/* ══ 6. Agent Pipeline ══ */}
            <Section title="Agent Pipeline" icon={Zap}>
              <AgentPipeline report={report} />
            </Section>

          </div>
        </div>

        {/* ── Chat — fixed at bottom ── */}
        <div className="border-t border-border shrink-0 h-72 flex flex-col">
          <AgentChat report={report} />
        </div>
      </div>
    </div>
  );
}
