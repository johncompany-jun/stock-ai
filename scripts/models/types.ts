export type PredictFn = (closes: number[], horizon: number) => Promise<number[]>;

export type ModelDef = {
  name: string;
  minCandles: number;
  predict: PredictFn;
};
