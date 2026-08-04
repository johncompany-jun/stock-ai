import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { candles, predictionLog, predictions, stocks } from "./db/schema";

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/api/stocks", async (c) => {
  const db = drizzle(c.env.DB);
  const q = c.req.query("q")?.trim();
  const market = c.req.query("market")?.trim();
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const offset = Number(c.req.query("offset") ?? "0");

  const filters = [];
  if (q) filters.push(or(like(stocks.code, `${q}%`), like(stocks.name, `%${q}%`))!);
  if (market) filters.push(eq(stocks.market, market));

  const where = filters.length ? and(...filters) : undefined;

  const [items, [{ count }]] = await Promise.all([
    db.select().from(stocks).where(where).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(stocks).where(where),
  ]);

  return c.json({ items, total: count, limit, offset });
});

app.get("/api/stocks/:code", async (c) => {
  const db = drizzle(c.env.DB);
  const code = c.req.param("code");
  const [row] = await db.select().from(stocks).where(eq(stocks.code, code)).limit(1);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.get("/api/candles/:code", async (c) => {
  const db = drizzle(c.env.DB);
  const code = c.req.param("code");
  const from = Number(c.req.query("from") ?? "0");
  const to = Number(c.req.query("to") ?? "99999999");
  const limit = Math.min(Number(c.req.query("limit") ?? "2000"), 5000);

  const filters = [eq(candles.code, code)];
  if (from) filters.push(gte(candles.date, from));
  if (to && to !== 99999999) filters.push(lte(candles.date, to));

  const rows = await db
    .select({
      date: candles.date,
      open: candles.open,
      high: candles.high,
      low: candles.low,
      close: candles.close,
      volume: candles.volume,
      adjClose: candles.adjClose,
    })
    .from(candles)
    .where(and(...filters))
    .orderBy(asc(candles.date))
    .limit(limit);

  return c.json({ code, candles: rows });
});

const ALL_MODELS = [
  "lstm_v1",
  "sma_cross_v1",
  "rsi_reversal_v1",
  "volume_breakout_v1",
] as const;

const computeConfidence = (
  currentClose: number,
  selectedPrediction: number,
  perModelPreds: Array<number | null>,
): { agreement: number; agreementTotal: number; returnStdevPct: number; confidence: number } => {
  const selectedDir = Math.sign(selectedPrediction - currentClose);
  const returnPcts: number[] = [];
  let agreement = 0;
  let total = 0;

  for (const p of perModelPreds) {
    if (p == null) continue;
    total++;
    if (Math.sign(p - currentClose) === selectedDir && selectedDir !== 0) agreement++;
    returnPcts.push(((p - currentClose) / currentClose) * 100);
  }

  const directionScore = total > 0 ? (agreement / total) * 100 : 0;

  let returnStdevPct = 0;
  let magnitudeScore = 50;
  if (returnPcts.length >= 2) {
    const mean = returnPcts.reduce((a, b) => a + b, 0) / returnPcts.length;
    const variance =
      returnPcts.reduce((s, x) => s + (x - mean) * (x - mean), 0) / returnPcts.length;
    returnStdevPct = Math.sqrt(variance);
    const cv = returnStdevPct / Math.max(Math.abs(mean), 1);
    magnitudeScore = Math.max(0, Math.min(100, 100 * (1 - cv / 2)));
  }

  const confidence = Math.round(0.65 * directionScore + 0.35 * magnitudeScore);
  return {
    agreement,
    agreementTotal: total,
    returnStdevPct,
    confidence,
  };
};

app.get("/api/rankings", async (c) => {
  const db = drizzle(c.env.DB);
  const budget = Math.max(1, Number(c.req.query("budget") ?? "100000"));
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
  const sort = c.req.query("sort") === "return" ? "return" : "profit";
  const model = c.req.query("model") ?? "lstm_v1";
  const minAgreement = Math.min(
    ALL_MODELS.length,
    Math.max(0, Number(c.req.query("minAgreement") ?? "0")),
  );
  const fetchLimit = minAgreement > 0 ? Math.min(limit * 10, 500) : limit;

  const currentClose = sql<number>`(
    SELECT c.close FROM candles c
    WHERE c.code = ${predictions.code} AND c.close > 0
    ORDER BY c.date DESC LIMIT 1
  )`;
  const currentDate = sql<number>`(
    SELECT c.date FROM candles c
    WHERE c.code = ${predictions.code} AND c.close > 0
    ORDER BY c.date DESC LIMIT 1
  )`;
  const predByModel = (name: string) => sql<number | null>`(
    SELECT p2.predicted_close FROM predictions p2
    WHERE p2.code = ${predictions.code} AND p2.model_name = ${name}
  )`;
  const predLstm = predByModel("lstm_v1");
  const predSma = predByModel("sma_cross_v1");
  const predRsi = predByModel("rsi_reversal_v1");
  const predVol = predByModel("volume_breakout_v1");

  const returnPct = sql<number>`((${predictions.predictedClose} - ${currentClose}) / ${currentClose}) * 100`;
  const lots = sql<number>`CAST(${budget} / (${currentClose} * 100) AS INTEGER)`;
  const profit = sql<number>`(${predictions.predictedClose} - ${currentClose}) * 100 * ${lots}`;
  const order = sort === "return" ? sql`${returnPct} DESC` : sql`${profit} DESC`;

  const rows = await db
    .select({
      code: predictions.code,
      name: stocks.name,
      market: stocks.market,
      modelName: predictions.modelName,
      currentClose,
      currentDate,
      predictedClose: predictions.predictedClose,
      expectedReturnPct: returnPct,
      lastDate: predictions.lastDate,
      runAt: predictions.runAt,
      buyableLots: lots,
      expectedProfitYen: profit,
      predLstm,
      predSma,
      predRsi,
      predVol,
    })
    .from(predictions)
    .innerJoin(stocks, eq(stocks.code, predictions.code))
    .where(
      sql`${predictions.modelName} = ${model}
        AND ${currentClose} IS NOT NULL
        AND ${currentClose} * 100 <= ${budget}
        AND ${currentClose} >= 100
        AND ABS(${returnPct}) <= 30`,
    )
    .orderBy(order)
    .limit(fetchLimit);

  const items = rows.map((r) => {
    const preds: Record<string, number | null> = {
      lstm_v1: r.predLstm,
      sma_cross_v1: r.predSma,
      rsi_reversal_v1: r.predRsi,
      volume_breakout_v1: r.predVol,
    };
    const perModel = ALL_MODELS.map((m) => preds[m] ?? null);
    const conf = computeConfidence(r.currentClose, r.predictedClose, perModel);
    return {
      code: r.code,
      name: r.name,
      market: r.market,
      modelName: r.modelName,
      currentClose: r.currentClose,
      currentDate: r.currentDate,
      predictedClose: r.predictedClose,
      expectedReturnPct: r.expectedReturnPct,
      lastDate: r.lastDate,
      runAt: r.runAt,
      buyableLots: r.buyableLots,
      expectedProfitYen: r.expectedProfitYen,
      predictionsByModel: preds,
      agreement: conf.agreement,
      agreementTotal: conf.agreementTotal,
      returnStdevPct: conf.returnStdevPct,
      confidence: conf.confidence,
    };
  });

  const filtered = minAgreement > 0
    ? items.filter((it) => it.agreement >= minAgreement)
    : items;

  return c.json({
    items: filtered.slice(0, limit),
    budget,
    sort,
    limit,
    model,
    minAgreement,
  });
});

app.get("/api/backtest-agreement", async (c) => {
  const db = drizzle(c.env.DB);
  const selectedModel = c.req.query("model") ?? "lstm_v1";
  if (!ALL_MODELS.includes(selectedModel as (typeof ALL_MODELS)[number])) {
    return c.json({ error: `unknown model: ${selectedModel}` }, 400);
  }

  const rows = (await db
    .select({
      horizonDays: predictionLog.horizonDays,
      code: predictionLog.code,
      runDate: predictionLog.runDate,
      modelName: predictionLog.modelName,
      lastClose: predictionLog.lastClose,
      predictedClose: predictionLog.predictedClose,
      actualClose: predictionLog.actualClose,
    })
    .from(predictionLog)
    .where(sql`${predictionLog.actualClose} IS NOT NULL`)) as Array<{
      horizonDays: number;
      code: string;
      runDate: number;
      modelName: string;
      lastClose: number;
      predictedClose: number;
      actualClose: number;
    }>;

  type Group = {
    lastClose: number;
    actualClose: number;
    perModel: Map<string, number>;
  };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.horizonDays}|${r.code}|${r.runDate}`;
    let g = groups.get(key);
    if (!g) {
      g = { lastClose: r.lastClose, actualClose: r.actualClose, perModel: new Map() };
      groups.set(key, g);
    }
    g.perModel.set(r.modelName, r.predictedClose);
  }

  type BucketAgg = { n: number; hits: number };
  const buckets = new Map<string, BucketAgg>();
  for (const [key, g] of groups) {
    const horizon = Number(key.split("|")[0]);
    const selectedPred = g.perModel.get(selectedModel);
    if (selectedPred == null) continue;
    const selectedDir = Math.sign(selectedPred - g.lastClose);
    if (selectedDir === 0) continue;
    let agreement = 0;
    let total = 0;
    for (const m of ALL_MODELS) {
      const p = g.perModel.get(m);
      if (p == null) continue;
      total++;
      if (Math.sign(p - g.lastClose) === selectedDir) agreement++;
    }
    const actualDir = Math.sign(g.actualClose - g.lastClose);
    const hit = actualDir === selectedDir ? 1 : 0;
    const bkey = `${horizon}|${agreement}|${total}`;
    let b = buckets.get(bkey);
    if (!b) {
      b = { n: 0, hits: 0 };
      buckets.set(bkey, b);
    }
    b.n++;
    b.hits += hit;
  }

  const out = Array.from(buckets.entries())
    .map(([bkey, b]) => {
      const [h, a, t] = bkey.split("|").map(Number);
      return {
        horizonDays: h,
        agreement: a,
        agreementTotal: t,
        n: b.n,
        hitPct: b.n > 0 ? (b.hits / b.n) * 100 : 0,
      };
    })
    .sort((x, y) => x.horizonDays - y.horizonDays || y.agreement - x.agreement);

  return c.json({ model: selectedModel, buckets: out });
});

app.get("/api/backtest", async (c) => {
  const db = drizzle(c.env.DB);
  const modelName = c.req.query("model") ?? "lstm_v1";

  const byHorizon = await db
    .select({
      horizonDays: predictionLog.horizonDays,
      n: sql<number>`COUNT(*)`,
      maePct: sql<number>`AVG(ABS(${predictionLog.errorPct}))`,
      rmsePct: sql<number>`SQRT(AVG(${predictionLog.errorPct} * ${predictionLog.errorPct}))`,
      hitPct: sql<number>`AVG(${predictionLog.directionHit}) * 100`,
      biasPct: sql<number>`AVG(${predictionLog.errorPct})`,
    })
    .from(predictionLog)
    .where(eq(predictionLog.modelName, modelName))
    .groupBy(predictionLog.horizonDays)
    .orderBy(asc(predictionLog.horizonDays));

  const [meta] = await db
    .select({
      rows: sql<number>`COUNT(*)`,
      stocks: sql<number>`COUNT(DISTINCT ${predictionLog.code})`,
      runDates: sql<number>`COUNT(DISTINCT ${predictionLog.runDate})`,
    })
    .from(predictionLog)
    .where(eq(predictionLog.modelName, modelName));

  return c.json({ model: modelName, meta, byHorizon });
});

export default app;
