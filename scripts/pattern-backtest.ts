import { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";
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
    patterns: { type: "string", default: "volume_surge_breakout" },
    horizons: { type: "string", default: "5,10,15,20" },
    markets: { type: "string", default: "東S,東G,東P" },
    minPrice: { type: "string", default: "100" },
    maxPrice: { type: "string", default: "10000" },
    sourceUrl: { type: "string" },
  },
});

const HORIZONS = values.horizons!.split(",").map((s) => Number(s.trim())).sort((a, b) => a - b);
const MAX_HORIZON = HORIZONS[HORIZONS.length - 1];
const MARKETS = values.markets!.split(",").map((s) => s.trim());
const MIN_PRICE = Number(values.minPrice);
const MAX_PRICE = Number(values.maxPrice);

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
  const listCandidates = async (): Promise<string[]> => {
    const placeholders = MARKETS.map(() => "?").join(",");
    const rows = db
      .query(`SELECT code FROM stocks WHERE market IN (${placeholders})`)
      .all(...MARKETS) as { code: string }[];
    return rows.map((r) => r.code);
  };
  const getCandles = async (code: string): Promise<Candle[]> =>
    candleStmt.all(code) as Candle[];
  return { listCandidates, getCandles, close: () => db.close() };
};

const buildRemoteSource = (baseUrl: string): Source => {
  const base = baseUrl.replace(/\/$/, "");
  const listCandidates = async (): Promise<string[]> => {
    const r = await fetch(`${base}/api/backtest-candidates?markets=${encodeURIComponent(MARKETS.join(","))}&minRange=0&lookbackYears=5`);
    if (!r.ok) throw new Error(`candidates ${r.status}`);
    const j = (await r.json()) as { codes: string[] };
    return j.codes;
  };
  const getCandles = async (code: string): Promise<Candle[]> => {
    const r = await fetch(`${base}/api/candles/${code}?limit=5000`);
    if (!r.ok) throw new Error(`candles ${code} ${r.status}`);
    const j = (await r.json()) as { candles: Candle[] };
    return j.candles.filter((c) => c.close > 0);
  };
  return { listCandidates, getCandles, close: () => {} };
};

type HorizonStats = {
  n: number;
  wins: number;
  returnSum: number;
};

type PatternStats = {
  matches: number;
  byHorizon: Map<number, HorizonStats>;
};

const newPatternStats = (): PatternStats => {
  const byHorizon = new Map<number, HorizonStats>();
  for (const h of HORIZONS) byHorizon.set(h, { n: 0, wins: 0, returnSum: 0 });
  return { matches: 0, byHorizon };
};

const main = async () => {
  const useRemote = Boolean(values.sourceUrl);
  const source = useRemote ? buildRemoteSource(values.sourceUrl!) : buildLocalSource();
  console.log(`patterns: ${selectedPatterns.map((p) => p.name).join(", ")}`);
  console.log(`horizons: [${HORIZONS.join(",")}]  markets: [${MARKETS.join(",")}]  price: ${MIN_PRICE}-${MAX_PRICE}`);

  const codes = await source.listCandidates();
  console.log(`candidates: ${codes.length}`);

  const perPattern = new Map<string, PatternStats>();
  for (const p of selectedPatterns) perPattern.set(p.name, newPatternStats());

  let scannedBars = 0;
  const t0 = Date.now();

  for (let ci = 0; ci < codes.length; ci++) {
    const code = codes[ci];
    const candles = await source.getCandles(code);
    const n = candles.length;
    if (n < minCandlesAll + MAX_HORIZON) continue;

    for (let i = minCandlesAll; i < n - MAX_HORIZON; i++) {
      scannedBars++;
      const c = candles[i];
      if (c.close < MIN_PRICE || c.close > MAX_PRICE) continue;

      for (const p of selectedPatterns) {
        if (!p.matches(candles, i)) continue;
        const ps = perPattern.get(p.name)!;
        ps.matches++;
        const entry = c.close;
        for (const h of HORIZONS) {
          const future = candles[i + h];
          if (!future) continue;
          const retPct = ((future.close - entry) / entry) * 100;
          const s = ps.byHorizon.get(h)!;
          s.n++;
          if (retPct > 0) s.wins++;
          s.returnSum += retPct;
        }
      }
    }

    if ((ci + 1) % 100 === 0) {
      const sec = (Date.now() - t0) / 1000;
      const matchSummary = selectedPatterns
        .map((p) => `${p.name.slice(0, 4)}=${perPattern.get(p.name)!.matches}`)
        .join(" ");
      console.log(`  [${ci + 1}/${codes.length}] bars=${scannedBars} ${matchSummary}  ${(scannedBars / sec).toFixed(0)} bars/s`);
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\ndone in ${elapsed.toFixed(1)}s  stocks=${codes.length}  bars=${scannedBars}\n`);

  for (const p of selectedPatterns) {
    const ps = perPattern.get(p.name)!;
    console.log(`=== ${p.name}  (matches=${ps.matches}) ===`);
    console.log(`horizon       n   win_rate  avg_return`);
    for (const h of HORIZONS) {
      const s = ps.byHorizon.get(h)!;
      const wr = s.n > 0 ? (s.wins / s.n) * 100 : 0;
      const avg = s.n > 0 ? s.returnSum / s.n : 0;
      console.log(
        `${String(h).padStart(5)}d  ${String(s.n).padStart(6)}   ${wr.toFixed(2).padStart(6)}%   ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`,
      );
    }
    console.log("");
  }

  source.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
