import type { ModelDef } from "./types";

export type SmaCrossOptions = {
  short?: number;
  long?: number;
  maxAbsReturnPct?: number;
};

const sma = (values: number[], period: number, endIdx: number): number => {
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) sum += values[i];
  return sum / period;
};

export const createSmaCrossModel = (opts: SmaCrossOptions = {}): ModelDef => {
  const SHORT = opts.short ?? 5;
  const LONG = opts.long ?? 25;
  const MAX_ABS_RETURN = opts.maxAbsReturnPct ?? 10;

  const predict = async (closes: number[], _volumes: number[], horizon: number): Promise<number[]> => {
    const n = closes.length;
    const lastIdx = n - 1;
    const smaShort = sma(closes, SHORT, lastIdx);
    const smaLong = sma(closes, LONG, lastIdx);
    const lastClose = closes[lastIdx];

    const gapPct = ((smaShort - smaLong) / smaLong) * 100;
    const scaled = Math.max(-MAX_ABS_RETURN, Math.min(MAX_ABS_RETURN, gapPct * 2));
    const targetClose = lastClose * (1 + scaled / 100);

    const preds: number[] = [];
    for (let i = 1; i <= horizon; i++) {
      const t = i / horizon;
      preds.push(lastClose + (targetClose - lastClose) * t);
    }
    return preds;
  };

  return { name: "sma_cross_v1", minCandles: LONG + 5, predict };
};
