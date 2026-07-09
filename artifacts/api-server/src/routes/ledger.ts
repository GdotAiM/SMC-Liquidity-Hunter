import { Router, type IRouter } from "express";
import { TradeLedgerService } from "../lib/services/TradeLedgerService.js";
import { PerformanceMatrixService } from "../lib/services/PerformanceMatrixService.js";
import {
  ExecutionManager,
  MockBrokerAdapter,
} from "../lib/execution/BrokerAbstraction.js";
import { AlpacaAdapter } from "../lib/execution/AlpacaAdapter.js";
import { SignalGenerator } from "../lib/services/SignalGenerator.js";
import { fetchBinanceCandles } from "../lib/fetchers/binance.js";
import { fetchYahooCandles } from "../lib/fetchers/yahoo.js";
import { buildReport } from "../lib/smc/report.js";

const router: IRouter = Router();
const ledgerService = new TradeLedgerService();
const matrixService = new PerformanceMatrixService();
// Pick broker: Alpaca paper trading if credentials are set, otherwise mock.
// This is evaluated once at module load — restart the server after setting keys.
const brokerAdapter =
  process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY
    ? new AlpacaAdapter()
    : new MockBrokerAdapter();
const executionManager = new ExecutionManager(brokerAdapter, "REVIEW");
const signalGenerator = new SignalGenerator();

// Whether a Postgres database is configured. When false, the read-only ledger
// and performance-matrix endpoints return empty shapes (and the frontend shows
// its "no data yet" empty states) instead of throwing 500s. This keeps the
// Analytics page demoable without a provisioned database — the SMC engine, AI
// agents, and chart do not depend on the DB.
const dbConfigured = !!process.env.DATABASE_URL;

// ─── GET /api/ledger — Query signals ──────────────────────────────────────────

router.get("/ledger", async (req, res) => {
  if (!dbConfigured) {
    res.json({ signals: [], metrics: matrixService.calculateMetrics([]) });
    return;
  }
  try {
    const { asset, setup, symbol, mode, limit } = req.query;

    const signals = await ledgerService.querySignals({
      asset: asset as string | undefined,
      setup: setup as string | undefined,
      symbol: symbol as string | undefined,
      mode: mode as string | undefined,
      limit: limit ? parseInt(limit as string) : 50,
    });

    // Calculate aggregate metrics
    const metrics = matrixService.calculateMetrics(signals);

    res.json({ signals, metrics });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/ledger/pending — Signals awaiting outcome ───────────────────────

router.get("/ledger/pending", async (_req, res) => {
  if (!dbConfigured) {
    res.json({ signals: [] });
    return;
  }
  try {
    const signals = await ledgerService.getPendingSignals();
    res.json({ signals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/performance-matrix — Matrix data ────────────────────────────────

router.get("/performance-matrix", async (req, res) => {
  if (!dbConfigured) {
    res.json([]);
    return;
  }
  try {
    const { asset, detailed } = req.query;

    const matrix = await matrixService.queryMatrix({
      asset: asset as string | undefined,
      detailed: detailed === "true",
    });

    res.json(matrix);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/signals/generate — Generate signals from live SMC analysis ─────

router.post("/signals/generate", async (req, res) => {
  try {
    const { symbol, market, timeframe, style } = req.body;

    if (!symbol || !market) {
      res.status(400).json({ error: "symbol and market are required" });
      return;
    }

    const tf = timeframe || "1h";
    const mkt = market as "crypto" | "forex";

    // Fetch live candles
    const candles =
      mkt === "crypto"
        ? await fetchBinanceCandles(symbol as string, tf)
        : await fetchYahooCandles(symbol as string, tf);

    // Run SMC analysis
    const report = buildReport(candles, symbol as string, mkt, tf);

    // Generate signal
    const signal = signalGenerator.generateFromReport(report, mkt, {
      source: "API_GENERATED",
    });

    if (!signal) {
      res.json({ signals: [], message: "No valid trade setup detected" });
      return;
    }

    // Log to ledger — best-effort. If no DB is configured (demo without
    // Postgres), still return the generated signal so the UI can display it.
    if (dbConfigured) {
      try {
        await ledgerService.logSignal(signal, "REVIEW");
      } catch (logErr) {
        req.log.warn({ err: logErr }, "ledger logging failed — returning signal anyway");
      }
    }

    res.json({ signals: [signal] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/signals/execute — Execute signal through broker ─────────────────
// Uses the server's current execution mode (set via POST /api/broker/mode).
// The mode is NOT accepted from the request body — this prevents any caller
// from silently flipping the server to LIVE mode.

router.post("/signals/execute", async (req, res) => {
  try {
    const { signal } = req.body;

    if (!signal) {
      res.status(400).json({ error: "signal is required" });
      return;
    }

    const result = await executionManager.executeSignal(signal);

    // Log to ledger
    await ledgerService.logSignal(
      signal,
      executionManager.getMode(),
      result.order_id
    );

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/broker/mode — Set execution mode ──────────────────────────────
// Switching to LIVE requires { confirm: "LIVE" } as intentional friction.
// Switching to REVIEW is always immediate (kill-switch path).

router.post("/broker/mode", (req, res) => {
  try {
    const { mode, confirm } = req.body as {
      mode?: string;
      confirm?: string;
    };

    if (!mode || (mode !== "REVIEW" && mode !== "LIVE")) {
      res.status(400).json({ error: "mode must be REVIEW or LIVE" });
      return;
    }

    if (mode === "LIVE") {
      if (confirm !== "LIVE") {
        res.status(400).json({
          error: "Switching to LIVE requires { confirm: \"LIVE\" } in the request body",
        });
        return;
      }
    }

    executionManager.setMode(mode);
    res.json({ mode: executionManager.getMode() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/broker/status — Broker connection + mode status ────────────────

router.get("/broker/status", (_req, res) => {
  try {
    const broker = executionManager.getBroker();
    res.json({
      broker_name: broker.name,
      is_ready: broker.isReady,
      mode: executionManager.getMode(),
      is_paper: true, // hardcoded — AlpacaAdapter is paper-only
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/account — Broker account status ────────────────────────────────

router.get("/account", async (_req, res) => {
  try {
    const status = await executionManager.getAccountStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/performance-matrix/rebuild — Trigger full matrix rebuild ───────

router.post("/performance-matrix/rebuild", async (_req, res) => {
  try {
    const count = await matrixService.rebuildFullMatrix();
    res.json({ message: `Performance matrix rebuilt`, combinations: count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
