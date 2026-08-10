import { spawnSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import YahooFinance from "yahoo-finance2";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    symbol: { type: "string", default: "JPY=X" },
    daysBack: { type: "string", default: "7" },
    remote: { type: "boolean", default: false },
    outDir: { type: "string", default: "data/fx" },
  },
});

const PAIR = values.pair.toUpperCase();
const SYMBOL = values.symbol;
const DAYS_BACK = Number(values.daysBack);
const REMOTE_FLAG = values.remote ? "--remote" : "--local";
const OUT_DIR = resolve(process.cwd(), values.outDir);
const DB_NAME = "stock-ai";

const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
  validation: { logErrors: false, logOptionsErrors: false },
});

const applySql = (path: string) => {
  const res = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DB_NAME, REMOTE_FLAG, "--file", path],
    { encoding: "utf8", stdio: "inherit", maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error(`apply failed for ${path}`);
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const period1 = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000);
  console.log(
    `pair=${PAIR}  symbol=${SYMBOL}  daysBack=${DAYS_BACK}  target=${REMOTE_FLAG}  period1=${period1.toISOString()}`,
  );

  const chart = await yf.chart(SYMBOL, {
    period1,
    interval: "1m",
    return: "array",
  });

  type Row = { ts: number; o: number; h: number; l: number; c: number; v: number };
  const rows: Row[] = [];
  for (const q of chart.quotes) {
    if (!q.date || q.open == null || q.high == null || q.low == null || q.close == null) continue;
    rows.push({
      ts: Math.floor(q.date.getTime() / 1000),
      o: q.open,
      h: q.high,
      l: q.low,
      c: q.close,
      v: q.volume ?? 0,
    });
  }
  console.log(`fetched: ${rows.length} rows`);
  if (rows.length === 0) return;

  const filePath = `${OUT_DIR}/fx_${PAIR}_yf_latest.sql`;
  const BATCH = 500;
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const vals = slice
      .map(
        (r) =>
          `('${PAIR}',${r.ts},${r.o},${r.h},${r.l},${r.c},${r.v})`,
      )
      .join(",\n");
    chunks.push(
      `INSERT OR REPLACE INTO fx_candles (pair,timestamp_utc,open,high,low,close,volume) VALUES\n${vals};`,
    );
  }
  writeFileSync(filePath, chunks.join("\n\n") + "\n", "utf8");
  applySql(filePath);
  unlinkSync(filePath);
  console.log(`applied and cleaned ${filePath.split("/").pop()}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
