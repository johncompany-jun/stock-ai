import type { Candle, Pattern } from "./types";

const VOL_LOOKBACK = 20;
const GAP_PCT = 2.0;
const VOL_RATIO = 2.0;

export const gapDownReversal: Pattern = {
  name: "gap_down_reversal",
  minCandles: VOL_LOOKBACK + 1,
  matches: (candles: Candle[], idx: number): boolean => {
    if (idx < VOL_LOOKBACK) return false;
    const today = candles[idx];
    const prev = candles[idx - 1];
    if (today.open >= prev.close * (1 - GAP_PCT / 100)) return false;
    if (today.close <= today.open) return false;
    let volSum = 0;
    for (let i = idx - VOL_LOOKBACK; i < idx; i++) volSum += candles[i].volume;
    const avgVol = volSum / VOL_LOOKBACK;
    if (avgVol <= 0) return false;
    return today.volume >= avgVol * VOL_RATIO;
  },
};
