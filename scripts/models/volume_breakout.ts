import type { ModelDef } from "./types";

export type VolumeBreakoutOptions = {
  short?: number;
  long?: number;
  maxAbsReturnPct?: number;
  minVolRatio?: number;
};

const avg = (arr: number[], start: number, endExclusive: number): number => {
  if (endExclusive <= start) return 0;
  let s = 0;
  for (let i = start; i < endExclusive; i++) s += arr[i];
  return s / (endExclusive - start);
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const createVolumeBreakoutModel = (opts: VolumeBreakoutOptions = {}): ModelDef => {
  const SHORT = opts.short ?? 5;
  const LONG = opts.long ?? 25;
  const MAX_ABS_RETURN = opts.maxAbsReturnPct ?? 10;
  const MIN_VOL_RATIO = opts.minVolRatio ?? 1.2;

  const predict = async (
    closes: number[],
    volumes: number[],
    horizon: number,
  ): Promise<number[]> => {
    const n = closes.length;
    const lastClose = closes[n - 1];

    const recentVol = avg(volumes, n - SHORT, n);
    const baseVol = avg(volumes, n - LONG, n - SHORT);
    const volRatio = baseVol > 0 ? recentVol / baseVol : 1;

    const priorClose = closes[n - SHORT - 1] ?? closes[0];
    const priceChangePct = ((lastClose - priorClose) / priorClose) * 100;

    let returnPct = 0;
    if (volRatio >= MIN_VOL_RATIO && Math.abs(priceChangePct) > 0.1) {
      const signal = clamp(Math.log2(volRatio), 0, 2);
      returnPct = clamp((priceChangePct * signal) / 2, -MAX_ABS_RETURN, MAX_ABS_RETURN);
    }

    const targetClose = lastClose * (1 + returnPct / 100);
    const preds: number[] = [];
    for (let i = 1; i <= horizon; i++) {
      const t = i / horizon;
      preds.push(lastClose + (targetClose - lastClose) * t);
    }
    return preds;
  };

  return { name: "volume_breakout_v1", minCandles: LONG + 5, predict };
};
