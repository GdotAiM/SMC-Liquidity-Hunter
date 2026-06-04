export const SMC_CONFIG = {
  atrPeriod: 14,
  pivotLookback: 5,
  minTouches: 2,
  equalLevelThreshold: 0.001,

  obRequireFvg: true,
  fvgMinBodyRatio: 0.5,

  volumeSpikeMin: {
    crypto: 1.5,
    forex: 0,
  } as Record<string, number>,

  liquidityHalfLifeBars: {
    "1h": 200,
    "4h": 200,
    "1d": 200,
  } as Record<string, number>,

  sessionWeights: {
    asia: 1.3,
    london: 1.2,
    newYork: 1.2,
    overlap: 1.5,
    offHours: 0.8,
  },

  smaPeriod: 20,

  obLookForward: 3,

  maxCandles: 300,
  maxDailyCandles: 60,
};
