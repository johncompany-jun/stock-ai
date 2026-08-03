import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import YahooFinance from "yahoo-finance2";

const { values } = parseArgs({
  options: {
    codes: { type: "string" },
    years: { type: "string", default: "5" },
    concurrency: { type: "string", default: "4" },
    remote: { type: "boolean", default: false },
    full: { type: "boolean", default: false },
    limit: { type: "string" },
    out: { type: "string", default: "drizzle/seed_candles.sql" },
    apply: { type: "boolean", default: false },
  },
});

const YEARS = Number(values.years);
const CONCURRENCY = Number(values.concurrency);
const REMOTE_FLAG = values.remote ? "--remote" : "--local";
const OUT_PATH = resolve(process.cwd(), values.out!);
const DB_NAME = "stock-ai";

const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
  queue: { concurrency: CONCURRENCY, interval: 150 },
  validation: { logErrors: false, logOptionsErrors: false },
});

const d1Query = <T>(sql: string): T[] => {
  const res = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DB_NAME, REMOTE_FLAG, "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    throw new Error(`wrangler d1 execute failed: ${res.stderr}`);
  }
  const parsed = JSON.parse(res.stdout);
  const rows = Array.isArray(parsed) ? parsed[0]?.results : parsed?.result?.[0]?.results;
  return (rows ?? []) as T[];
};

const listCodes = (): string[] => {
  if (values.codes) return values.codes.split(",").map((s) => s.trim()).filter(Boolean);
  const rows = d1Query<{ code: string }>("SELECT code FROM stocks ORDER BY code");
  return rows.map((r) => r.code);
};

const listLatestDates = (): Map<string, number> => {
  if (values.full) return new Map();
  try {
    const rows = d1Query<{ code: string; max_date: number }>(
      "SELECT code, MAX(date) AS max_date FROM candles GROUP BY code",
    );
    return new Map(rows.map((r) => [r.code, r.max_date]));
  } catch (e) {
    console.warn(`  latest-dates lookup failed (assuming full fetch): ${(e as Error).message.split("\n")[0]}`);
    return new Map();
  }
};

const toYyyymmdd = (d: Date): number =>
  d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

const fromYyyymmdd = (n: number): Date => {
  const y = Math.floor(n / 10000);
  const m = Math.floor((n % 10000) / 100);
  const d = n % 100;
  return new Date(Date.UTC(y, m - 1, d));
};

type Row = { code: string; date: number; o: number; h: number; l: number; c: number; v: number; ac: number | null };

const fetchOne = async (code: string, since: number | undefined): Promise<Row[]> => {
  const period1 = since
    ? new Date(fromYyyymmdd(since).getTime() + 24 * 60 * 60 * 1000)
    : new Date(Date.now() - YEARS * 365 * 24 * 60 * 60 * 1000);
  if (period1.getTime() >= Date.now()) return [];
  const chart = await yf.chart(`${code}.T`, { period1, interval: "1d", return: "array" });
  const out: Row[] = [];
  for (const q of chart.quotes) {
    if (!q.date || q.open == null || q.high == null || q.low == null || q.close == null || q.volume == null) continue;
    out.push({
      code,
      date: toYyyymmdd(q.date),
      o: q.open,
      h: q.high,
      l: q.low,
      c: q.close,
      v: q.volume,
      ac: q.adjclose ?? null,
    });
  }
  return out;
};

const runPool = async <T>(items: T[], worker: (item: T, idx: number) => Promise<void>) => {
  let next = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
};

const main = async () => {
  let codes = listCodes();
  if (values.limit) codes = codes.slice(0, Number(values.limit));
  const latest = listLatestDates();

  console.log(`codes: ${codes.length} (full=${values.full}, years=${YEARS}, concurrency=${CONCURRENCY})`);

  const allRows: Row[] = [];
  let done = 0;
  let failed = 0;
  await runPool(codes, async (code) => {
    try {
      const rows = await fetchOne(code, latest.get(code));
      allRows.push(...rows);
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${codes.length}  rows=${allRows.length}  fail=${failed}`);
    } catch (e) {
      failed++;
      console.warn(`  ${code}: ${(e as Error).message}`);
    }
  });

  console.log(`fetched: ${allRows.length} rows (fail=${failed})`);

  if (allRows.length === 0) {
    console.log("no rows to write");
    return;
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const chunkSize = 500;
  const chunks: string[] = [];
  for (let i = 0; i < allRows.length; i += chunkSize) {
    const slice = allRows.slice(i, i + chunkSize);
    const vals = slice
      .map((r) => `('${r.code}',${r.date},${r.o},${r.h},${r.l},${r.c},${r.v},${r.ac ?? "NULL"})`)
      .join(",\n");
    chunks.push(
      `INSERT OR REPLACE INTO candles (code,date,open,high,low,close,volume,adj_close) VALUES\n${vals};`,
    );
  }
  writeFileSync(OUT_PATH, chunks.join("\n\n") + "\n", "utf8");
  console.log(`wrote: ${OUT_PATH}`);

  if (values.apply) {
    console.log(`applying ${REMOTE_FLAG}...`);
    const res = spawnSync(
      "bunx",
      ["wrangler", "d1", "execute", DB_NAME, REMOTE_FLAG, "--file", OUT_PATH],
      { encoding: "utf8", stdio: "inherit", maxBuffer: 256 * 1024 * 1024 },
    );
    if (res.status !== 0) throw new Error("apply failed");
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
