import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    tpPips: { type: "string", default: "20" },
    slPips: { type: "string", default: "20" },
    spreadPips: { type: "string", default: "0.4" },
  },
});

const PAIR = values.pair.toUpperCase();
const TP_PIPS = Number(values.tpPips);
const SL_PIPS = Number(values.slPips);
const SPREAD = Number(values.spreadPips);

type Row = {
  date: string;
  ny_delta_pips: number | null;
  morning_trend_bps: number | null;
  gotoubi_flag: number;
  dow: number;
  label_995_pips: number | null;
  tp_hit_min: number | null;
  sl_hit_min: number | null;
};

const D1_ROOT = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const findLocalDb = (): string => {
  const files = readdirSync(D1_ROOT).filter((f) => f.endsWith(".sqlite"));
  if (files.length === 0) throw new Error(`no local D1 sqlite in ${D1_ROOT}`);
  return resolve(D1_ROOT, files[0]);
};

const pnlLong = (r: Row): number | null => {
  if (r.label_995_pips === null) return null;
  const tp = r.tp_hit_min;
  const sl = r.sl_hit_min;
  if (tp === null && sl === null) return r.label_995_pips;
  if (tp !== null && sl === null) return TP_PIPS;
  if (sl !== null && tp === null) return -SL_PIPS;
  return (tp as number) < (sl as number) ? TP_PIPS : -SL_PIPS;
};

const pnlShort = (r: Row): number | null => {
  if (r.label_995_pips === null) return null;
  const tp = r.tp_hit_min;
  const sl = r.sl_hit_min;
  if (tp === null && sl === null) return -r.label_995_pips;
  if (sl !== null && tp === null) return TP_PIPS;
  if (tp !== null && sl === null) return -SL_PIPS;
  return (sl as number) < (tp as number) ? TP_PIPS : -SL_PIPS;
};

type Stats = { n: number; wins: number; losses: number; ties: number; sumPips: number; sumNetPips: number };

const summarize = (rows: Row[], pnl: (r: Row) => number | null): Stats => {
  const s: Stats = { n: 0, wins: 0, losses: 0, ties: 0, sumPips: 0, sumNetPips: 0 };
  for (const r of rows) {
    const p = pnl(r);
    if (p === null) continue;
    s.n++;
    s.sumPips += p;
    s.sumNetPips += p - SPREAD;
    if (p > 0) s.wins++;
    else if (p < 0) s.losses++;
    else s.ties++;
  }
  return s;
};

const fmtStats = (label: string, s: Stats): string => {
  if (s.n === 0) return `  ${label.padEnd(38)}  n=0`;
  const winRate = ((s.wins / s.n) * 100).toFixed(1);
  const avgGross = (s.sumPips / s.n).toFixed(2);
  const avgNet = (s.sumNetPips / s.n).toFixed(2);
  const totalNet = s.sumNetPips.toFixed(0);
  return `  ${label.padEnd(38)}  n=${String(s.n).padStart(3)}  win%=${winRate.padStart(5)}  avg=${avgGross.padStart(6)}pips  net=${avgNet.padStart(6)}pips  total=${totalNet.padStart(6)}pips`;
};

const main = async () => {
  const db = new Database(findLocalDb(), { readonly: true });
  const rows = db
    .query<Row, [string]>(
      "SELECT date, ny_delta_pips, morning_trend_bps, gotoubi_flag, dow, label_995_pips, tp_hit_min, sl_hit_min FROM fx_features WHERE pair = ? ORDER BY date",
    )
    .all(PAIR);
  db.close();

  const valid = rows.filter((r) => r.label_995_pips !== null);
  console.log(`=== fx_features report: ${PAIR}  n=${rows.length}  valid=${valid.length}  TP=${TP_PIPS}p  SL=${SL_PIPS}p  spread=${SPREAD}p ===\n`);

  // Label distribution
  const labels = valid.map((r) => r.label_995_pips as number).sort((a, b) => a - b);
  const mean = labels.reduce((a, b) => a + b, 0) / labels.length;
  const stdev = Math.sqrt(labels.reduce((a, b) => a + (b - mean) ** 2, 0) / labels.length);
  const pos = labels.filter((v) => v > 0).length;
  const neg = labels.filter((v) => v < 0).length;
  const q = (p: number) => labels[Math.floor(labels.length * p)].toFixed(2);
  console.log("[9:55 close p&l distribution (pips)]");
  console.log(`  mean=${mean.toFixed(2)}  stdev=${stdev.toFixed(2)}  min=${labels[0].toFixed(2)}  max=${labels.at(-1)?.toFixed(2)}`);
  console.log(`  q25=${q(0.25)}  median=${q(0.5)}  q75=${q(0.75)}`);
  console.log(`  positive=${pos}/${labels.length} (${((pos / labels.length) * 100).toFixed(1)}%)  negative=${neg} (${((neg / labels.length) * 100).toFixed(1)}%)\n`);

  // TP/SL first-hit rates
  const tpOnly = valid.filter((r) => r.tp_hit_min !== null && r.sl_hit_min === null).length;
  const slOnly = valid.filter((r) => r.sl_hit_min !== null && r.tp_hit_min === null).length;
  const both = valid.filter((r) => r.tp_hit_min !== null && r.sl_hit_min !== null);
  const bothTpFirst = both.filter((r) => (r.tp_hit_min as number) < (r.sl_hit_min as number)).length;
  const neither = valid.filter((r) => r.tp_hit_min === null && r.sl_hit_min === null).length;
  console.log(`[TP/SL hit within ${85}min window]`);
  console.log(`  TP-only=${tpOnly}  SL-only=${slOnly}  both=${both.length} (TP-first=${bothTpFirst})  neither=${neither}\n`);

  // Naive rules
  console.log("[Naive rules — LONG entry (net = after spread)]");
  console.log(fmtStats("always LONG", summarize(valid, pnlLong)));
  console.log(fmtStats("LONG if morning_trend > 0", summarize(valid.filter((r) => (r.morning_trend_bps ?? 0) > 0), pnlLong)));
  console.log(fmtStats("LONG if morning_trend < 0", summarize(valid.filter((r) => (r.morning_trend_bps ?? 0) < 0), pnlLong)));
  console.log(fmtStats("LONG if ny_delta > 0", summarize(valid.filter((r) => (r.ny_delta_pips ?? 0) > 0), pnlLong)));
  console.log(fmtStats("LONG if ny_delta < 0", summarize(valid.filter((r) => (r.ny_delta_pips ?? 0) < 0), pnlLong)));
  console.log(fmtStats("LONG on gotoubi days", summarize(valid.filter((r) => r.gotoubi_flag === 1), pnlLong)));
  console.log(fmtStats("LONG on Monday", summarize(valid.filter((r) => r.dow === 1), pnlLong)));

  console.log("\n[Naive rules — SHORT entry (net = after spread)]");
  console.log(fmtStats("always SHORT", summarize(valid, pnlShort)));
  console.log(fmtStats("SHORT if morning_trend > 0", summarize(valid.filter((r) => (r.morning_trend_bps ?? 0) > 0), pnlShort)));
  console.log(fmtStats("SHORT if morning_trend < 0", summarize(valid.filter((r) => (r.morning_trend_bps ?? 0) < 0), pnlShort)));
  console.log(fmtStats("SHORT if ny_delta > 0", summarize(valid.filter((r) => (r.ny_delta_pips ?? 0) > 0), pnlShort)));
  console.log(fmtStats("SHORT if ny_delta < 0", summarize(valid.filter((r) => (r.ny_delta_pips ?? 0) < 0), pnlShort)));

  // Perfect oracle: pick side with higher pnl every day
  const perfectSum = valid.reduce((acc, r) => {
    const l = pnlLong(r);
    const s = pnlShort(r);
    if (l === null || s === null) return acc;
    return acc + Math.max(l, s) - SPREAD;
  }, 0);
  console.log(`\n[Oracle upper bound]  perfect side pick every day: net=${perfectSum.toFixed(0)}pips  avg=${(perfectSum / valid.length).toFixed(2)}pips`);
};

await main();
