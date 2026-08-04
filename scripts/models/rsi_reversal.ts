import type { ModelDef } from "./types";

export type RsiReversalOptions = {
  period?: number;
  oversold?: number;
  overbought?: number;
  reversalReturnPct?: number;
};

const rsi = (closes: number[], period: number): number => {
  const n = closes.length;
  let gain = 0;
  let loss = 0;
  for (let i = n - period; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

export const createRsiReversalModel = (opts: RsiReversalOptions = {}): ModelDef => {
  const PERIOD = opts.period ?? 14;
  const OVERSOLD = opts.oversold ?? 30;
  const OVERBOUGHT = opts.overbought ?? 70;
  const REVERSAL = opts.reversalReturnPct ?? 5;

  const predict = async (closes: number[], horizon: number): Promise<number[]> => {
    const value = rsi(closes, PERIOD);
    const lastClose = closes[closes.length - 1];

    let returnPct: number;
    if (value <= OVERSOLD) {
      returnPct = REVERSAL * ((OVERSOLD - value) / OVERSOLD);
    } else if (value >= OVERBOUGHT) {
      returnPct = -REVERSAL * ((value - OVERBOUGHT) / (100 - OVERBOUGHT));
    } else {
      returnPct = 0;
    }
    const targetClose = lastClose * (1 + returnPct / 100);

    const preds: number[] = [];
    for (let i = 1; i <= horizon; i++) {
      const t = i / horizon;
      preds.push(lastClose + (targetClose - lastClose) * t);
    }
    return preds;
  };

  return { name: "rsi_reversal_v1", minCandles: PERIOD + 5, predict };
};
