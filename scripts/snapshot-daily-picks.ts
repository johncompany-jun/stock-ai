import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    sourceUrl: { type: "string", default: "https://stock-ai.uk" },
    model: { type: "string", default: "lstm_v1" },
    budget: { type: "string", default: "100000000" },
    limit: { type: "string", default: "500" },
    minConfidence: { type: "string", default: "60" },
    out: { type: "string", default: "data/daily_picks.sql" },
    apply: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});

const SOURCE_URL = values.sourceUrl!;
const MODEL = values.model!;
const BUDGET = Number(values.budget);
const LIMIT = Number(values.limit);
const MIN_CONFIDENCE = Number(values.minConfidence);
const OUT_PATH = resolve(process.cwd(), values.out!);
const DB_NAME = "stock-ai";

type RankingItem = {
  code: string;
  modelName: string;
  currentClose: number;
  currentDate: number;
  predictedClose: number;
  expectedReturnPct: number;
  predictionsByModel: Record<string, number | null>;
  agreement: number;
  agreementTotal: number;
  returnStdevPct: number;
  confidence: number;
  confidenceTier: string | null;
};

const sqlEscape = (s: string): string => s.replace(/'/g, "''");

const applySql = (path: string) => {
  const remoteFlag = values.remote ? "--remote" : "--local";
  const res = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DB_NAME, remoteFlag, "--file", path],
    { encoding: "utf8", stdio: "inherit", maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error("apply failed");
};

const main = async () => {
  const url = new URL("/api/rankings", SOURCE_URL);
  url.searchParams.set("model", MODEL);
  url.searchParams.set("budget", String(BUDGET));
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("sort", "return");
  // API は `limit` を 100 で丸めるが、`minAgreement > 0` を渡すと内部の
  // fetchLimit が最大 500 に拡張されるためスナップショット漏れが減る。
  url.searchParams.set("minAgreement", "1");
  url.searchParams.set("tierAOnly", "0");

  console.log(`fetch: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rankings fetch failed: ${res.status}`);
  const body = (await res.json()) as { items: RankingItem[] };
  const items = body.items ?? [];
  console.log(`fetched: ${items.length} items`);

  const picks = items.filter(
    (it) => it.confidence >= MIN_CONFIDENCE || it.confidenceTier === "A",
  );
  console.log(
    `picks: ${picks.length} (confidence>=${MIN_CONFIDENCE} or tierA)`,
  );
  if (picks.length === 0) {
    console.log("no picks to snapshot; exiting");
    return;
  }

  // horizon_days は API に載っていないので lstm の設定 (5) を採用。
  // 予測が別 horizon の場合は script 側で override 可能。
  const HORIZON_DAYS = 5;
  const now = Math.floor(Date.now() / 1000);
  // run_date は「予測が参照している最新 candle 日 (JST)」を使う。
  // currentDate は API で YYYYMMDD 形式で返る。
  const runDates = new Set(picks.map((p) => p.currentDate));
  console.log(
    `run_date candidates: ${[...runDates].sort().join(",")} (picks span ${runDates.size} day(s))`,
  );

  const rows = picks.map((p) => {
    const preds = p.predictionsByModel ?? {};
    return {
      code: p.code,
      runDate: p.currentDate,
      modelName: p.modelName,
      horizonDays: HORIZON_DAYS,
      lastClose: p.currentClose,
      predictedClose: p.predictedClose,
      expectedReturnPct: p.expectedReturnPct,
      confidence: p.confidence,
      agreement: p.agreement,
      agreementTotal: p.agreementTotal,
      returnStdevPct: p.returnStdevPct,
      confidenceTier: p.confidenceTier,
      predsJson: JSON.stringify(preds),
    };
  });

  const BATCH = 100;
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const vals = slice
      .map(
        (r) =>
          `('${sqlEscape(r.code)}',${r.runDate},'${sqlEscape(r.modelName)}',${r.horizonDays},${r.lastClose},${r.predictedClose},${r.expectedReturnPct},${r.confidence},${r.agreement},${r.agreementTotal},${r.returnStdevPct},${r.confidenceTier ? `'${sqlEscape(r.confidenceTier)}'` : "NULL"},'${sqlEscape(r.predsJson)}',${now},${now})`,
      )
      .join(",\n");
    chunks.push(
      `INSERT INTO daily_picks (code,run_date,model_name,horizon_days,last_close,predicted_close,expected_return_pct,confidence,agreement,agreement_total,return_stdev_pct,confidence_tier,preds_json,created_at,updated_at) VALUES\n${vals}\nON CONFLICT(code,run_date) DO UPDATE SET model_name=excluded.model_name, horizon_days=excluded.horizon_days, last_close=excluded.last_close, predicted_close=excluded.predicted_close, expected_return_pct=excluded.expected_return_pct, confidence=excluded.confidence, agreement=excluded.agreement, agreement_total=excluded.agreement_total, return_stdev_pct=excluded.return_stdev_pct, confidence_tier=excluded.confidence_tier, preds_json=excluded.preds_json, updated_at=excluded.updated_at;`,
    );
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, chunks.join("\n\n") + "\n", "utf8");
  console.log(`wrote: ${OUT_PATH} (${rows.length} rows)`);

  if (values.apply) applySql(OUT_PATH);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
