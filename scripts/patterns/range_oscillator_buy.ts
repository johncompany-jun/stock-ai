import type { Candle, Pattern } from "./types";

const RANGE_WINDOW = 90;
const DRIFT_WINDOW = 252;
const MIN_AMPLITUDE = 0.15;
const MAX_DRIFT = 0.15;
const BUY_POSITION = 0.3;

export const rangeOscillatorBuy: Pattern = {
  name: "range_oscillator_buy",
  minCandles: DRIFT_WINDOW + 1,
  matches: (candles: Candle[], idx: number): boolean => {
    if (idx < DRIFT_WINDOW) return false;
    const today = candles[idx];
    if (today.close <= today.open) return false;

    let hi = -Infinity;
    let lo = Infinity;
    for (let i = idx - RANGE_WINDOW; i < idx; i++) {
      const c = candles[i].close;
      if (c > hi) hi = c;
      if (c < lo) lo = c;
    }
    if (lo <= 0) return false;
    const amplitude = (hi - lo) / lo;
    if (amplitude < MIN_AMPLITUDE) return false;

    const priceYearAgo = candles[idx - DRIFT_WINDOW].close;
    if (priceYearAgo <= 0) return false;
    const drift = Math.abs(today.close - priceYearAgo) / priceYearAgo;
    if (drift > MAX_DRIFT) return false;

    const position = (today.close - lo) / (hi - lo);
    return position <= BUY_POSITION;
  },
};
