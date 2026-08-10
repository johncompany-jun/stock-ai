import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as tf from "@tensorflow/tfjs";
import { ALL_MODEL_KEYS, buildModel, type ModelKey } from "./models";

const { values } = parseArgs({
  options: {
    codes: { type: "string" },
    limit: { type: "string" },
    shard: { type: "string" },
    horizon: { type: "string", default: "21" },
    window: { type: "string", default: "30" },
    epochs: { type: "string", default: "20" },
    units: { type: "string", default: "16" },
    days: { type: "string", default: "365" },
    chunk: { type: "string", default: "200" },
    model: { type: "string", default: "lstm_v1" },
    out: { type: "string" },
    apply: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
    sourceUrl: { type: "string" },
  },
});

const HORIZON = Number(values.horizon);
const WINDOW = Number(values.window);
const EPOCHS = Number(values.epochs);
const UNITS = Number(values.units);
const DAYS = Number(values.days);
const CHUNK = Number(values.chunk);
const MODEL_KEY = values.model as ModelKey;
const OUT_PATH = resolve(
  process.cwd(),
  values.out ?? `data/seed_predictions_${MODEL_KEY}.sql`,
);
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

type Candle = { date: number; close: number; volume: number };
type CandleSource = {
  listCodes: () => Promise<string[]>;
  getCandles: (code: string, since: number) => Promise<Candle[]>;
  close: () => void;
};

const buildLocalSource = (): CandleSource => {
  const sqlitePath = findSqlitePath();
  console.log(`sqlite: ${sqlitePath}`);
  const db = new Database(sqlitePath);
  const listStmt = db.query("SELECT code FROM stocks ORDER BY code");
  const candleStmt = db.query(
    "SELECT date, close, volume FROM candles WHERE code = ? AND date >= ? ORDER BY date ASC",
  );
  return {
    listCodes: async () =>
      (listStmt.all() as { code: string }[]).map((r) => r.code),
    getCandles: async (code, since) =>
      candleStmt.all(code, since) as Candle[],
    close: () => db.close(),
  };
};

const buildRemoteSource = (baseUrl: string): CandleSource => {
  const base = baseUrl.replace(/\/$/, "");
  const listCodes = async (): Promise<string[]> => {
    const codes: string[] = [];
    const PAGE = 200;
    let offset = 0;
    for (;;) {
      const r = await fetch(`${base}/api/stocks?limit=${PAGE}&offset=${offset}`);
      if (!r.ok) throw new Error(`GET /api/stocks failed: ${r.status}`);
      const j = (await r.json()) as { items: { code: string }[]; total: number };
      for (const it of j.items) codes.push(it.code);
      if (codes.length >= j.total || j.items.length === 0) break;
      offset += PAGE;
    }
    return codes;
  };
  const getCandles = async (code: string, since: number): Promise<Candle[]> => {
    const r = await fetch(
      `${base}/api/candles/${code}?from=${since}&limit=5000`,
    );
    if (!r.ok) throw new Error(`GET /api/candles/${code} failed: ${r.status}`);
    const j = (await r.json()) as {
      candles: { date: number; close: number; volume: number }[];
    };
    return j.candles.map((c) => ({ date: c.date, close: c.close, volume: c.volume }));
  };
  return { listCodes, getCandles, close: () => {} };
};

const toYyyymmdd = (d: Date): number =>
  d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

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
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const vals = slice
      .map(
        (r) =>
          `('${r.code}','${model.name}',${r.runAt},${r.lastDate},${r.lastClose},${HORIZON},${r.predictedClose},${r.expectedReturnPct},'${JSON.stringify(r.preds)}')`,
      )
      .join(",\n");
    chunks.push(
      `INSERT OR REPLACE INTO predictions (code,model_name,run_at,last_date,last_close,horizon_days,predicted_close,expected_return_pct,preds_json) VALUES\n${vals};`,
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

  const source: CandleSource = values.sourceUrl
    ? buildRemoteSource(values.sourceUrl)
    : buildLocalSource();
  if (values.sourceUrl) console.log(`source: ${values.sourceUrl}`);

  const requestedCodes = values.codes
    ? values.codes.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  let codes: string[];
  if (requestedCodes) {
    codes = requestedCodes;
  } else {
    codes = await source.listCodes();
  }
  if (values.shard) {
    const m = values.shard.match(/^(\d+)\/(\d+)$/);
    if (!m) {
      console.error(`invalid --shard: ${values.shard} (expected N/TOTAL, e.g. 0/4)`);
      process.exit(1);
    }
    const index = Number(m[1]);
    const total = Number(m[2]);
    if (total <= 0 || index < 0 || index >= total) {
      console.error(`invalid --shard values: index=${index} total=${total}`);
      process.exit(1);
    }
    codes = codes.filter((_, i) => i % total === index);
    console.log(`shard ${index}/${total}: ${codes.length} codes`);
  }
  if (values.limit) codes = codes.slice(0, Number(values.limit));

  const sinceDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const since = toYyyymmdd(sinceDate);
  console.log(
    `model=${model.name}  codes: ${codes.length}, window=${WINDOW}, horizon=${HORIZON}, since=${since}`,
  );

  const runAt = Math.floor(Date.now() / 1000);
  const results: PredictionRow[] = [];
  let done = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const t0 = Date.now();
  const minRows = Math.max(model.minCandles, WINDOW + 10);

  for (const code of codes) {
    const candles = await source.getCandles(code, since);
    if (candles.length < minRows) {
      skipped++;
      done++;
      continue;
    }
    try {
      const closes = candles.map((c) => c.close);
      const volumes = candles.map((c) => c.volume);
      const preds = await model.predict(closes, volumes, HORIZON);
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
    `done: model=${model.name}  ${done}/${codes.length}  ok=${ok} skip=${skipped} fail=${failed}  in ${elapsed.toFixed(1)}s`,
  );

  source.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
