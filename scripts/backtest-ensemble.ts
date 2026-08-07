import { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";

const ALL_MODELS = ["lstm_v1", "sma_cross_v1", "rsi_reversal_v1", "volume_breakout_v1"] as const;
type ModelKey = (typeof ALL_MODELS)[number];
const WEIGHT_HORIZON = 20;
const MIN_WEIGHT_SAMPLES = 20;

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

const computeWeights = (
  db: Database,
): { weights: Record<ModelKey, number>; rawHitPct: Record<ModelKey, number>; sampleN: Record<ModelKey, number> } => {
  const rows = db
    .query(
      `SELECT model_name,
              AVG(direction_hit) * 100 AS hit_pct,
              COUNT(*) AS n
       FROM prediction_log
       WHERE horizon_days = ?
         AND direction_hit IS NOT NULL
         AND predicted_close != last_close
       GROUP BY model_name`,
    )
    .all(WEIGHT_HORIZON) as Array<{ model_name: string; hit_pct: number; n: number }>;

  const weights = Object.fromEntries(ALL_MODELS.map((m) => [m, 0])) as Record<ModelKey, number>;
  const rawHitPct = Object.fromEntries(ALL_MODELS.map((m) => [m, 0])) as Record<ModelKey, number>;
  const sampleN = Object.fromEntries(ALL_MODELS.map((m) => [m, 0])) as Record<ModelKey, number>;
  for (const r of rows) {
    if (!ALL_MODELS.includes(r.model_name as ModelKey)) continue;
    const m = r.model_name as ModelKey;
    rawHitPct[m] = r.hit_pct;
    sampleN[m] = r.n;
    weights[m] = r.n >= MIN_WEIGHT_SAMPLES ? Math.max(0, r.hit_pct - 50) : 0;
  }
  const total = ALL_MODELS.reduce((s, m) => s + weights[m], 0);
  if (total === 0) for (const m of ALL_MODELS) weights[m] = 1;
  return { weights, rawHitPct, sampleN };
};

const main = () => {
  const db = new Database(findSqlitePath());
  const { weights, rawHitPct, sampleN } = computeWeights(db);

  console.log("=== 重み (h=20 の non-flat hit% から max(0, hit-50)) ===");
  console.log(`${pad("model", 22)}  ${pad("n", 6)}  ${pad("hit%", 6)}  ${pad("weight", 6)}`);
  console.log("-".repeat(48));
  for (const m of ALL_MODELS) {
    console.log(
      `${pad(m, 22)}  ${pad(String(sampleN[m]), 6)}  ${pad(fmt(rawHitPct[m], 1), 6)}  ${pad(fmt(weights[m], 2), 6)}`,
    );
  }

  const rows = db
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
      code: string;
      run_date: number;
      last_close: number;
      actual_close: number;
      pred_lstm: number | null;
      pred_sma: number | null;
      pred_rsi: number | null;
      pred_vol: number | null;
    }>;

  type Agg = { n: number; hits: number; sumAbsErr: number };
  const perModelHorizon = new Map<string, Agg>();
  const key = (m: string, h: number) => `${m}|${h}`;
  const bump = (m: string, h: number, hit: number, absErr: number) => {
    const k = key(m, h);
    const a = perModelHorizon.get(k) ?? { n: 0, hits: 0, sumAbsErr: 0 };
    a.n++;
    a.hits += hit;
    a.sumAbsErr += absErr;
    perModelHorizon.set(k, a);
  };

  for (const r of rows) {
    const perModel: Record<ModelKey, number | null> = {
      lstm_v1: r.pred_lstm,
      sma_cross_v1: r.pred_sma,
      rsi_reversal_v1: r.pred_rsi,
      volume_breakout_v1: r.pred_vol,
    };
    const actualDir = Math.sign(r.actual_close - r.last_close);

    for (const m of ALL_MODELS) {
      const p = perModel[m];
      if (p == null) continue;
      const predDir = Math.sign(p - r.last_close);
      const hit = predDir !== 0 && predDir === actualDir ? 1 : 0;
      const absErr = (Math.abs(p - r.actual_close) / r.actual_close) * 100;
      bump(m, r.horizon_days, hit, absErr);
    }

    // v1: include all models (flat predictions drag toward lastClose)
    {
      let num = 0;
      let den = 0;
      for (const m of ALL_MODELS) {
        const p = perModel[m];
        if (p == null) continue;
        num += weights[m] * p;
        den += weights[m];
      }
      if (den > 0) {
        const ensPred = num / den;
        const ensDir = Math.sign(ensPred - r.last_close);
        const ensHit = ensDir !== 0 && ensDir === actualDir ? 1 : 0;
        const ensAbsErr = (Math.abs(ensPred - r.actual_close) / r.actual_close) * 100;
        bump("ensemble_v1", r.horizon_days, ensHit, ensAbsErr);
      }
    }
    // v2: skip flat models per-row (only directional models contribute)
    {
      let num = 0;
      let den = 0;
      for (const m of ALL_MODELS) {
        const p = perModel[m];
        if (p == null) continue;
        if (p === r.last_close) continue;
        num += weights[m] * p;
        den += weights[m];
      }
      if (den > 0) {
        const ensPred = num / den;
        const ensDir = Math.sign(ensPred - r.last_close);
        const ensHit = ensDir !== 0 && ensDir === actualDir ? 1 : 0;
        const ensAbsErr = (Math.abs(ensPred - r.actual_close) / r.actual_close) * 100;
        bump("ensemble_v2_noflat", r.horizon_days, ensHit, ensAbsErr);
      }
    }
  }

  const horizons = Array.from(new Set(rows.map((r) => r.horizon_days))).sort((a, b) => a - b);
  const models = [...ALL_MODELS, "ensemble_v1", "ensemble_v2_noflat"] as const;

  console.log("\n=== horizon 別 hit% (方向的中率) ===");
  console.log(`${pad("model", 22)}  ${horizons.map((h) => pad(h + "d", 8)).join("  ")}`);
  console.log("-".repeat(24 + horizons.length * 10));
  for (const m of models) {
    const cells = horizons.map((h) => {
      const a = perModelHorizon.get(key(m, h));
      if (!a || a.n === 0) return pad("-", 8);
      return pad(`${fmt((a.hits / a.n) * 100, 1)}%`, 8);
    });
    console.log(`${pad(m, 22)}  ${cells.join("  ")}`);
  }

  console.log("\n=== horizon 別 MAE% (平均絶対誤差) ===");
  console.log(`${pad("model", 22)}  ${horizons.map((h) => pad(h + "d", 8)).join("  ")}`);
  console.log("-".repeat(24 + horizons.length * 10));
  for (const m of models) {
    const cells = horizons.map((h) => {
      const a = perModelHorizon.get(key(m, h));
      if (!a || a.n === 0) return pad("-", 8);
      return pad(fmt(a.sumAbsErr / a.n, 2), 8);
    });
    console.log(`${pad(m, 22)}  ${cells.join("  ")}`);
  }

  console.log("\n=== sample size (n) ===");
  console.log(`${pad("model", 22)}  ${horizons.map((h) => pad(h + "d", 8)).join("  ")}`);
  console.log("-".repeat(24 + horizons.length * 10));
  for (const m of models) {
    const cells = horizons.map((h) => {
      const a = perModelHorizon.get(key(m, h));
      return pad(String(a?.n ?? 0), 8);
    });
    console.log(`${pad(m, 22)}  ${cells.join("  ")}`);
  }

  console.log("\n注: 重みは全 prediction_log から算出。同じデータで ensemble を評価してるので look-ahead bias あり。");
  console.log("    ensemble hit% が base より明らかに劣る場合は「重み設計が悪い」ことが確定。");
  console.log("    ensemble hit% が base 最良より僅かに良い程度なら、実運用では実力伯仲の可能性あり。");

  db.close();
};

main();
