import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as tf from "@tensorflow/tfjs";

const { values } = parseArgs({
  options: {
    codes: { type: "string" },
    limit: { type: "string" },
    horizon: { type: "string", default: "21" },
    window: { type: "string", default: "30" },
    epochs: { type: "string", default: "20" },
    units: { type: "string", default: "16" },
    days: { type: "string", default: "365" },
    chunk: { type: "string", default: "200" },
    out: { type: "string", default: "data/seed_predictions.sql" },
    apply: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});

const HORIZON = Number(values.horizon);
const WINDOW = Number(values.window);
const EPOCHS = Number(values.epochs);
const UNITS = Number(values.units);
const DAYS = Number(values.days);
const CHUNK = Number(values.chunk);
const OUT_PATH = resolve(process.cwd(), values.out!);
const DB_NAME = "stock-ai";

const findSqlitePath = (): string => {
  const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  if (!files.length) throw new Error(`no sqlite file in ${dir}`);
  // 複数ある場合はサイズ最大 = データが入っているものを選ぶ
  const withSize = files.map((f) => ({ f, size: statSync(`${dir}/${f}`).size }));
  withSize.sort((a, b) => b.size - a.size);
  return `${dir}/${withSize[0].f}`;
};

const toYyyymmdd = (d: Date): number =>
  d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

const minMaxNormalize = (values: number[]): { values: number[]; min: number; max: number } => {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  return { values: values.map((v) => (v - min) / span), min, max };
};

const trainAndPredict = async (
  normalized: number[],
  horizon: number,
): Promise<number[]> => {
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

type PredictionRow = {
  code: string;
  runAt: number;
  lastDate: number;
  lastClose: number;
  predictedClose: number;
  expectedReturnPct: number;
  preds: number[];
};

const writeSql = (rows: PredictionRow[]) => {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const vals = slice
      .map(
        (r) =>
          `('${r.code}',${r.runAt},${r.lastDate},${r.lastClose},${HORIZON},${r.predictedClose},${r.expectedReturnPct},'${JSON.stringify(r.preds)}')`,
      )
      .join(",\n");
    chunks.push(
      `INSERT OR REPLACE INTO predictions (code,run_at,last_date,last_close,horizon_days,predicted_close,expected_return_pct,preds_json) VALUES\n${vals};`,
    );
  }
  writeFileSync(OUT_PATH, chunks.join("\n\n") + "\n", "utf8");
  console.log(`wrote: ${OUT_PATH} (${rows.length} rows)`);
};

const applySql = () => {
  const remoteFlag = values.remote ? "--remote" : "--local";
  const res = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DB_NAME, remoteFlag, "--file", OUT_PATH],
    { encoding: "utf8", stdio: "inherit", maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error("apply failed");
};

const main = async () => {
  await tf.setBackend("cpu");
  await tf.ready();
  console.log(`tfjs backend: ${tf.getBackend()}`);

  const sqlitePath = findSqlitePath();
  console.log(`sqlite: ${sqlitePath}`);
  const db = new Database(sqlitePath);

  const requestedCodes = values.codes
    ? values.codes.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  let codes: string[];
  if (requestedCodes) {
    codes = requestedCodes;
  } else {
    codes = (db.query("SELECT code FROM stocks ORDER BY code").all() as { code: string }[]).map(
      (r) => r.code,
    );
  }
  if (values.limit) codes = codes.slice(0, Number(values.limit));

  const sinceDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const since = toYyyymmdd(sinceDate);
  console.log(`codes: ${codes.length}, window=${WINDOW}, horizon=${HORIZON}, since=${since}`);

  const candleStmt = db.query(
    "SELECT date, close FROM candles WHERE code = ? AND date >= ? ORDER BY date ASC",
  );

  const runAt = Math.floor(Date.now() / 1000);
  const results: PredictionRow[] = [];
  let done = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const t0 = Date.now();
  const minRows = WINDOW + 10;

  for (const code of codes) {
    const candles = candleStmt.all(code, since) as { date: number; close: number }[];
    if (candles.length < minRows) {
      skipped++;
      done++;
      continue;
    }
    try {
      const closes = candles.map((c) => c.close);
      const norm = minMaxNormalize(closes);
      const rawPreds = await trainAndPredict(norm.values, HORIZON);
      const span = norm.max - norm.min || 1;
      const preds = rawPreds.map((v) => v * span + norm.min);
      const lastClose = closes[closes.length - 1];
      const predictedClose = preds[preds.length - 1];
      const expectedReturnPct = ((predictedClose - lastClose) / lastClose) * 100;
      results.push({
        code,
        runAt,
        lastDate: candles[candles.length - 1].date,
        lastClose,
        predictedClose,
        expectedReturnPct,
        preds,
      });
      ok++;
    } catch (e) {
      failed++;
      console.warn(`  ${code}: ${(e as Error).message}`);
    }
    done++;

    if (done % 10 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = done / elapsed;
      const eta = (codes.length - done) / rate;
      console.log(
        `  ${done}/${codes.length}  ok=${ok} skip=${skipped} fail=${failed}  ${rate.toFixed(2)}/s  eta=${Math.round(eta)}s`,
      );
    }

    if (results.length >= CHUNK) {
      writeSql(results);
      if (values.apply) applySql();
      results.length = 0;
    }
  }

  if (results.length > 0) {
    writeSql(results);
    if (values.apply) applySql();
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(
    `done: ${done}/${codes.length}  ok=${ok} skip=${skipped} fail=${failed}  in ${elapsed.toFixed(1)}s`,
  );

  db.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
