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

  db.close();
};

main();
