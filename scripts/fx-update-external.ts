import { spawnSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import YahooFinance from "yahoo-finance2";

const { values } = parseArgs({
  options: {
    symbol: { type: "string", default: "^N225" },
    daysBack: { type: "string", default: "7" },
    remote: { type: "boolean", default: false },
    outDir: { type: "string", default: "data/fx" },
  },
});

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

const dateToJstString = (d: Date): string => {
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const period1 = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000);
  console.log(
    `symbol=${SYMBOL}  daysBack=${DAYS_BACK}  target=${REMOTE_FLAG}  period1=${period1.toISOString()}`,
  );

  const chart = await yf.chart(SYMBOL, {
    period1,
    interval: "1d",
    return: "array",
  });

  type Row = { date: string; close: number };
  const rows: Row[] = [];
  for (const q of chart.quotes) {
    if (!q.date || q.close == null) continue;
    rows.push({ date: dateToJstString(q.date), close: q.close });
  }
  console.log(`fetched: ${rows.length} rows`);
  if (rows.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  const safeSymbol = SYMBOL.replace(/[^a-zA-Z0-9]/g, "_");
  const filePath = `${OUT_DIR}/external_${safeSymbol}.sql`;
  const BATCH = 500;
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const vals = slice
      .map((r) => `('${SYMBOL}','${r.date}',${r.close},${now})`)
      .join(",\n");
    chunks.push(
      `INSERT OR REPLACE INTO external_daily (symbol,date,close,updated_at) VALUES\n${vals};`,
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
