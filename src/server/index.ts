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

app.get("/api/rankings", async (c) => {
  const db = drizzle(c.env.DB);
  const budget = Math.max(1, Number(c.req.query("budget") ?? "100000"));
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
  const sort = c.req.query("sort") === "return" ? "return" : "profit";

  const lots = sql<number>`CAST(${budget} / (${predictions.lastClose} * 100) AS INTEGER)`;
  const profit = sql<number>`(${predictions.predictedClose} - ${predictions.lastClose}) * 100 * ${lots}`;
  const order = sort === "return" ? sql`${predictions.expectedReturnPct} DESC` : sql`${profit} DESC`;

  const rows = await db
    .select({
      code: predictions.code,
      name: stocks.name,
      market: stocks.market,
      lastClose: predictions.lastClose,
      predictedClose: predictions.predictedClose,
      expectedReturnPct: predictions.expectedReturnPct,
      lastDate: predictions.lastDate,
      runAt: predictions.runAt,
      buyableLots: lots,
      expectedProfitYen: profit,
    })
    .from(predictions)
    .innerJoin(stocks, eq(stocks.code, predictions.code))
    .where(
      sql`${predictions.lastClose} * 100 <= ${budget}
        AND ${predictions.lastClose} >= 100
        AND ABS(${predictions.expectedReturnPct}) <= 30`,
    )
    .orderBy(order)
    .limit(limit);

  return c.json({ items: rows, budget, sort, limit });
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
