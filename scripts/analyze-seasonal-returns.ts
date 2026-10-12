import { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";

const findSqlitePath = (): string => {
  const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  const withSize = files.map((f) => ({ f, size: statSync(`${dir}/${f}`).size }));
  withSize.sort((a, b) => b.size - a.size);
  return `${dir}/${withSize[0].f}`;
};

const path = findSqlitePath();
const db = new Database(path, { readonly: true });

const picks = db
  .query<{ code: string; run_date: number; entry_close: number }, []>(
    "SELECT code, run_date, entry_close FROM pattern_picks WHERE patterns = 'range_oscillator_buy'",
  )
  .all();

console.log(`picks: ${picks.length}`);

const candlesByCode = new Map<string, Array<{ date: number; close: number }>>();
const codes = Array.from(new Set(picks.map((p) => p.code)));
const candleStmt = db.query<
  { date: number; close: number },
  [string]
>("SELECT date, close FROM candles WHERE code = ? AND close > 0 ORDER BY date ASC");
for (const c of codes) {
  candlesByCode.set(c, candleStmt.all(c));
}

const idxByCode = new Map<string, Map<number, number>>();
for (const [code, cs] of candlesByCode) {
  const m = new Map<number, number>();
  for (let i = 0; i < cs.length; i++) m.set(cs[i].date, i);
  idxByCode.set(code, m);
}

type Stat = { n: number; wins: number; sum: number };
const buyMonthStats: Record<number, { d30: Stat; d60: Stat; d90: Stat }> = {};
const sellMonthStats: Record<number, Stat> = {};
for (let m = 1; m <= 12; m++) {
  buyMonthStats[m] = {
    d30: { n: 0, wins: 0, sum: 0 },
    d60: { n: 0, wins: 0, sum: 0 },
    d90: { n: 0, wins: 0, sum: 0 },
  };
  sellMonthStats[m] = { n: 0, wins: 0, sum: 0 };
}

for (const p of picks) {
  const cs = candlesByCode.get(p.code)!;
  const idxMap = idxByCode.get(p.code)!;
  const idx = idxMap.get(p.run_date);
  if (idx == null) continue;

  const buyMonth = Math.floor((p.run_date / 100) % 100);

  for (const [key, offset] of [
    ["d30", 30],
    ["d60", 60],
    ["d90", 90],
  ] as const) {
    const futIdx = idx + offset;
    if (futIdx >= cs.length) continue;
    const r = ((cs[futIdx].close - p.entry_close) / p.entry_close) * 100;
    const stat = buyMonthStats[buyMonth][key];
    stat.n++;
    stat.sum += r;
    if (r > 0) stat.wins++;

    if (key === "d90") {
      const sellMonth = Math.floor((cs[futIdx].date / 100) % 100);
      const s = sellMonthStats[sellMonth];
      s.n++;
      s.sum += r;
      if (r > 0) s.wins++;
    }
  }
}

const fmt = (s: Stat) => {
  if (s.n === 0) return "        -";
  const wr = (s.wins / s.n) * 100;
  const avg = s.sum / s.n;
  return `${s.n.toString().padStart(4)}件 勝率${wr.toFixed(1).padStart(5)}% 平均${(avg >= 0 ? "+" : "") + avg.toFixed(2).padStart(6)}%`;
};

console.log("\n=== BUY月別 (買った月で分類) ===");
console.log(`${"月".padEnd(3)}  30d                     60d                     90d`);
for (let m = 1; m <= 12; m++) {
  const s = buyMonthStats[m];
  console.log(`${m.toString().padStart(2)}月  ${fmt(s.d30)}  ${fmt(s.d60)}  ${fmt(s.d90)}`);
}

console.log("\n=== SELL月別 (90日後に売る月で分類) ===");
for (let m = 1; m <= 12; m++) {
  console.log(`${m.toString().padStart(2)}月  ${fmt(sellMonthStats[m])}`);
}

db.close();
