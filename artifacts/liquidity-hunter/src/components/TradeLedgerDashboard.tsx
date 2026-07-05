import { useState, useEffect, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ───

interface TradeRecord {
  id: string;
  symbol: string;
  asset_class: string;
  setup_type: string;
  setup_subtype: string;
  confidence_score: number;
  entry_price: string;
  stop_loss: string;
  take_profit: string;
  execution_mode: string;
  outcome: {
    win: boolean;
    pnl: number;
    exit_reason: string;
  } | null;
  created_at: string;
  risk_reward_ratio: string;
}

interface Metrics {
  win_rate: number;
  sharpe_ratio: number;
  profit_factor: number;
}

interface SetupRanking {
  setup_type: string;
  symbol: string;
  sharpe_ratio: string;
  win_rate: string;
  profit_factor: string;
  trials: number;
}

// ─── Metric Card ───

function MetricCard({
  title,
  value,
  suffix,
  color,
}: {
  title: string;
  value: string;
  suffix?: string;
  color?: "green" | "red" | "yellow";
}) {
  const colorMap = {
    green: "text-[hsl(var(--bullish))]",
    red: "text-destructive",
    yellow: "text-yellow-500",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color ? colorMap[color] : ""}`}>
          {value}
          {suffix && <span className="text-sm ml-1">{suffix}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Setup Ranking Chart (simple bar using divs) ───

function SetupRankingBars({ data }: { data: SetupRanking[] }) {
  const maxSharpe = Math.max(...data.map((d) => parseFloat(d.sharpe_ratio)), 0.1);

  return (
    <div className="space-y-2">
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">
            {item.setup_type}
          </span>
          <div className="flex-1 h-5 bg-muted rounded-sm overflow-hidden relative">
            <div
              className="h-full bg-primary/60 rounded-sm transition-all"
              style={{
                width: `${Math.min(100, (parseFloat(item.sharpe_ratio) / maxSharpe) * 100)}%`,
              }}
            />
            <span className="absolute inset-0 flex items-center px-2 text-[10px] font-mono">
              Sharpe: {parseFloat(item.sharpe_ratio).toFixed(2)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground w-16 text-right">
            {item.trials} trades
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Dashboard ───

export function TradeLedgerDashboard() {
  const [signals, setSignals] = useState<TradeRecord[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [rankings, setRankings] = useState<Record<string, SetupRanking[]>>({});
  const [assetFilter, setAssetFilter] = useState("ALL");
  const [setupFilter, setSetupFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (assetFilter !== "ALL") params.append("asset", assetFilter);
      if (setupFilter !== "ALL") params.append("setup", setupFilter);

      const res = await fetch(`/api/ledger?${params}`);
      const data = await res.json();
      setSignals(data.signals || []);
      setMetrics(data.metrics || null);
    } catch (err) {
      console.error("Failed to fetch ledger:", err);
    } finally {
      setLoading(false);
    }
  }, [assetFilter, setupFilter]);

  const fetchRankings = useCallback(async () => {
    try {
      const assets = ["STOCK", "FOREX", "CRYPTO"];
      const results: Record<string, SetupRanking[]> = {};
      for (const asset of assets) {
        const res = await fetch(`/api/performance-matrix?asset=${asset}`);
        const data = await res.json();
        results[asset] = data;
      }
      setRankings(results);
    } catch (err) {
      console.error("Failed to fetch rankings:", err);
    }
  }, []);

  useEffect(() => {
    fetchLedger();
    fetchRankings();
  }, [fetchLedger, fetchRankings]);

  const columns = [
    {
      key: "symbol",
      header: "Symbol",
      render: (r: TradeRecord) => (
        <span className="font-mono font-medium">{r.symbol}</span>
      ),
    },
    {
      key: "setup",
      header: "Setup",
      render: (r: TradeRecord) => (
        <Badge variant="secondary" className="font-mono text-xs">
          {r.setup_type}
        </Badge>
      ),
    },
    {
      key: "confidence",
      header: "Conf",
      render: (r: TradeRecord) => {
        const score = r.confidence_score;
        return (
          <Badge
            variant={score > 70 ? "default" : score > 50 ? "secondary" : "outline"}
          >
            {score}%
          </Badge>
        );
      },
    },
    {
      key: "entry",
      header: "Entry",
      render: (r: TradeRecord) => (
        <span className="font-mono text-xs">
          ${parseFloat(r.entry_price).toFixed(2)}
        </span>
      ),
    },
    {
      key: "rr",
      header: "R:R",
      render: (r: TradeRecord) => (
        <span className="font-mono text-xs">
          {parseFloat(r.risk_reward_ratio || "0").toFixed(1)}:1
        </span>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (r: TradeRecord) => {
        if (!r.outcome)
          return <Badge variant="outline">PENDING</Badge>;
        const pnl = r.outcome.pnl?.toFixed(2) ?? "0";
        return (
          <Badge
            variant={r.outcome.win ? "default" : "destructive"}
            className={r.outcome.win ? "bg-[hsl(var(--bullish))]" : ""}
          >
            {r.outcome.win ? "WIN" : "LOSS"} ({pnl})
          </Badge>
        );
      },
    },
    {
      key: "mode",
      header: "Mode",
      render: (r: TradeRecord) => (
        <Badge variant="outline" className="text-[10px]">
          {r.execution_mode}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex gap-3">
        <Select value={assetFilter} onValueChange={setAssetFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by Asset" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Assets</SelectItem>
            <SelectItem value="STOCK">Stocks</SelectItem>
            <SelectItem value="FOREX">Forex</SelectItem>
            <SelectItem value="CRYPTO">Crypto</SelectItem>
          </SelectContent>
        </Select>

        <Select value={setupFilter} onValueChange={setSetupFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by Setup" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Setups</SelectItem>
            <SelectItem value="FVG">FVG</SelectItem>
            <SelectItem value="OB">Order Blocks</SelectItem>
            <SelectItem value="CHoCH">CHoCH</SelectItem>
            <SelectItem value="BOS">BOS</SelectItem>
            <SelectItem value="LIQUIDITY_SWEEP">Liquidity Sweep</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Metrics Row */}
      {metrics ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            title="Win Rate"
            value={`${(metrics.win_rate * 100).toFixed(1)}`}
            suffix="%"
            color={metrics.win_rate > 0.55 ? "green" : "red"}
          />
          <MetricCard
            title="Sharpe Ratio"
            value={metrics.sharpe_ratio.toFixed(2)}
            color={
              metrics.sharpe_ratio > 1.0
                ? "green"
                : metrics.sharpe_ratio > 0
                  ? "yellow"
                  : "red"
            }
          />
          <MetricCard
            title="Profit Factor"
            value={metrics.profit_factor.toFixed(2)}
            color={metrics.profit_factor > 1.5 ? "green" : "yellow"}
          />
          <MetricCard
            title="Total Trades"
            value={signals.length.toString()}
          />
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Signal Ledger Table */}
      <Card>
        <CardHeader>
          <CardTitle>Signal Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col.key}>{col.header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="text-center text-muted-foreground py-8"
                    >
                      No signals yet. Run a backtest or generate signals to see
                      data here.
                    </TableCell>
                  </TableRow>
                ) : (
                  signals.map((signal) => (
                    <TableRow key={signal.id}>
                      {columns.map((col) => (
                        <TableCell key={col.key}>
                          {col.render(signal)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Setup Performance Ranking by Asset */}
      <Card>
        <CardHeader>
          <CardTitle>Setup Performance by Asset</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="STOCK">
            <TabsList>
              <TabsTrigger value="STOCK">Stocks</TabsTrigger>
              <TabsTrigger value="FOREX">Forex</TabsTrigger>
              <TabsTrigger value="CRYPTO">Crypto</TabsTrigger>
            </TabsList>
            {(["STOCK", "FOREX", "CRYPTO"] as const).map((asset) => (
              <TabsContent key={asset} value={asset} className="pt-4">
                {rankings[asset]?.length > 0 ? (
                  <SetupRankingBars data={rankings[asset]} />
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No performance data yet for {asset.toLowerCase()} setups.
                  </p>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
