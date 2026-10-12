import type { Candle, Pattern } from "./types";

const PERIOD = 14;
const OVERSOLD = 30;

const rsi = (candles: Candle[], endIdx: number, period: number): number => {
  let gain = 0;
  let loss = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

export const oversoldReversal: Pattern = {
  name: "oversold_reversal",
  minCandles: PERIOD + 2,
  matches: (candles: Candle[], idx: number): boolean => {
    if (idx < PERIOD + 1) return false;
    const today = candles[idx];
    if (today.close <= today.open) return false;
    const value = rsi(candles, idx, PERIOD);
    return value < OVERSOLD;
  },
};
