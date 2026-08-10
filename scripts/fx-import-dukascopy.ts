import { spawnSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { getHistoricalRates } from "dukascopy-node";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    from: { type: "string", default: "2023-01-01" },
    to: { type: "string", default: "2025-12-31" },
    remote: { type: "boolean", default: false },
    dryRun: { type: "boolean", default: false },
    outDir: { type: "string", default: "data/fx" },
  },
});

const PAIR = values.pair.toUpperCase();
const REMOTE_FLAG = values.remote ? "--remote" : "--local";
const OUT_DIR = resolve(process.cwd(), values.outDir);
const DB_NAME = "stock-ai";

const monthRange = (from: string, to: string): Array<[Date, Date]> => {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T23:59:59Z`);
  const out: Array<[Date, Date]> = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur.getTime() <= end.getTime()) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const chunkStart = cur.getTime() < start.getTime() ? start : cur;
    const chunkEnd = next.getTime() > end.getTime() ? end : new Date(next.getTime() - 1);
    out.push([chunkStart, chunkEnd]);
    cur = next;
  }
  return out;
};

const applySql = (path: string) => {
  const res = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DB_NAME, REMOTE_FLAG, "--file", path],
    { encoding: "utf8", stdio: "inherit", maxBuffer: 512 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error(`apply failed for ${path}`);
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const months = monthRange(values.from, values.to);
  console.log(
    `pair=${PAIR}  range=${values.from}..${values.to}  months=${months.length}  target=${REMOTE_FLAG}  dryRun=${values.dryRun}`,
  );

  let totalRows = 0;

  for (const [from, to] of months) {
    const label = `${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}`;
    process.stdout.write(`  ${label}  fetching...`);
    const t0 = Date.now();

    const rates = (await getHistoricalRates({
      instrument: PAIR.toLowerCase() as never,
      dates: { from, to },
      timeframe: "m1",
      priceType: "bid",
      format: "json",
      utcOffset: 0,
      volumes: true,
      ignoreFlats: true,
    })) as Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;

    const rows = rates.filter(
      (r) =>
        Number.isFinite(r.open) &&
        Number.isFinite(r.high) &&
        Number.isFinite(r.low) &&
        Number.isFinite(r.close),
    );

    const fetchMs = Date.now() - t0;
    process.stdout.write(` ${rows.length} rows in ${fetchMs}ms\n`);

    if (rows.length === 0) continue;
    if (values.dryRun) {
      totalRows += rows.length;
      continue;
    }

    const filePath = `${OUT_DIR}/fx_${PAIR}_${from.toISOString().slice(0, 7).replace("-", "")}.sql`;
    const BATCH = 500;
    const chunks: string[] = [];
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const vals = slice
        .map((r) => {
          const ts = Math.floor(r.timestamp / 1000);
          const vol = r.volume ?? 0;
          return `('${PAIR}',${ts},${r.open},${r.high},${r.low},${r.close},${vol})`;
        })
        .join(",\n");
      chunks.push(
        `INSERT OR REPLACE INTO fx_candles (pair,timestamp_utc,open,high,low,close,volume) VALUES\n${vals};`,
      );
    }
    writeFileSync(filePath, chunks.join("\n\n") + "\n", "utf8");

    applySql(filePath);
    unlinkSync(filePath);
    totalRows += rows.length;
    console.log(`    applied and cleaned ${filePath.split("/").pop()}  (cumulative rows=${totalRows})`);
  }

  console.log(`done: pair=${PAIR}  total rows=${totalRows}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
