import { fetchYahooCandles, fetchYahooDailyCandles } from "./yahoo.js";
import type { Candle } from "../smc/types.js";

const BINANCE_TO_YAHOO: Record<string, string> = {
  BTCUSDT: "BTC-USD",
  ETHUSDT: "ETH-USD",
  SOLUSDT: "SOL-USD",
  BNBUSDT: "BNB-USD",
  XRPUSDT: "XRP-USD",
  ADAUSDT: "ADA-USD",
  DOGEUSDT: "DOGE-USD",
  AVAXUSDT: "AVAX-USD",
  DOTUSDT: "DOT-USD",
  LINKUSDT: "LINK-USD",
  MATICUSDT: "MATIC-USD",
  LTCUSDT: "LTC-USD",
  UNIUSDT: "UNI7083-USD",
  ATOMUSDT: "ATOM-USD",
};

function toYahooSymbol(symbol: string): string {
  return BINANCE_TO_YAHOO[symbol.toUpperCase()] ?? `${symbol.replace(/USDT$/i, "")}-USD`;
}

export async function fetchBinanceCandles(symbol: string, timeframe: string): Promise<Candle[]> {
  return fetchYahooCandles(toYahooSymbol(symbol), timeframe);
}

export async function fetchBinanceDailyCandles(symbol: string): Promise<Candle[]> {
  return fetchYahooDailyCandles(toYahooSymbol(symbol));
}
