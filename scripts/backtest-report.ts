import { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "lstm_v1" },
  },
});
const MODEL = values.model!;

const findSqlitePath = (): string => {
  const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  if (!files.length) throw new Error(`no sqlite file in ${dir}`);
  const withSize = files.map((f) => ({ f, size: statSync(`${dir}/${f}`).size }));
  withSize.sort((a, b) => b.size - a.size);
  return `${dir}/${withSize[0].f}`;
};

const fmt = (n: number, d = 2) => n.toFixed(d);
const pad = (s: string, n: number) => s.padStart(n);

const main = () => {
  const db = new Database(findSqlitePath(), { readonly: true });

  const overall = db
    .query(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT code) AS stocks, COUNT(DISTINCT run_date) AS run_dates
       FROM prediction_log WHERE model_name = ?`,
    )
    .get(MODEL) as { n: number; stocks: number; run_dates: number };
  console.log(`\nmodel=${MODEL}  rows=${overall.n}  stocks=${overall.stocks}  distinct_run_dates=${overall.run_dates}\n`);
  if (overall.n === 0) {
    console.log("no data yet.");
    return;
  }

  const byHorizon = db
    .query(
      `SELECT
         horizon_days,
         COUNT(*) AS n,
         ROUND(AVG(ABS(error_pct)), 2) AS mae_pct,
         ROUND(SQRT(AVG(error_pct * error_pct)), 2) AS rmse_pct,
         ROUND(AVG(direction_hit) * 100, 1) AS hit_pct,
         ROUND(AVG(error_pct), 2) AS bias_pct
       FROM prediction_log
       WHERE model_name = ?
       GROUP BY horizon_days
       ORDER BY horizon_days`,
    )
    .all(MODEL) as Array<{
      horizon_days: number;
      n: number;
      mae_pct: number;
      rmse_pct: number;
      hit_pct: number;
      bias_pct: number;
    }>;

  console.log("=== horizon 別 精度 ===");
  console.log(`${pad("horizon", 8)}  ${pad("n", 5)}  ${pad("MAE%", 7)}  ${pad("RMSE%", 7)}  ${pad("hit%", 6)}  ${pad("bias%", 7)}`);
  console.log("-".repeat(52));
  for (const r of byHorizon) {
    console.log(
      `${pad(String(r.horizon_days) + "d", 8)}  ${pad(String(r.n), 5)}  ${pad(fmt(r.mae_pct), 7)}  ${pad(fmt(r.rmse_pct), 7)}  ${pad(fmt(r.hit_pct, 1), 6)}  ${pad(fmt(r.bias_pct), 7)}`,
    );
  }

  console.log("\n凡例:");
  console.log("  MAE%   平均絶対誤差(小さいほど良い)");
  console.log("  RMSE%  二乗平均平方根誤差(外れ値に敏感)");
  console.log("  hit%   方向的中率(50%=五分五分、>55%で意味あり)");
  console.log("  bias%  平均誤差の符号付き(+は予測が上方向に偏り、-は下方向)");

  const bestHorizon = [...byHorizon].sort((a, b) => a.mae_pct - b.mae_pct)[0];
  const bestHit = [...byHorizon].sort((a, b) => b.hit_pct - a.hit_pct)[0];
  console.log(`\n最小 MAE: horizon=${bestHorizon.horizon_days}d (${bestHorizon.mae_pct}%)`);
  console.log(`最高 方向的中率: horizon=${bestHit.horizon_days}d (${bestHit.hit_pct}%)`);

  const badRuns = db
    .query(
      `SELECT code, run_date, horizon_days,
              ROUND(last_close, 1) AS last_close,
              ROUND(predicted_close, 1) AS predicted,
              ROUND(actual_close, 1) AS actual,
              ROUND(error_pct, 1) AS err_pct
       FROM prediction_log
       WHERE model_name = ?
       ORDER BY ABS(error_pct) DESC
       LIMIT 5`,
    )
    .all(MODEL);
  console.log("\n=== ワースト 5(絶対誤差率大) ===");
  console.log(JSON.stringify(badRuns, null, 2));

  const pivoted = db
    .query(
      `SELECT
         horizon_days, code, run_date,
         MAX(last_close) AS last_close,
         MAX(actual_close) AS actual_close,
         MAX(CASE WHEN model_name = 'lstm_v1' THEN predicted_close END) AS pred_lstm,
         MAX(CASE WHEN model_name = 'sma_cross_v1' THEN predicted_close END) AS pred_sma,
         MAX(CASE WHEN model_name = 'rsi_reversal_v1' THEN predicted_close END) AS pred_rsi,
         MAX(CASE WHEN model_name = 'volume_breakout_v1' THEN predicted_close END) AS pred_vol
       FROM prediction_log
       WHERE actual_close IS NOT NULL
       GROUP BY horizon_days, code, run_date`,
    )
    .all() as Array<{
      horizon_days: number;
      last_close: number;
      actual_close: number;
      pred_lstm: number | null;
      pred_sma: number | null;
      pred_rsi: number | null;
      pred_vol: number | null;
    }>;

  const modelKey = MODEL as "lstm_v1" | "sma_cross_v1" | "rsi_reversal_v1" | "volume_breakout_v1";
  const pickPred = (r: (typeof pivoted)[number], m: string): number | null => {
    if (m === "lstm_v1") return r.pred_lstm;
    if (m === "sma_cross_v1") return r.pred_sma;
    if (m === "rsi_reversal_v1") return r.pred_rsi;
    if (m === "volume_breakout_v1") return r.pred_vol;
    return null;
  };
  const ALL = ["lstm_v1", "sma_cross_v1", "rsi_reversal_v1", "volume_breakout_v1"];

  type Bucket = { n: number; hits: number };
  const buckets = new Map<string, Bucket>();
  for (const r of pivoted) {
    const selectedPred = pickPred(r, modelKey);
    if (selectedPred == null) continue;
    const selectedDir = Math.sign(selectedPred - r.last_close);
    if (selectedDir === 0) continue;
    let agr = 0;
    let total = 0;
    for (const m of ALL) {
      const p = pickPred(r, m);
      if (p == null) continue;
      total++;
      if (Math.sign(p - r.last_close) === selectedDir) agr++;
    }
    const actualDir = Math.sign(r.actual_close - r.last_close);
    const hit = actualDir === selectedDir ? 1 : 0;
    const key = `${r.horizon_days}|${agr}|${total}`;
    const b = buckets.get(key) ?? { n: 0, hits: 0 };
    b.n++;
    b.hits += hit;
    buckets.set(key, b);
  }

  if (buckets.size > 0) {
    console.log("\n=== 信頼度別 実測勝率 (選択モデル=" + MODEL + ") ===");
    console.log(`${pad("horizon", 8)}  ${pad("一致", 6)}  ${pad("n", 5)}  ${pad("hit%", 6)}`);
    console.log("-".repeat(34));
    const rows = Array.from(buckets.entries())
      .map(([k, v]) => {
        const [h, a, t] = k.split("|").map(Number);
        return { h, a, t, n: v.n, hitPct: v.n > 0 ? (v.hits / v.n) * 100 : 0 };
      })
      .sort((x, y) => x.h - y.h || y.a - x.a);
    for (const r of rows) {
      console.log(
        `${pad(r.h + "d", 8)}  ${pad(`${r.a}/${r.t}`, 6)}  ${pad(String(r.n), 5)}  ${pad(fmt(r.hitPct, 1), 6)}`,
      );
    }
  }

  db.close();
};

main();
