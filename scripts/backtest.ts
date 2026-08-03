import { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import * as tf from "@tensorflow/tfjs";

const { values } = parseArgs({
  options: {
    stocks: { type: "string", default: "20" },
    dates: { type: "string", default: "20" },
    markets: { type: "string", default: "東S,東G" },
    horizons: { type: "string", default: "5,10,20,40" },
    window: { type: "string", default: "30" },
    epochs: { type: "string", default: "20" },
    units: { type: "string", default: "16" },
    minRange: { type: "string", default: "0.2" },
    lookbackYears: { type: "string", default: "3" },
    model: { type: "string", default: "lstm_v1" },
    seed: { type: "string", default: "42" },
    trainCandles: { type: "string", default: "250" },
    dryRun: { type: "boolean", default: false },
  },
});

const N_STOCKS = Number(values.stocks);
const N_DATES = Number(values.dates);
const MARKETS = values.markets!.split(",").map((s) => s.trim());
const HORIZONS = values.horizons!.split(",").map((s) => Number(s.trim())).sort((a, b) => a - b);
const MAX_HORIZON = HORIZONS[HORIZONS.length - 1];
const WINDOW = Number(values.window);
const EPOCHS = Number(values.epochs);
const UNITS = Number(values.units);
const MIN_RANGE = Number(values.minRange);
const LOOKBACK_YEARS = Number(values.lookbackYears);
const MODEL_NAME = values.model!;
const SEED = Number(values.seed);
const TRAIN_CANDLES = Number(values.trainCandles);

const findSqlitePath = (): string => {
  const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  if (!files.length) throw new Error(`no sqlite file in ${dir}`);
  const withSize = files.map((f) => ({ f, size: statSync(`${dir}/${f}`).size }));
  withSize.sort((a, b) => b.size - a.size);
  return `${dir}/${withSize[0].f}`;
};

const toYyyymmdd = (d: Date): number =>
  d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

const mulberry32 = (a: number) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shuffle = <T>(arr: T[], rng: () => number): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const trainAndPredict = async (normalized: number[], horizon: number): Promise<number[]> => {
  const xs: number[][][] = [];
  const ys: number[][] = [];
  for (let i = 0; i <= normalized.length - WINDOW - 1; i++) {
    xs.push(normalized.slice(i, i + WINDOW).map((v) => [v]));
    ys.push([normalized[i + WINDOW]]);
  }
  const xsT = tf.tensor3d(xs, [xs.length, WINDOW, 1]);
  const ysT = tf.tensor2d(ys, [ys.length, 1]);

  const model = tf.sequential({
    layers: [
      tf.layers.lstm({ units: UNITS, inputShape: [WINDOW, 1] }),
      tf.layers.dense({ units: 1 }),
    ],
  });
  model.compile({ optimizer: tf.train.adam(0.01), loss: "meanSquaredError" });
  await model.fit(xsT, ysT, { epochs: EPOCHS, batchSize: 32, shuffle: true, verbose: 0 });

  const window = normalized.slice(-WINDOW);
  const preds: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const input = tf.tensor3d([window.map((v) => [v])], [1, WINDOW, 1]);
    const p = model.predict(input) as tf.Tensor;
    const val = (await p.data())[0];
    preds.push(val);
    window.shift();
    window.push(val);
    input.dispose();
    p.dispose();
  }
  xsT.dispose();
  ysT.dispose();
  model.dispose();
  return preds;
};

const pickEvenIndexes = (start: number, endExclusive: number, n: number): number[] => {
  if (endExclusive - start <= 0) return [];
  if (endExclusive - start <= n) {
    const out: number[] = [];
    for (let i = start; i < endExclusive; i++) out.push(i);
    return out;
  }
  const step = (endExclusive - 1 - start) / (n - 1);
  const idxs: number[] = [];
  for (let i = 0; i < n; i++) idxs.push(Math.round(start + i * step));
  return Array.from(new Set(idxs));
};

const main = async () => {
  await tf.setBackend("cpu");
  await tf.ready();
  console.log(`tfjs backend: ${tf.getBackend()}`);
  console.log(`config: stocks=${N_STOCKS} dates=${N_DATES} horizons=[${HORIZONS.join(",")}] markets=[${MARKETS.join(",")}] minRange=${MIN_RANGE}`);

  const sqlitePath = findSqlitePath();
  console.log(`sqlite: ${sqlitePath}`);
  const db = new Database(sqlitePath);

  const sinceDate = new Date(Date.now() - LOOKBACK_YEARS * 365 * 24 * 60 * 60 * 1000);
  const sinceYmd = toYyyymmdd(sinceDate);

  const marketPlaceholders = MARKETS.map(() => "?").join(",");
  const candidates = db
    .query(
      `SELECT s.code
       FROM stocks s
       JOIN (
         SELECT code, MAX(close) AS max_c, MIN(close) AS min_c
         FROM candles WHERE date >= ? AND close > 0
         GROUP BY code
       ) c ON c.code = s.code
       WHERE s.market IN (${marketPlaceholders})
         AND c.max_c / c.min_c >= ?`,
    )
    .all(sinceYmd, ...MARKETS, 1 + MIN_RANGE) as { code: string }[];
  console.log(`candidates (markets=${MARKETS.join(",")}, range>=${(MIN_RANGE * 100).toFixed(0)}%): ${candidates.length}`);

  const rng = mulberry32(SEED);
  const codes = shuffle(candidates.map((c) => c.code), rng).slice(0, N_STOCKS);
  console.log(`selected ${codes.length} codes: ${codes.slice(0, 10).join(",")}${codes.length > 10 ? "..." : ""}`);

  const candleStmt = db.query(
    "SELECT date, close FROM candles WHERE code = ? AND close > 0 ORDER BY date ASC",
  );
  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO prediction_log
     (code, run_date, horizon_days, model_name, last_close, predicted_close, actual_close, error_pct, direction_hit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const minTrainRows = Math.max(WINDOW + 10, TRAIN_CANDLES);
  let totalRuns = 0;
  let totalInserts = 0;
  let skippedStocks = 0;
  const t0 = Date.now();

  for (let ci = 0; ci < codes.length; ci++) {
    const code = codes[ci];
    const candles = candleStmt.all(code) as { date: number; close: number }[];
    const total = candles.length;
    const earliestRunIdx = minTrainRows - 1;
    const latestRunIdx = total - MAX_HORIZON - 1;
    if (latestRunIdx < earliestRunIdx) {
      console.log(`  [${ci + 1}/${codes.length}] ${code}: skip (only ${total} candles)`);
      skippedStocks++;
      continue;
    }
    const runIdxs = pickEvenIndexes(earliestRunIdx, latestRunIdx + 1, N_DATES);
    console.log(`  [${ci + 1}/${codes.length}] ${code}: ${total} candles, ${runIdxs.length} run_dates`);

    for (const runIdx of runIdxs) {
      const runDate = candles[runIdx].date;
      const lastClose = candles[runIdx].close;
      const trainStart = Math.max(0, runIdx + 1 - TRAIN_CANDLES);
      const trainCloses = candles.slice(trainStart, runIdx + 1).map((c) => c.close);

      let min = Infinity;
      let max = -Infinity;
      for (const v of trainCloses) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const span = max - min || 1;
      const normalized = trainCloses.map((v) => (v - min) / span);

      let preds: number[];
      try {
        const raw = await trainAndPredict(normalized, MAX_HORIZON);
        preds = raw.map((v) => v * span + min);
      } catch (e) {
        console.warn(`    runDate=${runDate}: train failed: ${(e as Error).message}`);
        continue;
      }
      totalRuns++;

      const rowsToInsert: Array<[string, number, number, string, number, number, number, number, number]> = [];
      for (const h of HORIZONS) {
        const predictedClose = preds[h - 1];
        const actualIdx = runIdx + h;
        const actualClose = candles[actualIdx]?.close;
        if (actualClose == null) continue;
        const errorPct = ((predictedClose - actualClose) / actualClose) * 100;
        const predDir = Math.sign(predictedClose - lastClose);
        const actDir = Math.sign(actualClose - lastClose);
        const directionHit = predDir !== 0 && predDir === actDir ? 1 : 0;
        rowsToInsert.push([
          code,
          runDate,
          h,
          MODEL_NAME,
          lastClose,
          predictedClose,
          actualClose,
          errorPct,
          directionHit,
        ]);
      }
      if (!values.dryRun) {
        const tx = db.transaction(() => {
          for (const r of rowsToInsert) insertStmt.run(...r);
        });
        tx();
      }
      totalInserts += rowsToInsert.length;
    }

    const elapsed = (Date.now() - t0) / 1000;
    const rate = totalRuns / elapsed;
    const remainStocks = codes.length - (ci + 1);
    const eta = remainStocks * N_DATES / (rate || 1);
    console.log(`    progress: runs=${totalRuns} inserts=${totalInserts}  ${rate.toFixed(2)} run/s  eta=${Math.round(eta)}s`);
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(
    `\ndone: stocks_ok=${codes.length - skippedStocks} skipped=${skippedStocks}  training_runs=${totalRuns}  inserts=${totalInserts}  in ${elapsed.toFixed(1)}s`,
  );
  db.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
