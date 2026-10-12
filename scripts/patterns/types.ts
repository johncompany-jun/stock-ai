export type Candle = {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Pattern = {
  name: string;
  minCandles: number;
  matches: (candles: Candle[], idx: number) => boolean;
};
