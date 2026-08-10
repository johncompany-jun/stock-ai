import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import * as tf from "@tensorflow/tfjs";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    date: { type: "string" },
    k: { type: "string", default: "10" },
    modelDir: { type: "string", default: "data/fx/model" },
  },
});

const PAIR = values.pair.toUpperCase();
const K = Number(values.k);
const MODEL_DIR = resolve(process.cwd(), values.modelDir);

const D1_ROOT = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const findLocalDb = () => {
  const files = readdirSync(D1_ROOT).filter((f) => f.endsWith(".sqlite"));
  if (files.length === 0) throw new Error("no local D1 sqlite");
  return resolve(D1_ROOT, files[0]);
};

const todayJstDate = (): string => {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 3600 * 1000;
  const jst = new Date(jstMs);
  const y = jst.getUTCFullYear();
  const m1 = jst.getUTCMonth() + 1;
  const d = jst.getUTCDate();
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const jstDateStrParts = (s: string): [number, number, number] => {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
};

const jstDateToEntryUtcSec = (y: number, m1: number, d: number): number => {
  const jstMidnightUtc = Date.UTC(y, m1 - 1, d) - 9 * 3600 * 1000;
  return Math.floor((jstMidnightUtc + 8.5 * 3600 * 1000) / 1000);
};

const dowFromJst = (y: number, m1: number, d: number): number => {
  const utc = new Date(Date.UTC(y, m1 - 1, d));
  return ((utc.getUTCDay() + 6) % 7) + 1; // Mon=1..Sun=7
};

const isGotoubi = (y: number, m1: number, d: number): boolean => {
  if ([5, 10, 15, 20, 25].includes(d)) return true;
  const dt = new Date(Date.UTC(y, m1 - 1, d));
  const next = new Date(Date.UTC(y, m1 - 1, d + 1));
  return next.getUTCMonth() !== dt.getUTCMonth();
};

const dowLabel = (dow: number): string => ["", "月", "火", "水", "木", "金", "土", "日"][dow] ?? "";

type Bar = { o: number; h: number; l: number; c: number };

type Features = {
  date: string;
  entry_price: number;
  morning_trend_bps: number | null;
  ny_delta_pips: number | null;
  gotoubi_flag: number;
  dow: number;
};

const computeFeatures = (db: Database, date: string): Features | null => {
  const [y, m1, d] = jstDateStrParts(date);
  const entryTs = jstDateToEntryUtcSec(y, m1, d);
  const winStart = entryTs - 90 * 60;
  const winEnd = entryTs + 5 * 60;

  const bars = db
    .query<{ ts: number; o: number; h: number; l: number; c: number }, [string, number, number]>(
      "SELECT timestamp_utc AS ts, open AS o, high AS h, low AS l, close AS c FROM fx_candles WHERE pair = ? AND timestamp_utc BETWEEN ? AND ? ORDER BY timestamp_utc",
    )
    .all(PAIR, winStart, winEnd);

  const byTs = new Map<number, Bar>();
  for (const b of bars) byTs.set(b.ts, { o: b.o, h: b.h, l: b.l, c: b.c });

  const entryBar = byTs.get(entryTs);
  if (!entryBar) return null;
  const entryPrice = entryBar.o;

  const morningStartBar = byTs.get(winStart);
  const morningEndBar = byTs.get(entryTs - 60);
  const morningTrendBps =
    morningStartBar && morningEndBar && morningStartBar.o > 0
      ? ((morningEndBar.c - morningStartBar.o) / morningStartBar.o) * 10000
      : null;

  // Prev trading day entry price — walk back up to 7 days
  let prev: number | null = null;
  for (let back = 1; back <= 7; back++) {
    const prevDate = new Date(Date.UTC(y, m1 - 1, d - back));
    const py = prevDate.getUTCFullYear();
    const pm = prevDate.getUTCMonth() + 1;
    const pd = prevDate.getUTCDate();
    const pDow = dowFromJst(py, pm, pd);
    if (pDow > 5) continue;
    const pEntryTs = jstDateToEntryUtcSec(py, pm, pd);
    const pRow = db
      .query<{ o: number }, [string, number]>(
        "SELECT open AS o FROM fx_candles WHERE pair = ? AND timestamp_utc = ?",
      )
      .get(PAIR, pEntryTs);
    if (pRow) {
      prev = pRow.o;
      break;
    }
  }
  const nyDeltaPips = prev !== null ? (entryPrice - prev) * 100 : null;

  return {
    date,
    entry_price: entryPrice,
    morning_trend_bps: morningTrendBps,
    ny_delta_pips: nyDeltaPips,
    gotoubi_flag: isGotoubi(y, m1, d) ? 1 : 0,
    dow: dowFromJst(y, m1, d),
  };
};

const featurize = (
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

const loadSeedModel = async (seedIdx: number): Promise<tf.LayersModel> => {
  const raw = JSON.parse(readFileSync(`${MODEL_DIR}/seed_${seedIdx}.json`, "utf8"));
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

type KnnRow = {
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

const main = async () => {
  const date = values.date ?? todayJstDate();
  const [y, m1, d] = jstDateStrParts(date);
  const dow = dowFromJst(y, m1, d);
  if (dow > 5) {
    console.error(`skip: ${date} (${dowLabel(dow)}) は週末`);
    process.exit(1);
  }

  const db = new Database(findLocalDb(), { readonly: true });
  const f = computeFeatures(db, date);
  db.close();
  if (!f) {
    console.error(`error: ${date} 8:30 JST の候補データが不足しています (fx_candles を更新してから再実行)`);
    process.exit(2);
  }

  const norm = JSON.parse(readFileSync(`${MODEL_DIR}/normalization.json`, "utf8")) as {
    mtMean: number;
    mtStd: number;
    ndMean: number;
    ndStd: number;
  };
  const mean: [number, number] = [norm.mtMean, norm.ndMean];
  const std: [number, number] = [norm.mtStd, norm.ndStd];

  const inputVec = featurize(f.morning_trend_bps, f.ny_delta_pips, f.gotoubi_flag, f.dow, mean, std);

  // MLP ensemble
  const meta = JSON.parse(readFileSync(`${MODEL_DIR}/meta.json`, "utf8")) as { seeds: number };
  let probSum = 0;
  for (let s = 0; s < meta.seeds; s++) {
    const model = await loadSeedModel(s);
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

  // kNN in normalized feature space (exclude same date if it appears)
  const historyAll = JSON.parse(readFileSync(`${MODEL_DIR}/features.json`, "utf8")) as KnnRow[];
  const history = historyAll.filter((h) => h.date !== date);
  const dist = (a: number[], b: number[]) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s);
  };
  const scored = history
    .map((h) => ({ h, d: dist(inputVec, h.features) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, K);

  const longWins = scored.filter((s) => s.h.pnl_long > 0).length;
  const shortWins = scored.filter((s) => s.h.pnl_short > 0).length;
  const avgLong = scored.reduce((a, b) => a + b.h.pnl_long, 0) / scored.length;
  const avgShort = scored.reduce((a, b) => a + b.h.pnl_short, 0) / scored.length;

  // ---- output ----
  console.log(`=== FX シグナル [${PAIR}]  ${date} (${dowLabel(dow)})  8:30 JST ===\n`);
  console.log(`エントリー参考価格: ${f.entry_price.toFixed(3)}`);
  console.log(`今朝の状況:`);
  console.log(`  NY 変化 (前日8:30比):     ${f.ny_delta_pips !== null ? (f.ny_delta_pips >= 0 ? "+" : "") + f.ny_delta_pips.toFixed(1) + "p" : "N/A"}`);
  console.log(`  朝のトレンド (7:00→8:29): ${f.morning_trend_bps !== null ? (f.morning_trend_bps >= 0 ? "+" : "") + f.morning_trend_bps.toFixed(1) + "bps" : "N/A"}`);
  console.log(`  ゴトー日:                 ${f.gotoubi_flag ? "はい" : "いいえ"}`);
  console.log("");
  console.log(`[モデル判定 — 5-seed ensemble]`);
  console.log(`  方向: ${direction}`);
  console.log(`  確信度: ${(confidence * 100).toFixed(1)}%  (raw prob=${prob.toFixed(3)})`);
  console.log("");
  console.log(`[過去 ${historyAll.length} 営業日で今朝と似ていた日 上位 ${K} 件]`);
  console.log(`  #   date         mt        nd       曜  ゴ  LONG      SHORT`);
  for (let i = 0; i < scored.length; i++) {
    const h = scored[i].h;
    const mt = h.morning_trend_bps !== null ? (h.morning_trend_bps >= 0 ? "+" : "") + h.morning_trend_bps.toFixed(1) : "N/A";
    const nd = h.ny_delta_pips !== null ? (h.ny_delta_pips >= 0 ? "+" : "") + h.ny_delta_pips.toFixed(1) + "p" : "N/A";
    const lp = (h.pnl_long >= 0 ? "+" : "") + h.pnl_long.toFixed(1) + "p";
    const sp = (h.pnl_short >= 0 ? "+" : "") + h.pnl_short.toFixed(1) + "p";
    console.log(
      `  ${String(i + 1).padStart(2)}  ${h.date}  ${mt.padStart(7)}b  ${nd.padStart(8)}  ${dowLabel(h.dow)}   ${h.gotoubi_flag ? "○" : "-"}  ${lp.padStart(8)}  ${sp.padStart(8)}`,
    );
  }
  console.log("");
  console.log(`  → LONG 勝ち: ${longWins}/${K} (${((longWins / K) * 100).toFixed(0)}%)  平均 ${avgLong >= 0 ? "+" : ""}${avgLong.toFixed(1)}p`);
  console.log(`  → SHORT 勝ち: ${shortWins}/${K} (${((shortWins / K) * 100).toFixed(0)}%)  平均 ${avgShort >= 0 ? "+" : ""}${avgShort.toFixed(1)}p`);
  console.log("");
  console.log(`推奨: ${direction}  (最終判断は上の類似日パターンをご確認ください)`);
};

await main();
