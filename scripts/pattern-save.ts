import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { volumeSurgeBreakout } from "./patterns/volume_surge_breakout";
import { oversoldReversal } from "./patterns/oversold_reversal";
import { pullbackToMa } from "./patterns/pullback_to_ma";
import { gapDownReversal } from "./patterns/gap_down_reversal";
import type { Candle, Pattern } from "./patterns/types";

const PATTERNS: Record<string, Pattern> = {
  volume_surge_breakout: volumeSurgeBreakout,
  oversold_reversal: oversoldReversal,
  pullback_to_ma: pullbackToMa,
  gap_down_reversal: gapDownReversal,
};

const { values } = parseArgs({
  options: {
    patterns: { type: "string", default: "oversold_reversal,pullback_to_ma,gap_down_reversal" },
    markets: { type: "string", default: "東S,東G,東P" },
    minPrice: { type: "string", default: "100" },
    maxPrice: { type: "string", default: "1000" },
    topN: { type: "string", default: "5" },
    days: { type: "string", default: "1" },
    sourceUrl: { type: "string" },
    out: { type: "string", default: "data/pattern_picks.sql" },
    apply: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});

const MARKETS = values.markets!.split(",").map((s) => s.trim());
const MIN_PRICE = Number(values.minPrice);
const MAX_PRICE = Number(values.maxPrice);
const TOP_N = Number(values.topN);
const DAYS_WINDOW = Number(values.days);
const OUT_PATH = resolve(process.cwd(), values.out!);
const DB_NAME = "stock-ai";

const patternNames = values.patterns!.split(",").map((s) => s.trim());
const selectedPatterns: Pattern[] = [];
for (const name of patternNames) {
  const p = PATTERNS[name];
  if (!p) {
    console.error(`unknown pattern: ${name}. available: ${Object.keys(PATTERNS).join(", ")}`);
    process.exit(1);
  }
  selectedPatterns.push(p);
}
const minCandlesAll = Math.max(...selectedPatterns.map((p) => p.minCandles));

type Source = {
  listCandidates: () => Promise<string[]>;
  getCandles: (code: string) => Promise<Candle[]>;
  close: () => void;
};

const findSqlitePath = (): string => {
  const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  if (!files.length) throw new Error(`no sqlite in ${dir}`);
  const withSize = files.map((f) => ({ f, size: statSync(`${dir}/${f}`).size }));
  withSize.sort((a, b) => b.size - a.size);
  return `${dir}/${withSize[0].f}`;
};

const buildLocalSource = (): Source => {
  const path = findSqlitePath();
  console.log(`sqlite: ${path}`);
  const db = new Database(path);
  const candleStmt = db.query(
    "SELECT date, open, high, low, close, volume FROM candles WHERE code = ? AND close > 0 ORDER BY date ASC",
  );
  const listCandidates = async () => {
    const placeholders = MARKETS.map(() => "?").join(",");
    const rows = db
      .query(`SELECT code FROM stocks WHERE market IN (${placeholders})`)
      .all(...MARKETS) as { code: string }[];
    return rows.map((r) => r.code);
  };
  const getCandles = async (code: string) => candleStmt.all(code) as Candle[];
  return { listCandidates, getCandles, close: () => db.close() };
};

const buildRemoteSource = (baseUrl: string): Source => {
  const base = baseUrl.replace(/\/$/, "");
  const listCandidates = async () => {
    const r = await fetch(`${base}/api/backtest-candidates?markets=${encodeURIComponent(MARKETS.join(","))}&minRange=0&lookbackYears=5`);
    if (!r.ok) throw new Error(`candidates ${r.status}`);
    const j = (await r.json()) as { codes: string[] };
    return j.codes;
  };
  const getCandles = async (code: string) => {
    const r = await fetch(`${base}/api/candles/${code}?limit=5000`);
    if (!r.ok) throw new Error(`candles ${code} ${r.status}`);
    const j = (await r.json()) as { candles: Candle[] };
    return j.candles.filter((c) => c.close > 0);
  };
  return { listCandidates, getCandles, close: () => {} };
};

type Pick = {
  code: string;
  runDate: number;
  patterns: string;
  entry: number;
};

const main = async () => {
  const useRemote = Boolean(values.sourceUrl);
  const source = useRemote ? buildRemoteSource(values.sourceUrl!) : buildLocalSource();
  console.log(`patterns: ${selectedPatterns.map((p) => p.name).join(", ")}`);
  console.log(`markets: [${MARKETS.join(",")}]  price: ${MIN_PRICE}-${MAX_PRICE}  topN=${TOP_N}  days=${DAYS_WINDOW}`);

  const codes = await source.listCandidates();
  console.log(`candidates: ${codes.length}`);

  const matchesByDate = new Map<number, Pick[]>();
  const t0 = Date.now();

  for (let ci = 0; ci < codes.length; ci++) {
    const code = codes[ci];
    const candles = await source.getCandles(code);
    const n = candles.length;
    if (n < minCandlesAll + 1) continue;

    const latestDate = candles[n - 1].date;
    const cutoff = new Date(
      Date.UTC(
        Number(String(latestDate).slice(0, 4)),
        Number(String(latestDate).slice(4, 6)) - 1,
        Number(String(latestDate).slice(6, 8)),
      ),
    );
    cutoff.setUTCDate(cutoff.getUTCDate() - DAYS_WINDOW);
    const cutoffYmd =
      cutoff.getUTCFullYear() * 10000 +
      (cutoff.getUTCMonth() + 1) * 100 +
      cutoff.getUTCDate();

    for (let i = minCandlesAll; i < n; i++) {
      const c = candles[i];
      if (c.date < cutoffYmd) continue;
      if (c.close < MIN_PRICE || c.close > MAX_PRICE) continue;

      const matched: string[] = [];
      for (const p of selectedPatterns) {
        if (p.matches(candles, i)) matched.push(p.name);
      }
      if (matched.length === 0) continue;

      const list = matchesByDate.get(c.date) ?? [];
      list.push({
        code,
        runDate: c.date,
        patterns: matched.join(","),
        entry: c.close,
      });
      matchesByDate.set(c.date, list);
    }

    if ((ci + 1) % 200 === 0) {
      const sec = (Date.now() - t0) / 1000;
      console.log(`  [${ci + 1}/${codes.length}] dates=${matchesByDate.size}  ${sec.toFixed(1)}s`);
    }
  }

  const sortedDates = Array.from(matchesByDate.keys()).sort((a, b) => a - b);
  const picks: Pick[] = [];
  for (const d of sortedDates) {
    const list = matchesByDate.get(d)!;
    list.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    picks.push(...list.slice(0, TOP_N));
  }

  console.log(`\nscan done in ${((Date.now() - t0) / 1000).toFixed(1)}s  dates=${sortedDates.length}  picks=${picks.length}`);

  if (picks.length === 0) {
    console.log("no picks; exiting");
    source.close();
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const BATCH = 100;
  const chunks: string[] = [];
  for (let i = 0; i < picks.length; i += BATCH) {
    const slice = picks.slice(i, i + BATCH);
    const vals = slice
      .map(
        (p) =>
          `('${p.code.replace(/'/g, "''")}',${p.runDate},'${p.patterns.replace(/'/g, "''")}',${p.entry},${now},${now})`,
      )
      .join(",\n");
    chunks.push(
      `INSERT INTO pattern_picks (code,run_date,patterns,entry_close,created_at,updated_at) VALUES\n${vals}\nON CONFLICT(code,run_date) DO UPDATE SET patterns=excluded.patterns, entry_close=excluded.entry_close, updated_at=excluded.updated_at;`,
    );
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, chunks.join("\n\n") + "\n", "utf8");
  console.log(`wrote: ${OUT_PATH} (${picks.length} rows)`);

  if (values.apply) {
    const remoteFlag = values.remote ? "--remote" : "--local";
    const res = spawnSync(
      "bunx",
      ["wrangler", "d1", "execute", DB_NAME, remoteFlag, "--file", OUT_PATH],
      { encoding: "utf8", stdio: "inherit", maxBuffer: 256 * 1024 * 1024 },
    );
    if (res.status !== 0) throw new Error("apply failed");
  }

  source.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
