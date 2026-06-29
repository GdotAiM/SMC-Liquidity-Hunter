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
  /** ICT market phase inferred from BOS/CHoCH patterns */
  phase: "accumulation" | "manipulation" | "expansion" | "distribution" | "continuation" | "unknown";
  /** Human-readable structure narrative */
  narrative: string;
  /** Evidence bullets that explain the bias/confidence */
  evidence: string[];
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
  /** 0–1 probability this pool will be swept in the near future */
  probabilityOfSweep: number;
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
  /** 0–1 institutional confidence in this OB */
  confidence: number;
  /** Factors that drove confidence up or down */
  confidenceFactors: string[];
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
  /** Evidence bullets explaining the daily bias */
  evidence: string[];
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
  /** Confluence factors that raised this target's ranking */
  evidence: string[];
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
  /** Full market narrative for AI agents and UI display */
  narrative: string;
  /** Current session state e.g. "London Expansion Bullish" */
  sessionState: string;
}

export type Market = "crypto" | "forex";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
