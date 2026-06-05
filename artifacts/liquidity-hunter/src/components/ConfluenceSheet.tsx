import { useState } from "react";
import {
  X, TrendingUp, TrendingDown, Minus, ArrowRight,
  Target, Check, AlertTriangle, Copy, ClipboardCheck, Layers, Activity, BarChart2, Zap,
} from "lucide-react";
import type { SmcReport } from "@workspace/api-client-react";

type Market = "crypto" | "forex";

const TF_LABELS: Record<string, string> = {
  "1m": "M1", "5m": "M5", "15m": "M15",
  "1h": "H1", "4h": "H4", "1d": "D1", "1w": "W1",
};
const TF_WEIGHT: Record<string, number> = {
  "1m": 1, "5m": 2, "15m": 3, "1h": 4, "4h": 5, "1d": 6, "1w": 7,
};

type CascadeInfo = {
  roles: Record<string, string>;
  anchorTf: string;
  anchorBias: string;
};

type Props = {
  reports: Array<{ tf: string; report: SmcReport }>;
  cascade: CascadeInfo;
  market: Market;
  onClose: () => void;
};

function fmtPrice(p: number, market: Market): string {
  if (market === "forex") return p.toFixed(5);
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function getBias(report: SmcReport): "bullish" | "bearish" | "neutral" {
  const sb = report.structure.bias;
  const db = report.dailyBias.bias;
  if (sb !== "neutral") return sb as "bullish" | "bearish";
  if (db !== "neutral") return db as "bullish" | "bearish";
  return "neutral";
}

function getConfidence(report: SmcReport): number {
  return Math.round(((report.structure.confidence + report.dailyBias.strength) / 2) * 100);
}

function BiasChip({ bias }: { bias: string }) {
  const style =
    bias === "bullish" ? "text-[hsl(var(--bullish))] bg-[hsl(var(--bullish))]/15 border-[hsl(var(--bullish))]/30" :
    bias === "bearish" ? "text-destructive bg-destructive/15 border-destructive/30" :
    "text-primary bg-primary/15 border-primary/30";
  const Icon = bias === "bullish" ? TrendingUp : bias === "bearish" ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${style}`}>
      <Icon className="w-2.5 h-2.5" />{bias}
    </span>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-1.5 border-b border-border/60">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

function ConfBar({ value, label }: { value: number; label?: string }) {
  const color = value > 65 ? "bg-[hsl(var(--bullish))]" : value > 40 ? "bg-primary" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[10px] text-muted-foreground w-20 shrink-0">{label}</span>}
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground w-8 text-right">{value}%</span>
    </div>
  );
}

/* ─── Multi-TF trade setup synthesis ─── */
function deriveMultiTfSetup(
  sortedReports: Array<{ tf: string; report: SmcReport; role: string }>,
  anchorBias: string,
  market: Market,
) {
  const direction = anchorBias === "bullish" ? "long" : anchorBias === "bearish" ? "short" : null;
  if (!direction) return null;

  /* Entry zone from ENTRY TRIGGER (lowest TF) */
  const entryItem = [...sortedReports].reverse().find(r => r.role === "ENTRY TRIGGER") ?? sortedReports[sortedReports.length - 1];
  const confirmItem = sortedReports.find(r => r.role === "CONFIRMATION") ?? sortedReports[Math.floor(sortedReports.length / 2)];
  const anchorItem  = sortedReports.find(r => r.role === "BIAS SETTER") ?? sortedReports[0];

  const entryReport   = entryItem.report;
  const confirmReport = confirmItem.report;
  const anchorReport  = anchorItem.report;

  const liveOBs      = entryReport.orderBlocks.filter(ob => ob.valid && !ob.isMitigated);
  const unfilledFVGs = entryReport.fvg.filter(g => g.fillFraction < 0.5);
  const currentPrice = entryReport.currentPrice;

  let entryLow: number | null  = null;
  let entryHigh: number | null = null;
  let entrySource = "";

  if (direction === "long") {
    const ob = liveOBs.filter(ob => ob.type === "bullish" && ob.proximal < currentPrice)
      .sort((a, b) => b.proximal - a.proximal)[0];
    const fvg = unfilledFVGs.filter(g => g.type === "bullish" && g.top < currentPrice)
      .sort((a, b) => b.top - a.top)[0];
    if (ob) {
      entryLow = Math.min(ob.proximal, ob.distal);
      entryHigh = Math.max(ob.proximal, ob.distal);
      entrySource = ob.hasFvg ? "OB + FVG (entry TF)" : `Order Block (${TF_LABELS[entryItem.tf]})`;
    } else if (fvg) {
      entryLow = fvg.bottom; entryHigh = fvg.top;
      entrySource = `FVG (${TF_LABELS[entryItem.tf]})`;
    }
  } else {
    const ob = liveOBs.filter(ob => ob.type === "bearish" && ob.proximal > currentPrice)
      .sort((a, b) => a.proximal - b.proximal)[0];
    const fvg = unfilledFVGs.filter(g => g.type === "bearish" && g.bottom > currentPrice)
      .sort((a, b) => a.bottom - b.bottom)[0];
    if (ob) {
      entryLow = Math.min(ob.proximal, ob.distal);
      entryHigh = Math.max(ob.proximal, ob.distal);
      entrySource = ob.hasFvg ? "OB + FVG (entry TF)" : `Order Block (${TF_LABELS[entryItem.tf]})`;
    } else if (fvg) {
      entryLow = fvg.bottom; entryHigh = fvg.top;
      entrySource = `FVG (${TF_LABELS[entryItem.tf]})`;
    }
  }

  /* SL from entry TF liquidity */
  let stopLoss: number | null = null;
  let slSource = "";
  if (direction === "long") {
    const ssl = entryReport.liquidity.nearestSSL?.price;
    if (ssl && ssl < currentPrice) { stopLoss = ssl * 0.9995; slSource = `Below SSL (${TF_LABELS[entryItem.tf]})`; }
    else if (entryLow !== null)     { stopLoss = entryLow * 0.9985; slSource = "Below entry zone"; }
  } else {
    const bsl = entryReport.liquidity.nearestBSL?.price;
    if (bsl && bsl > currentPrice) { stopLoss = bsl * 1.0005; slSource = `Above BSL (${TF_LABELS[entryItem.tf]})`; }
    else if (entryHigh !== null)    { stopLoss = entryHigh * 1.0015; slSource = "Above entry zone"; }
  }

  /* TP1 from CONFIRMATION TF draw, TP2 from BIAS SETTER TF draw */
  const tp1 = confirmReport.draw[0] ?? entryReport.draw[0] ?? null;
  const tp2 = anchorReport.draw[0] ?? confirmReport.draw[1] ?? null;

  /* R:R */
  let rrRatio: number | null = null;
  if (entryLow !== null && entryHigh !== null && stopLoss !== null && tp1 !== null) {
    const mid = (entryLow + entryHigh) / 2;
    const risk = Math.abs(mid - stopLoss);
    const reward = Math.abs(tp1.price - mid);
    if (risk > 0) rrRatio = reward / risk;
  }

  /* Multi-TF confluence checklist */
  const htfAligned = getBias(anchorReport) === anchorBias;
  const mtfAligned = getBias(confirmReport) === anchorBias;
  const ltfAligned = getBias(entryReport) === anchorBias;
  const hasEntryPoi = entryLow !== null && entryHigh !== null;
  const correctPdZone = direction === "long"
    ? entryReport.pdArray.currentBias === "discount"
    : direction === "short"
      ? entryReport.pdArray.currentBias === "premium"
      : false;
  const hasDraw = tp1 !== null;
  const smtSupports = sortedReports.some(r => r.report.smt.detected);

  const checklist = [
    { label: `HTF (${TF_LABELS[anchorItem.tf]}) trend aligned`,    pass: htfAligned },
    { label: `MTF (${TF_LABELS[confirmItem.tf]}) confirms direction`, pass: mtfAligned },
    { label: `LTF (${TF_LABELS[entryItem.tf]}) shows entry POI`,   pass: ltfAligned && hasEntryPoi },
    { label: `Price in ${direction === "long" ? "discount" : "premium"} zone`, pass: correctPdZone },
    { label: "Clear HTF liquidity draw",                             pass: hasDraw },
    { label: "SMT divergence supports trade",                        pass: smtSupports },
  ];

  const passCount = checklist.filter(c => c.pass).length;
  const grade: "A" | "B" | "C" | "wait" =
    passCount >= 5 ? "A" : passCount >= 4 ? "B" : passCount >= 3 ? "C" : "wait";

  return {
    direction, entryLow, entryHigh, entrySource, stopLoss, slSource,
    tp1, tp2, rrRatio, checklist, passCount, grade,
    entryTf: entryItem.tf, confirmTf: confirmItem.tf, anchorTf: anchorItem.tf,
    currentPrice,
  };
}

export function ConfluenceSheet({ reports, cascade, market, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const { anchorTf, anchorBias, roles } = cascade;

  /* Sort high → low weight */
  const sortedReports = [...reports]
    .sort((a, b) => (TF_WEIGHT[b.tf] ?? 0) - (TF_WEIGHT[a.tf] ?? 0))
    .map(r => ({ ...r, role: roles[r.tf] ?? "" }));

  let aligned = 0, counter = 0;
  for (const { report } of sortedReports) {
    const b = getBias(report);
    if (b === anchorBias) aligned++;
    else if (b !== "neutral") counter++;
  }
  const fullyAligned = counter === 0 && sortedReports.length > 1;

  const primaryReport = sortedReports[0]?.report;
  if (!primaryReport) return null;

  const symbol = primaryReport.symbol;
  const setup  = deriveMultiTfSetup(sortedReports, anchorBias, market);

  const anchorColor =
    anchorBias === "bullish" ? "text-[hsl(var(--bullish))]" :
    anchorBias === "bearish" ? "text-destructive" : "text-primary";

  function buildPlan(): string {
    if (!setup) return "No trade setup derived.";
    const hr = "═".repeat(48);
    const ts = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const dir = setup.direction === "long" ? "▲ LONG" : "▼ SHORT";
    const fp = (n: number | null) => n != null ? fmtPrice(n, market) : "—";

    return [
      hr,
      "  SMC PULSE PREDICT — Multi-TF Confluence Plan",
      `  ${symbol} · ${ts}`,
      hr,
      `  Direction : ${dir}`,
      `  Grade     : ${setup.grade === "wait" ? "WAIT FOR SETUP" : `GRADE ${setup.grade}`}`,
      `  Confluence: ${setup.passCount}/6 checks passed`,
      "",
      `  Anchor (${TF_LABELS[setup.anchorTf]}) Bias : ${anchorBias.toUpperCase()}`,
      `  Confirm (${TF_LABELS[setup.confirmTf]}) Bias: ${getBias(sortedReports.find(r => r.tf === setup.confirmTf)!.report).toUpperCase()}`,
      `  Entry   (${TF_LABELS[setup.entryTf]})  Bias: ${getBias(sortedReports.find(r => r.tf === setup.entryTf)!.report).toUpperCase()}`,
      "",
      "  ENTRY ZONE",
      `  Source: ${setup.entrySource}`,
      `  Low   : ${fp(setup.entryLow)}`,
      `  High  : ${fp(setup.entryHigh)}`,
      "",
      `  STOP LOSS : ${fp(setup.stopLoss)}  (${setup.slSource})`,
      `  TP1       : ${setup.tp1 ? fp(setup.tp1.price) + " · " + setup.tp1.label : "—"}`,
      `  TP2       : ${setup.tp2 ? fp(setup.tp2.price) + " · " + setup.tp2.label : "—"}`,
      setup.rrRatio != null ? `  R:R       : 1 : ${setup.rrRatio.toFixed(2)}` : "",
      "",
      "  MULTI-TF CHECKLIST",
      ...setup.checklist.map(c => `  ${c.pass ? "✓" : "✗"} ${c.label}`),
      hr,
    ].join("\n");
  }

  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(buildPlan());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* panel */}
      <div className="relative w-full max-w-2xl bg-background border-l border-border flex flex-col h-full shadow-2xl">

        {/* ── Header ── */}
        <div className={`px-5 py-4 border-b border-border flex items-start justify-between bg-card/80
          ${anchorBias === "bullish" ? "border-l-2 border-l-[hsl(var(--bullish))]" :
            anchorBias === "bearish" ? "border-l-2 border-l-destructive" : ""}`}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Multi-TF Confluence Analysis
              </span>
            </div>
            <div className={`text-lg font-bold tracking-tight ${anchorColor}`}>
              {anchorBias === "bullish" ? "BULLISH CASCADE" :
               anchorBias === "bearish" ? "BEARISH CASCADE" : "MIXED CONDITIONS"}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground">{symbol}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-sm font-bold border
                bg-[hsl(var(--primary))]/10 border-primary/30 text-primary">
                {aligned} aligned · {counter} counter
              </span>
              {fullyAligned && (
                <span className="text-[10px] px-2 py-0.5 rounded-sm font-bold border
                  bg-[hsl(var(--bullish))]/15 border-[hsl(var(--bullish))]/30 text-[hsl(var(--bullish))]">
                  FULL CASCADE ✓
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6 font-mono">

          {/* 1. Cascade Flow */}
          <Section title="Cascade Flow" icon={Activity}>
            <div className="flex items-center gap-2 flex-wrap">
              {sortedReports.map(({ tf, report, role }, i) => {
                const bias      = getBias(report);
                const isAnchor  = tf === anchorTf;
                const isAligned = bias === anchorBias;
                const conf      = getConfidence(report);

                const boxStyle =
                  isAnchor   ? "bg-primary/15 border-primary/40 text-primary" :
                  isAligned  ? "bg-[hsl(var(--bullish))]/10 border-[hsl(var(--bullish))]/30 text-[hsl(var(--bullish))]" :
                               "bg-yellow-500/10 border-yellow-500/30 text-yellow-400";

                return (
                  <div key={tf} className="flex items-center gap-2">
                    <div className={`rounded-sm border px-3 py-2 ${boxStyle}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        {isAnchor && <span className="text-[9px] opacity-70">⚓</span>}
                        <span className="text-xs font-bold">{TF_LABELS[tf] ?? tf.toUpperCase()}</span>
                        <span className="text-[9px] opacity-60 font-medium uppercase">{role.replace("BIAS SETTER", "BIAS").replace("ENTRY TRIGGER", "ENTRY").replace("CONFIRMATION", "CONF")}</span>
                      </div>
                      <BiasChip bias={bias} />
                      <div className="mt-1.5">
                        <div className="w-full h-1 bg-black/20 rounded-full overflow-hidden">
                          <div className="h-full bg-current rounded-full opacity-60" style={{ width: `${conf}%` }} />
                        </div>
                        <span className="text-[9px] opacity-60">Conf {conf}%</span>
                      </div>
                    </div>
                    {i < sortedReports.length - 1 && (
                      <ArrowRight className={`w-4 h-4 shrink-0 ${isAligned ? "text-[hsl(var(--bullish))]" : "text-yellow-400"}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* 2. Per-TF Breakdown */}
          <Section title="Per-Timeframe Breakdown" icon={BarChart2}>
            <div className="space-y-3">
              {sortedReports.map(({ tf, report, role }) => {
                const bias      = getBias(report);
                const isAnchor  = tf === anchorTf;
                const isAligned = bias === anchorBias;
                const conf      = getConfidence(report);
                const liveOBs   = report.orderBlocks.filter(ob => ob.valid && !ob.isMitigated);
                const fvgs      = report.fvg.filter(g => g.fillFraction < 0.5);
                const lastBreak = report.structure.breaks.slice(-1)[0];
                const draw      = report.draw[0];

                const headerBg =
                  isAnchor   ? "bg-primary/10 border-primary/30" :
                  isAligned  ? "bg-[hsl(var(--bullish))]/8 border-[hsl(var(--bullish))]/20" :
                               "bg-yellow-500/8 border-yellow-500/20";

                return (
                  <div key={tf} className={`rounded-sm border ${headerBg} overflow-hidden`}>
                    {/* TF header */}
                    <div className={`px-3 py-2 flex items-center justify-between border-b ${headerBg}`}>
                      <div className="flex items-center gap-2">
                        {isAnchor && <span className="text-[10px] text-primary">⚓</span>}
                        <span className="text-xs font-bold">{TF_LABELS[tf] ?? tf.toUpperCase()}</span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{role}</span>
                        {!isAligned && tf !== anchorTf && (
                          <span className="text-[10px] text-yellow-400 font-bold">⚠ Counter-trend</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <BiasChip bias={bias} />
                      </div>
                    </div>

                    {/* TF body */}
                    <div className="px-3 py-2.5 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
                      <div>
                        <span className="text-muted-foreground">Structure: </span>
                        <span className={bias === "bullish" ? "text-[hsl(var(--bullish))]" : bias === "bearish" ? "text-destructive" : "text-primary"}>
                          {report.structure.trend.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Confidence: </span>
                        <span className="text-foreground">{conf}%</span>
                      </div>
                      {lastBreak && (
                        <div>
                          <span className="text-muted-foreground">Last break: </span>
                          <span className={lastBreak.direction === "bullish" ? "text-[hsl(var(--bullish))]" : "text-destructive"}>
                            {lastBreak.type} {lastBreak.direction === "bullish" ? "▲" : "▼"}
                          </span>
                        </div>
                      )}
                      {draw && (
                        <div>
                          <span className="text-muted-foreground">Draw target: </span>
                          <span className={draw.direction === "long" ? "text-[hsl(var(--bullish))]" : "text-destructive"}>
                            {fmtPrice(draw.price, market)}
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Active OBs: </span>
                        <span className="text-foreground">{liveOBs.length}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Open FVGs: </span>
                        <span className="text-foreground">{fvgs.length}</span>
                      </div>
                      {report.liquidity.nearestBSL && (
                        <div>
                          <span className="text-muted-foreground">BSL: </span>
                          <span className="text-[hsl(var(--bullish))]">{fmtPrice(report.liquidity.nearestBSL.price, market)}</span>
                        </div>
                      )}
                      {report.liquidity.nearestSSL && (
                        <div>
                          <span className="text-muted-foreground">SSL: </span>
                          <span className="text-destructive">{fmtPrice(report.liquidity.nearestSSL.price, market)}</span>
                        </div>
                      )}
                    </div>
                    <div className="px-3 pb-2">
                      <ConfBar value={conf} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* 3. Trade Setup (multi-TF synthesized) */}
          {setup ? (
            <Section title="Trade Setup Summary" icon={Target}>
              <div className={`rounded-sm border p-4 space-y-4 ${
                setup.direction === "long"  ? "border-[hsl(var(--bullish))]/30 bg-[hsl(var(--bullish))]/5" :
                setup.direction === "short" ? "border-destructive/30 bg-destructive/5" :
                "border-border bg-muted/10"
              }`}>

                {/* Direction + Grade */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {setup.direction === "long"  ? <TrendingUp className="w-4 h-4 text-[hsl(var(--bullish))]" /> :
                     setup.direction === "short" ? <TrendingDown className="w-4 h-4 text-destructive" /> : null}
                    <span className={`text-sm font-bold uppercase ${
                      setup.direction === "long" ? "text-[hsl(var(--bullish))]" : "text-destructive"
                    }`}>
                      {setup.direction === "long" ? "▲ LONG" : "▼ SHORT"}
                    </span>
                  </div>
                  <span className={`text-xs px-3 py-1 rounded-sm font-bold border ${
                    setup.grade === "A" ? "bg-[hsl(var(--bullish))]/20 border-[hsl(var(--bullish))]/40 text-[hsl(var(--bullish))]" :
                    setup.grade === "B" ? "bg-primary/20 border-primary/40 text-primary" :
                    setup.grade === "C" ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-400" :
                    "bg-muted border-border text-muted-foreground"
                  }`}>
                    {setup.grade === "wait" ? "WAIT FOR SETUP" : `GRADE ${setup.grade}`}
                  </span>
                </div>

                {/* Entry zone */}
                {setup.entryLow !== null && setup.entryHigh !== null && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Entry Zone · {setup.entrySource}
                    </p>
                    <p className="text-sm font-bold">
                      {fmtPrice(setup.entryLow, market)}
                      <span className="text-muted-foreground mx-2">→</span>
                      {fmtPrice(setup.entryHigh, market)}
                    </p>
                  </div>
                )}

                {/* SL / TP grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Stop Loss</p>
                    <p className="text-xs font-bold text-destructive">
                      {setup.stopLoss ? fmtPrice(setup.stopLoss, market) : "—"}
                    </p>
                    {setup.slSource && <p className="text-[9px] text-muted-foreground mt-0.5">{setup.slSource}</p>}
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                      TP1 · {setup.tp1 ? TF_LABELS[setup.confirmTf] : "—"}
                    </p>
                    <p className="text-xs font-bold text-[hsl(var(--bullish))]">
                      {setup.tp1 ? fmtPrice(setup.tp1.price, market) : "—"}
                    </p>
                    {setup.tp1 && <p className="text-[9px] text-muted-foreground mt-0.5">{setup.tp1.type}</p>}
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                      TP2 · {setup.tp2 ? TF_LABELS[setup.anchorTf] : "—"}
                    </p>
                    <p className="text-xs font-bold text-[hsl(var(--bullish))]">
                      {setup.tp2 ? fmtPrice(setup.tp2.price, market) : "—"}
                    </p>
                    {setup.tp2 && <p className="text-[9px] text-muted-foreground mt-0.5">{setup.tp2.type}</p>}
                  </div>
                </div>

                {/* R:R */}
                {setup.rrRatio !== null && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">R:R Ratio</span>
                    <span className={`text-sm font-bold ${
                      setup.rrRatio >= 2 ? "text-[hsl(var(--bullish))]" :
                      setup.rrRatio >= 1 ? "text-primary" : "text-destructive"
                    }`}>1 : {setup.rrRatio.toFixed(2)}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {setup.rrRatio >= 2 ? "Excellent" : setup.rrRatio >= 1.5 ? "Good" : setup.rrRatio >= 1 ? "Acceptable" : "Poor"}
                    </span>
                  </div>
                )}
              </div>
            </Section>
          ) : (
            <Section title="Trade Setup Summary" icon={Target}>
              <p className="text-xs text-muted-foreground">No directional setup — mixed or neutral conditions across TFs.</p>
            </Section>
          )}

          {/* 4. Multi-TF Confluence Checklist */}
          {setup && (
            <Section title="Confluence Checklist" icon={Zap}>
              <div className="space-y-2">
                {setup.checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <div className={`w-5 h-5 rounded-sm flex items-center justify-center shrink-0 border ${
                      item.pass
                        ? "bg-[hsl(var(--bullish))]/15 border-[hsl(var(--bullish))]/30"
                        : "bg-muted border-border"
                    }`}>
                      {item.pass
                        ? <Check className="w-3 h-3 text-[hsl(var(--bullish))]" />
                        : <AlertTriangle className="w-3 h-3 text-muted-foreground" />
                      }
                    </div>
                    <span className={`text-xs ${item.pass ? "text-foreground" : "text-muted-foreground"}`}>
                      {item.label}
                    </span>
                  </div>
                ))}

                <div className="pt-2 border-t border-border/40 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{setup.passCount} / {setup.checklist.length} checks passed</span>
                  <span className={`text-xs font-bold ${
                    setup.grade === "A" ? "text-[hsl(var(--bullish))]" :
                    setup.grade === "B" ? "text-primary" :
                    setup.grade === "C" ? "text-yellow-400" : "text-muted-foreground"
                  }`}>
                    {setup.grade === "wait" ? "Wait — insufficient confluence" : `Grade ${setup.grade} Setup`}
                  </span>
                </div>
              </div>
            </Section>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-border bg-card/60 flex items-center justify-between gap-3">
          <p className="text-[10px] text-muted-foreground">
            Synthesized from {sortedReports.length} timeframes · anchor {TF_LABELS[anchorTf] ?? anchorTf}
          </p>
          {setup && (
            <button
              onClick={copyPlan}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm border border-border bg-muted hover:bg-muted/80 text-foreground transition-colors"
            >
              {copied ? <ClipboardCheck className="w-3.5 h-3.5 text-[hsl(var(--bullish))]" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy Plan"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
