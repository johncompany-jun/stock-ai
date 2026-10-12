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
    patterns: { type: "string", default: "oversold_reversal,pullback_to_ma,gap_down_reversal" },
    horizons: { type: "string", default: "5,15,30" },
    markets: { type: "string", default: "東S,東G,東P" },
    minPrice: { type: "string", default: "100" },
    maxPrice: { type: "string", default: "10000" },
    topN: { type: "string", default: "5" },
    days: { type: "string", default: "365" },
    sourceUrl: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});

const HORIZONS = values.horizons!.split(",").map((s) => Number(s.trim())).sort((a, b) => a - b);
const MAX_HORIZON = HORIZONS[HORIZONS.length - 1];
const MARKETS = values.markets!.split(",").map((s) => s.trim());
const MIN_PRICE = Number(values.minPrice);
const MAX_PRICE = Number(values.maxPrice);
const TOP_N = Number(values.topN);
const DAYS_WINDOW = Number(values.days);

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
  listCandidates: () => Promise<Array<{ code: string; name: string }>>;
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
    return db
      .query(`SELECT code, name FROM stocks WHERE market IN (${placeholders})`)
      .all(...MARKETS) as { code: string; name: string }[];
  };
  const getCandles = async (code: string): Promise<Candle[]> =>
    candleStmt.all(code) as Candle[];
  return { listCandidates, getCandles, close: () => db.close() };
};

const buildRemoteSource = (baseUrl: string): Source => {
  const base = baseUrl.replace(/\/$/, "");
  const listCandidates = async () => {
    const r = await fetch(`${base}/api/backtest-candidates?markets=${encodeURIComponent(MARKETS.join(","))}&minRange=0&lookbackYears=5&withName=1`);
    if (!r.ok) throw new Error(`candidates ${r.status}`);
    const j = (await r.json()) as { codes: string[]; names?: Record<string, string> };
    return j.codes.map((code) => ({ code, name: j.names?.[code] ?? code }));
  };
  const getCandles = async (code: string): Promise<Candle[]> => {
    const r = await fetch(`${base}/api/candles/${code}?limit=5000`);
    if (!r.ok) throw new Error(`candles ${code} ${r.status}`);
    const j = (await r.json()) as { candles: Candle[] };
    return j.candles.filter((c) => c.close > 0);
  };
  return { listCandidates, getCandles, close: () => {} };
};

type Match = {
  date: number;
  code: string;
  name: string;
  entry: number;
  patterns: string[];
  candleIdx: number;
  candles: Candle[];
};

type Pick = Match & {
  returns: Map<number, number | null>;
};

const fmtDate = (ymd: number): string => {
  const s = String(ymd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

const main = async () => {
  const useRemote = Boolean(values.sourceUrl);
  const source = useRemote ? buildRemoteSource(values.sourceUrl!) : buildLocalSource();
  console.log(`patterns: ${selectedPatterns.map((p) => p.name).join(", ")}`);
  console.log(`horizons: [${HORIZONS.join(",")}]  markets: [${MARKETS.join(",")}]  price: ${MIN_PRICE}-${MAX_PRICE}  topN=${TOP_N}  days=${DAYS_WINDOW}`);

  const candidates = await source.listCandidates();
  console.log(`candidates: ${candidates.length}`);

  const matchesByDate = new Map<number, Match[]>();
  let scannedBars = 0;
  const t0 = Date.now();

  for (let ci = 0; ci < candidates.length; ci++) {
    const { code, name } = candidates[ci];
    const candles = await source.getCandles(code);
    const n = candles.length;
    if (n < minCandlesAll + MAX_HORIZON) continue;

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

    for (let i = minCandlesAll; i < n - MAX_HORIZON; i++) {
      const c = candles[i];
      if (c.date < cutoffYmd) continue;
      if (c.close < MIN_PRICE || c.close > MAX_PRICE) continue;
      scannedBars++;

      const matched: string[] = [];
      for (const p of selectedPatterns) {
        if (p.matches(candles, i)) matched.push(p.name);
      }
      if (matched.length === 0) continue;

      const list = matchesByDate.get(c.date) ?? [];
      list.push({
        date: c.date,
        code,
        name,
        entry: c.close,
        patterns: matched,
        candleIdx: i,
        candles,
      });
      matchesByDate.set(c.date, list);
    }

    if ((ci + 1) % 100 === 0) {
      const sec = (Date.now() - t0) / 1000;
      console.log(`  [${ci + 1}/${candidates.length}] scanned=${scannedBars}  dates=${matchesByDate.size}  ${(scannedBars / sec).toFixed(0)} bars/s`);
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\nscan done in ${elapsed.toFixed(1)}s  dates_with_matches=${matchesByDate.size}\n`);

  const sortedDates = Array.from(matchesByDate.keys()).sort((a, b) => a - b);

  const picks: Pick[] = [];
  for (const d of sortedDates) {
    const matches = matchesByDate.get(d)!;
    matches.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    const chosen = matches.slice(0, TOP_N);
    for (const m of chosen) {
      const returns = new Map<number, number | null>();
      for (const h of HORIZONS) {
        const future = m.candles[m.candleIdx + h];
        if (!future) {
          returns.set(h, null);
          continue;
        }
        returns.set(h, ((future.close - m.entry) / m.entry) * 100);
      }
      picks.push({ ...m, returns });
    }
  }

  console.log(`total picks: ${picks.length}  across ${sortedDates.length} dates\n`);

  if (values.verbose) {
    console.log(`date        code    name                       entry   ${HORIZONS.map((h) => `+${h}d`.padStart(8)).join("")}   patterns`);
    for (const p of picks) {
      const retCells = HORIZONS.map((h) => {
        const r = p.returns.get(h);
        if (r == null) return "   --".padStart(8);
        return `${r >= 0 ? "+" : ""}${r.toFixed(2)}%`.padStart(8);
      }).join("");
      const nm = p.name.length > 20 ? p.name.slice(0, 20) : p.name.padEnd(20);
      console.log(`${fmtDate(p.date)}  ${p.code.padEnd(6)}  ${nm}  ${String(Math.round(p.entry)).padStart(6)}  ${retCells}   ${p.patterns.join(",")}`);
    }
    console.log("");
  }

  console.log(`=== aggregate (equal-weight across ${TOP_N} picks per day) ===`);
  console.log(`horizon  n_picks   win_rate   avg_ret_per_pick   cumulative(daily_avg_compounded)`);
  for (const h of HORIZONS) {
    const perDay = new Map<number, number[]>();
    for (const p of picks) {
      const r = p.returns.get(h);
      if (r == null) continue;
      const list = perDay.get(p.date) ?? [];
      list.push(r);
      perDay.set(p.date, list);
    }
    let totalPicks = 0;
    let wins = 0;
    let returnSum = 0;
    let cumulative = 1;
    const dailyAvgs: number[] = [];
    for (const d of sortedDates) {
      const rets = perDay.get(d);
      if (!rets || rets.length === 0) continue;
      for (const r of rets) {
        totalPicks++;
        if (r > 0) wins++;
        returnSum += r;
      }
      const dayAvg = rets.reduce((s, x) => s + x, 0) / rets.length;
      dailyAvgs.push(dayAvg);
      cumulative *= 1 + dayAvg / 100;
    }
    const wr = totalPicks > 0 ? (wins / totalPicks) * 100 : 0;
    const avg = totalPicks > 0 ? returnSum / totalPicks : 0;
    const cumPct = (cumulative - 1) * 100;
    console.log(
      `${String(h).padStart(5)}d  ${String(totalPicks).padStart(6)}   ${wr.toFixed(2).padStart(6)}%    ${avg >= 0 ? "+" : ""}${avg.toFixed(2).padStart(5)}%            ${cumPct >= 0 ? "+" : ""}${cumPct.toFixed(1)}%`,
    );
  }

  source.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
