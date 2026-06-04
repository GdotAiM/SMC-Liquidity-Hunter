export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StructurePoint {
  index: number;
  price: number;
  type: "HH" | "HL" | "LH" | "LL";
  confirmed: boolean;
  time: number;
}

export interface StructureBreak {
  index: number;
  price: number;
  type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  time: number;
}

export interface StructureResult {
  trend: "bullish" | "bearish" | "ranging";
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  pivots: StructurePoint[];
  breaks: StructureBreak[];
}

export interface LiquidityPool {
  price: number;
  type: "BSL" | "SSL" | "EQH" | "EQL";
  score: number;
  touches: number;
  wasSwept: boolean;
  sweptAt: number | null;
  time: number;
  index: number;
  session: string | null;
}

export interface LiquidityResult {
  pools: LiquidityPool[];
  nearestBSL: LiquidityPool | null;
  nearestSSL: LiquidityPool | null;
}

export interface OrderBlock {
  type: "bullish" | "bearish";
  proximal: number;
  distal: number;
  time: number;
  index: number;
  valid: boolean;
  isMitigated: boolean;
  isBreaker: boolean;
  strength: number;
  hasFvg: boolean;
}

export interface FairValueGap {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  time: number;
  index: number;
  fillFraction: number;
  isInversion: boolean;
}

export interface DealingRange {
  high: number;
  low: number;
  timeframe: string;
}

export interface PdZone {
  label: string;
  top: number;
  bottom: number;
  timeframe: string;
  type: "premium" | "discount" | "equilibrium";
}

export interface PdArrayResult {
  currentBias: "premium" | "discount" | "equilibrium";
  zones: PdZone[];
  dealingRange: DealingRange;
  equilibrium: number;
}

export interface DailyBiasResult {
  bias: "bullish" | "bearish" | "neutral";
  strength: number;
  consecutiveDays: number;
  referencedSwing: string | null;
}

export interface SmtDivergence {
  detected: boolean;
  type: "bearish_smt" | "bullish_smt" | null;
  confidence: number;
  time: number | null;
  primarySymbol: string | null;
  correlatedSymbol: string | null;
}

export interface DrawTarget {
  price: number;
  type: string;
  score: number;
  direction: "long" | "short";
  label: string;
}

export interface SmcReport {
  symbol: string;
  market: "crypto" | "forex";
  timeframe: string;
  currentPrice: number;
  generatedAt: number;
  candles: Candle[];
  structure: StructureResult;
  liquidity: LiquidityResult;
  orderBlocks: OrderBlock[];
  fvg: FairValueGap[];
  pdArray: PdArrayResult;
  dailyBias: DailyBiasResult;
  smt: SmtDivergence;
  draw: DrawTarget[];
}

export type Market = "crypto" | "forex";
export type Timeframe = "1h" | "4h" | "1d";
