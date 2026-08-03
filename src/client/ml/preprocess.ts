export type Candle = {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose: number | null;
};

export type Normalized = {
  values: number[];
  min: number;
  max: number;
};

export const extractCloses = (candles: Candle[]): number[] =>
  candles.map((c) => c.close);

export const minMaxNormalize = (values: number[]): Normalized => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return {
    values: values.map((v) => (v - min) / span),
    min,
    max,
  };
};

export const denormalize = (normalized: number[], min: number, max: number): number[] => {
  const span = max - min || 1;
  return normalized.map((v) => v * span + min);
};

export const formatDate = (yyyymmdd: number): string => {
  const s = String(yyyymmdd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

export const nextBusinessDates = (fromYmd: number, count: number): string[] => {
  const s = String(fromYmd);
  const d = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
  const out: string[] = [];
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${dd}`);
  }
  return out;
};
