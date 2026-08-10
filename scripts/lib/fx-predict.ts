import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as tf from "@tensorflow/tfjs";

export type Features = {
  date: string;
  entry_price: number;
  morning_trend_bps: number | null;
  ny_delta_pips: number | null;
  gotoubi_flag: number;
  dow: number;
};

export type KnnRow = {
  date: string;
  entry_price: number;
  morning_trend_bps: number | null;
  ny_delta_pips: number | null;
  gotoubi_flag: number;
  dow: number;
  features: number[];
  pnl_long: number;
  pnl_short: number;
};

export type NeighborRow = KnnRow & { distance: number };

export type PredictResult = {
  pair: string;
  date: string;
  features: Features;
  direction: "LONG" | "SHORT";
  probability: number;
  confidence: number;
  seeds: number;
  neighbors: NeighborRow[];
  longWins: number;
  shortWins: number;
  avgLong: number;
  avgShort: number;
  historySize: number;
};

type Bar = { ts: number; o: number; h: number; l: number; c: number };

export type CandleSource = {
  fetchWindow: (pair: string, from: number, to: number) => Promise<Bar[]>;
  fetchBar: (pair: string, ts: number) => Promise<Bar | null>;
};

const D1_ROOT = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
export const findLocalDb = (): string => {
  const files = readdirSync(D1_ROOT).filter((f) => f.endsWith(".sqlite"));
  if (files.length === 0) throw new Error("no local D1 sqlite");
  return resolve(D1_ROOT, files[0]);
};

export const localCandleSource = (dbPath?: string): CandleSource => {
  const path = dbPath ?? findLocalDb();
  return {
    fetchWindow: async (pair, from, to) => {
      const db = new Database(path, { readonly: true });
      try {
        return db
          .query<Bar, [string, number, number]>(
            "SELECT timestamp_utc AS ts, open AS o, high AS h, low AS l, close AS c FROM fx_candles WHERE pair = ? AND timestamp_utc BETWEEN ? AND ? ORDER BY timestamp_utc",
          )
          .all(pair, from, to);
      } finally {
        db.close();
      }
    },
    fetchBar: async (pair, ts) => {
      const db = new Database(path, { readonly: true });
      try {
        return (
          db
            .query<Bar, [string, number]>(
              "SELECT timestamp_utc AS ts, open AS o, high AS h, low AS l, close AS c FROM fx_candles WHERE pair = ? AND timestamp_utc = ?",
            )
            .get(pair, ts) ?? null
        );
      } finally {
        db.close();
      }
    },
  };
};

const D1_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
type D1QueryResponse = {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: Array<{ results: Array<Record<string, unknown>>; success: boolean }>;
};

export const remoteCandleSource = (config: {
  accountId: string;
  databaseId: string;
  apiToken: string;
}): CandleSource => {
  const url = `${D1_API_BASE}/${config.accountId}/d1/database/${config.databaseId}/query`;
  const query = async (sql: string, params: Array<string | number>): Promise<Array<Record<string, unknown>>> => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params: params.map((p) => (typeof p === "number" ? String(p) : p)) }),
    });
    if (!res.ok) throw new Error(`D1 query failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as D1QueryResponse;
    if (!json.success) throw new Error(`D1 query error: ${JSON.stringify(json.errors)}`);
    return json.result?.[0]?.results ?? [];
  };
  const toBar = (r: Record<string, unknown>): Bar => ({
    ts: Number(r.ts),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
  });
  return {
    fetchWindow: async (pair, from, to) => {
      const rows = await query(
        "SELECT timestamp_utc AS ts, open AS o, high AS h, low AS l, close AS c FROM fx_candles WHERE pair = ? AND timestamp_utc BETWEEN ? AND ? ORDER BY timestamp_utc",
        [pair, from, to],
      );
      return rows.map(toBar);
    },
    fetchBar: async (pair, ts) => {
      const rows = await query(
        "SELECT timestamp_utc AS ts, open AS o, high AS h, low AS l, close AS c FROM fx_candles WHERE pair = ? AND timestamp_utc = ?",
        [pair, ts],
      );
      return rows[0] ? toBar(rows[0]) : null;
    },
  };
};

export const todayJstDate = (): string => {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}`;
};

export const jstDateStrParts = (s: string): [number, number, number] => {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
};

export const jstDateToEntryUtcSec = (y: number, m1: number, d: number): number => {
  const jstMidnightUtc = Date.UTC(y, m1 - 1, d) - 9 * 3600 * 1000;
  return Math.floor((jstMidnightUtc + 8.5 * 3600 * 1000) / 1000);
};

export const dowFromJst = (y: number, m1: number, d: number): number => {
  const utc = new Date(Date.UTC(y, m1 - 1, d));
  return ((utc.getUTCDay() + 6) % 7) + 1;
};

export const isGotoubi = (y: number, m1: number, d: number): boolean => {
  if ([5, 10, 15, 20, 25].includes(d)) return true;
  const dt = new Date(Date.UTC(y, m1 - 1, d));
  const next = new Date(Date.UTC(y, m1 - 1, d + 1));
  return next.getUTCMonth() !== dt.getUTCMonth();
};

export const dowLabel = (dow: number): string => ["", "月", "火", "水", "木", "金", "土", "日"][dow] ?? "";

export const computeFeatures = async (
  source: CandleSource,
  pair: string,
  date: string,
): Promise<Features | null> => {
  const [y, m1, d] = jstDateStrParts(date);
  const entryTs = jstDateToEntryUtcSec(y, m1, d);
  const winStart = entryTs - 90 * 60;
  const winEnd = entryTs + 5 * 60;

  const bars = await source.fetchWindow(pair, winStart, winEnd);
  const byTs = new Map<number, Bar>();
  for (const b of bars) byTs.set(b.ts, b);

  const entryBar = byTs.get(entryTs);
  if (!entryBar) return null;
  const entryPrice = entryBar.o;

  const morningStartBar = byTs.get(winStart);
  const morningEndBar = byTs.get(entryTs - 60);
  const morningTrendBps =
    morningStartBar && morningEndBar && morningStartBar.o > 0
      ? ((morningEndBar.c - morningStartBar.o) / morningStartBar.o) * 10000
      : null;

  let prev: number | null = null;
  for (let back = 1; back <= 7; back++) {
    const prevDate = new Date(Date.UTC(y, m1 - 1, d - back));
    const py = prevDate.getUTCFullYear();
    const pm = prevDate.getUTCMonth() + 1;
    const pd = prevDate.getUTCDate();
    if (dowFromJst(py, pm, pd) > 5) continue;
    const pBar = await source.fetchBar(pair, jstDateToEntryUtcSec(py, pm, pd));
    if (pBar) {
      prev = pBar.o;
      break;
    }
  }

  return {
    date,
    entry_price: entryPrice,
    morning_trend_bps: morningTrendBps,
    ny_delta_pips: prev !== null ? (entryPrice - prev) * 100 : null,
    gotoubi_flag: isGotoubi(y, m1, d) ? 1 : 0,
    dow: dowFromJst(y, m1, d),
  };
};

export const featurize = (
  mt: number | null,
  nd: number | null,
  gotoubi: number,
  dow: number,
  mean: [number, number],
  std: [number, number],
): number[] => [
  ((mt ?? 0) - mean[0]) / std[0],
  ((nd ?? 0) - mean[1]) / std[1],
  gotoubi,
  dow === 1 ? 1 : 0,
  dow === 2 ? 1 : 0,
  dow === 3 ? 1 : 0,
  dow === 4 ? 1 : 0,
  dow === 5 ? 1 : 0,
];

const loadSeedModel = async (modelDir: string, seedIdx: number): Promise<tf.LayersModel> => {
  const raw = JSON.parse(readFileSync(`${modelDir}/seed_${seedIdx}.json`, "utf8"));
  const b64 = Buffer.from(raw.weightData, "base64");
  const ab = b64.buffer.slice(b64.byteOffset, b64.byteOffset + b64.byteLength);
  return tf.loadLayersModel(
    tf.io.fromMemory({
      modelTopology: raw.modelTopology,
      weightSpecs: raw.weightSpecs,
      weightData: ab,
    }),
  );
};

export const predict = async (opts: {
  pair: string;
  date: string;
  modelDir: string;
  k: number;
  source: CandleSource;
}): Promise<PredictResult> => {
  const f = await computeFeatures(opts.source, opts.pair, opts.date);
  if (!f) throw new Error(`no entry bar for ${opts.pair} @ ${opts.date} 8:30 JST (update fx_candles first)`);

  const norm = JSON.parse(readFileSync(`${opts.modelDir}/normalization.json`, "utf8")) as {
    mtMean: number;
    mtStd: number;
    ndMean: number;
    ndStd: number;
  };
  const mean: [number, number] = [norm.mtMean, norm.ndMean];
  const std: [number, number] = [norm.mtStd, norm.ndStd];
  const inputVec = featurize(f.morning_trend_bps, f.ny_delta_pips, f.gotoubi_flag, f.dow, mean, std);

  const meta = JSON.parse(readFileSync(`${opts.modelDir}/meta.json`, "utf8")) as { seeds: number };
  let probSum = 0;
  for (let s = 0; s < meta.seeds; s++) {
    const model = await loadSeedModel(opts.modelDir, s);
    const t = tf.tensor2d([inputVec]);
    const pred = model.predict(t) as tf.Tensor;
    probSum += (await pred.data())[0];
    pred.dispose();
    t.dispose();
    model.dispose();
  }
  const prob = probSum / meta.seeds;
  const direction: "LONG" | "SHORT" = prob >= 0.5 ? "LONG" : "SHORT";
  const confidence = direction === "LONG" ? prob : 1 - prob;

  const historyAll = JSON.parse(readFileSync(`${opts.modelDir}/features.json`, "utf8")) as KnnRow[];
  const history = historyAll.filter((h) => h.date !== opts.date);
  const dist = (a: number[], b: number[]) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s);
  };
  const neighbors: NeighborRow[] = history
    .map((h) => ({ ...h, distance: dist(inputVec, h.features) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, opts.k);

  const longWins = neighbors.filter((n) => n.pnl_long > 0).length;
  const shortWins = neighbors.filter((n) => n.pnl_short > 0).length;
  const avgLong = neighbors.reduce((a, b) => a + b.pnl_long, 0) / neighbors.length;
  const avgShort = neighbors.reduce((a, b) => a + b.pnl_short, 0) / neighbors.length;

  return {
    pair: opts.pair,
    date: opts.date,
    features: f,
    direction,
    probability: prob,
    confidence,
    seeds: meta.seeds,
    neighbors,
    longWins,
    shortWins,
    avgLong,
    avgShort,
    historySize: historyAll.length,
  };
};
