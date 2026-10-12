import type { Candle, Pattern } from "./types";

const SHORT_MA = 25;
const TREND_MA = 50;

const sma = (candles: Candle[], endIdx: number, period: number): number => {
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) sum += candles[i].close;
  return sum / period;
};

export const pullbackToMa: Pattern = {
  name: "pullback_to_ma",
  minCandles: TREND_MA + 1,
  matches: (candles: Candle[], idx: number): boolean => {
    if (idx < TREND_MA) return false;
    const today = candles[idx];
    if (today.close <= today.open) return false;
    const trendMa = sma(candles, idx, TREND_MA);
    if (today.close <= trendMa) return false;
    const shortMa = sma(candles, idx, SHORT_MA);
    return today.low <= shortMa && shortMa <= today.high;
  },
};
