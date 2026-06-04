import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/symbols", async (_req, res): Promise<void> => {
  res.json({
    crypto: [
      { symbol: "BTCUSDT", label: "BTC/USDT", market: "crypto", correlatedSymbol: "ETHUSDT" },
      { symbol: "ETHUSDT", label: "ETH/USDT", market: "crypto", correlatedSymbol: "BTCUSDT" },
      { symbol: "SOLUSDT", label: "SOL/USDT", market: "crypto", correlatedSymbol: "BTCUSDT" },
      { symbol: "BNBUSDT", label: "BNB/USDT", market: "crypto", correlatedSymbol: "BTCUSDT" },
      { symbol: "XRPUSDT", label: "XRP/USDT", market: "crypto", correlatedSymbol: "BTCUSDT" },
      { symbol: "ADAUSDT", label: "ADA/USDT", market: "crypto", correlatedSymbol: "BTCUSDT" },
      { symbol: "DOGEUSDT", label: "DOGE/USDT", market: "crypto", correlatedSymbol: "BTCUSDT" },
      { symbol: "AVAXUSDT", label: "AVAX/USDT", market: "crypto", correlatedSymbol: "ETHUSDT" },
      { symbol: "DOTUSDT", label: "DOT/USDT", market: "crypto", correlatedSymbol: "BTCUSDT" },
      { symbol: "LINKUSDT", label: "LINK/USDT", market: "crypto", correlatedSymbol: "ETHUSDT" },
    ],
    forex: [
      { symbol: "EURUSD=X", label: "EUR/USD", market: "forex", correlatedSymbol: "GBPUSD=X" },
      { symbol: "GBPUSD=X", label: "GBP/USD", market: "forex", correlatedSymbol: "EURUSD=X" },
      { symbol: "USDJPY=X", label: "USD/JPY", market: "forex", correlatedSymbol: "EURJPY=X" },
      { symbol: "AUDUSD=X", label: "AUD/USD", market: "forex", correlatedSymbol: "NZDUSD=X" },
      { symbol: "USDCAD=X", label: "USD/CAD", market: "forex", correlatedSymbol: "EURUSD=X" },
      { symbol: "USDCHF=X", label: "USD/CHF", market: "forex", correlatedSymbol: "EURUSD=X" },
      { symbol: "NZDUSD=X", label: "NZD/USD", market: "forex", correlatedSymbol: "AUDUSD=X" },
      { symbol: "EURJPY=X", label: "EUR/JPY", market: "forex", correlatedSymbol: "GBPJPY=X" },
      { symbol: "GBPJPY=X", label: "GBP/JPY", market: "forex", correlatedSymbol: "EURJPY=X" },
      { symbol: "XAUUSD=X", label: "XAU/USD (Gold)", market: "forex", correlatedSymbol: "EURUSD=X" },
    ],
  });
});

export default router;
