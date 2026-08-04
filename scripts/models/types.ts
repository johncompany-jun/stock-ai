export type PredictFn = (
  closes: number[],
  volumes: number[],
  horizon: number,
) => Promise<number[]>;

export type ModelDef = {
  name: string;
  minCandles: number;
  predict: PredictFn;
};
