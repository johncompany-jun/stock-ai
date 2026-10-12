import type { Candle, Pattern } from "./types";

const LOOKBACK = 20;
const VOL_RATIO = 2.0;

export const volumeSurgeBreakout: Pattern = {
  name: "volume_surge_breakout",
  minCandles: LOOKBACK + 1,
  matches: (candles: Candle[], idx: number): boolean => {
    if (idx < LOOKBACK) return false;
    const today = candles[idx];
    let volSum = 0;
    let maxHigh = -Infinity;
    for (let i = idx - LOOKBACK; i < idx; i++) {
      volSum += candles[i].volume;
      if (candles[i].high > maxHigh) maxHigh = candles[i].high;
    }
    const avgVol = volSum / LOOKBACK;
    if (avgVol <= 0) return false;
    return today.volume >= avgVol * VOL_RATIO && today.close > maxHigh;
  },
};
