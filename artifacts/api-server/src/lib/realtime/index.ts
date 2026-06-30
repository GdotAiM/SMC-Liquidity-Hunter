export { binanceWs } from "./binance-ws.js";
export { forexWs } from "./forex-ws.js";
export { candleStore } from "./candle-store.js";
export type { CandleUpdate, CandleSnapshot } from "./candle-store.js";
export { sseManager } from "./sse-manager.js";
// Side-effect import: wires candleClosed events → SMC engine → cache → SSE broadcast
import "./analysis-bridge.js";
