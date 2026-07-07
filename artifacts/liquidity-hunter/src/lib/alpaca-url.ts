/**
 * Map Binance-style crypto symbols to the Alpaca TradingView chart URL.
 * The paper trading URL is always used (AlpacaAdapter is paper-only).
 */

const ALPACA_SYMBOL_MAP: Record<string, string> = {
  BTCUSDT: "BTC/USD",
  BTCUSD: "BTC/USD",
  ETHUSDT: "ETH/USD",
  ETHUSD: "ETH/USD",
  SOLUSDT: "SOL/USD",
  SOLUSD: "SOL/USD",
  BNBUSDT: "BNB/USD",
  BNBUSD: "BNB/USD",
  XRPUSDT: "XRP/USD",
  XRPUSD: "XRP/USD",
  ADAUSDT: "ADA/USD",
  ADAUSD: "ADA/USD",
  DOGEUSDT: "DOGE/USD",
  DOGEUSD: "DOGE/USD",
};

/** Map a Binance-style symbol to Alpaca's format, or null if unmapped. */
export function toAlpacaSymbol(symbol: string): string | null {
  return ALPACA_SYMBOL_MAP[symbol.toUpperCase()] ?? null;
}

/** Build the Alpaca paper TradingView chart URL for a given symbol. */
export function alpacaChartUrl(symbol: string): string | null {
  const alpacaSymbol = toAlpacaSymbol(symbol);
  if (!alpacaSymbol) return null;
  return `https://app.alpaca.markets/trade/${alpacaSymbol}`;
}
