import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as tf from "@tensorflow/tfjs";
import { ALL_MODEL_KEYS, buildModel, type ModelKey } from "./models";

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
    sourceUrl: { type: "string" },
    out: { type: "string" },
    apply: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
    chunk: { type: "string", default: "500" },
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
const MODEL_KEY = values.model as ModelKey;
const SEED = Number(values.seed);
const TRAIN_CANDLES = Number(values.trainCandles);
const CHUNK = Number(values.chunk);
const DB_NAME = "stock-ai";

if (!ALL_MODEL_KEYS.includes(MODEL_KEY)) {
  console.error(`unknown model: ${MODEL_KEY}. use one of: ${ALL_MODEL_KEYS.join(", ")}`);
  process.exit(1);
}

const model = buildModel(MODEL_KEY, { window: WINDOW, epochs: EPOCHS, units: UNITS });

const findSqlitePath = (): string => {
  const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  if (!files.length) throw new Error(`no sqlite file in ${dir}`);
  const withSize = files.map((f) => ({ f, size: statSync(`${dir}/${f}`).size }));
  withSize.sort((a, b) => b.size - a.size);
  return `${dir}/${withSize[0].f}`;
};

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

type Candle = { date: number; close: number; volume: number };
type BacktestSource = {
  listCandidates: () => Promise<string[]>;
  getCandles: (code: string) => Promise<Candle[]>;
  close: () => void;
};

const buildLocalSource = (): BacktestSource => {
  const sqlitePath = findSqlitePath();
  console.log(`sqlite: ${sqlitePath}`);
  const db = new Database(sqlitePath);
  const candleStmt = db.query(
    "SELECT date, close, volume FROM candles WHERE code = ? AND close > 0 ORDER BY date ASC",
  );
  const listCandidates = async (): Promise<string[]> => {
    const sinceDate = new Date(Date.now() - LOOKBACK_YEARS * 365 * 24 * 60 * 60 * 1000);
    const sinceYmd =
      sinceDate.getUTCFullYear() * 10000 +
      (sinceDate.getUTCMonth() + 1) * 100 +
      sinceDate.getUTCDate();
    const marketPlaceholders = MARKETS.map(() => "?").join(",");
    const rows = db
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
    return rows.map((r) => r.code);
  };
  const getCandles = async (code: string): Promise<Candle[]> =>
    candleStmt.all(code) as Candle[];
  return { listCandidates, getCandles, close: () => db.close() };
};

const buildRemoteSource = (baseUrl: string): BacktestSource => {
  const base = baseUrl.replace(/\/$/, "");
  const listCandidates = async (): Promise<string[]> => {
    const params = new URLSearchParams({
      markets: MARKETS.join(","),
      minRange: String(MIN_RANGE),
      lookbackYears: String(LOOKBACK_YEARS),
    });
    const r = await fetch(`${base}/api/backtest-candidates?${params}`);
    if (!r.ok) throw new Error(`GET /api/backtest-candidates failed: ${r.status}`);
    const j = (await r.json()) as { codes: string[] };
    return j.codes;
  };
  const getCandles = async (code: string): Promise<Candle[]> => {
    const r = await fetch(`${base}/api/candles/${code}?limit=5000`);
    if (!r.ok) throw new Error(`GET /api/candles/${code} failed: ${r.status}`);
    const j = (await r.json()) as {
      candles: { date: number; close: number; volume: number }[];
    };
    return j.candles
      .filter((c) => c.close > 0)
      .map((c) => ({ date: c.date, close: c.close, volume: c.volume }));
  };
  return { listCandidates, getCandles, close: () => {} };
};

type LogRow = {
  code: string;
  runDate: number;
  horizonDays: number;
  lastClose: number;
  predictedClose: number;
  actualClose: number;
  errorPct: number;
  directionHit: number;
};

const escapeSqlString = (s: string) => s.replace(/'/g, "''");

const OUT_PATH = values.out
  ? resolve(process.cwd(), values.out)
  : resolve(process.cwd(), `data/seed_prediction_log_${model.name}.sql`);

const writeSql = (rows: LogRow[]) => {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const chunks: string[] = [];
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const vals = slice
      .map(
        (r) =>
          `('${escapeSqlString(r.code)}',${r.runDate},${r.horizonDays},'${escapeSqlString(model.name)}',${r.lastClose},${r.predictedClose},${r.actualClose},${r.errorPct},${r.directionHit})`,
      )
      .join(",\n");
    chunks.push(
      `INSERT OR REPLACE INTO prediction_log (code,run_date,horizon_days,model_name,last_close,predicted_close,actual_close,error_pct,direction_hit) VALUES\n${vals};`,
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
  if (MODEL_KEY === "lstm_v1") {
    await tf.setBackend("cpu");
    await tf.ready();
    console.log(`tfjs backend: ${tf.getBackend()}`);
  }
  console.log(
    `config: model=${model.name} stocks=${N_STOCKS} dates=${N_DATES} horizons=[${HORIZONS.join(",")}] markets=[${MARKETS.join(",")}] minRange=${MIN_RANGE}`,
  );

  const useRemote = Boolean(values.sourceUrl);
  const writeToFile = useRemote || Boolean(values.out);
  const source: BacktestSource = useRemote
    ? buildRemoteSource(values.sourceUrl!)
    : buildLocalSource();
  if (useRemote) console.log(`source: ${values.sourceUrl}`);

  const localDb = writeToFile ? null : new Database(findSqlitePath());
  const insertStmt = localDb?.prepare(
    `INSERT OR REPLACE INTO prediction_log
     (code, run_date, horizon_days, model_name, last_close, predicted_close, actual_close, error_pct, direction_hit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const candidates = await source.listCandidates();
  console.log(`candidates (markets=${MARKETS.join(",")}, range>=${(MIN_RANGE * 100).toFixed(0)}%): ${candidates.length}`);

  const rng = mulberry32(SEED);
  const codes = shuffle(candidates, rng).slice(0, N_STOCKS);
  console.log(`selected ${codes.length} codes: ${codes.slice(0, 10).join(",")}${codes.length > 10 ? "..." : ""}`);

  const minTrainRows = Math.max(model.minCandles, TRAIN_CANDLES);
  let totalRuns = 0;
  let totalInserts = 0;
  let skippedStocks = 0;
  const collected: LogRow[] = [];
  const t0 = Date.now();

  const flush = () => {
    if (!writeToFile || collected.length === 0) return;
    writeSql(collected);
    if (values.apply) applySql();
    collected.length = 0;
  };

  for (let ci = 0; ci < codes.length; ci++) {
    const code = codes[ci];
    const candles = await source.getCandles(code);
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
      const trainSlice = candles.slice(trainStart, runIdx + 1);
      const trainCloses = trainSlice.map((c) => c.close);
      const trainVolumes = trainSlice.map((c) => c.volume);

      let preds: number[];
      try {
        preds = await model.predict(trainCloses, trainVolumes, MAX_HORIZON);
      } catch (e) {
        console.warn(`    runDate=${runDate}: predict failed: ${(e as Error).message}`);
        continue;
      }
      totalRuns++;

      const batch: LogRow[] = [];
      for (const h of HORIZONS) {
        const predictedClose = preds[h - 1];
        const actualIdx = runIdx + h;
        const actualClose = candles[actualIdx]?.close;
        if (actualClose == null) continue;
        const errorPct = ((predictedClose - actualClose) / actualClose) * 100;
        const predDir = Math.sign(predictedClose - lastClose);
        const actDir = Math.sign(actualClose - lastClose);
        const directionHit = predDir !== 0 && predDir === actDir ? 1 : 0;
        batch.push({
          code,
          runDate,
          horizonDays: h,
          lastClose,
          predictedClose,
          actualClose,
          errorPct,
          directionHit,
        });
      }
      if (values.dryRun) {
        totalInserts += batch.length;
        continue;
      }
      if (writeToFile) {
        collected.push(...batch);
        if (collected.length >= CHUNK) flush();
      } else if (localDb && insertStmt) {
        const tx = localDb.transaction(() => {
          for (const r of batch) {
            insertStmt.run(
              r.code,
              r.runDate,
              r.horizonDays,
              model.name,
              r.lastClose,
              r.predictedClose,
              r.actualClose,
              r.errorPct,
              r.directionHit,
            );
          }
        });
        tx();
      }
      totalInserts += batch.length;
    }

    const elapsed = (Date.now() - t0) / 1000;
    const rate = totalRuns / elapsed;
    const remainStocks = codes.length - (ci + 1);
    const eta = remainStocks * N_DATES / (rate || 1);
    console.log(`    progress: runs=${totalRuns} inserts=${totalInserts}  ${rate.toFixed(2)} run/s  eta=${Math.round(eta)}s`);
  }

  flush();

  const elapsed = (Date.now() - t0) / 1000;
  console.log(
    `\ndone: model=${model.name} stocks_ok=${codes.length - skippedStocks} skipped=${skippedStocks}  runs=${totalRuns}  inserts=${totalInserts}  in ${elapsed.toFixed(1)}s`,
  );
  source.close();
  localDb?.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
