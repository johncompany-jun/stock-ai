import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { candles, patternPicks, stocks } from "./db/schema";

type Bindings = {
  DB: D1Database;
  GITHUB_TOKEN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ status: "ok" }));

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

app.get("/api/backtest-candidates", async (c) => {
  const db = drizzle(c.env.DB);
  const marketsRaw = c.req.query("markets") ?? "東S,東G";
  const markets = marketsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const minRange = Math.max(0, Number(c.req.query("minRange") ?? "0.2"));
  const lookbackYears = Math.max(0.1, Number(c.req.query("lookbackYears") ?? "3"));
  const now = new Date();
  const sinceDate = new Date(now.getTime() - lookbackYears * 365 * 24 * 60 * 60 * 1000);
  const sinceYmd =
    sinceDate.getUTCFullYear() * 10000 +
    (sinceDate.getUTCMonth() + 1) * 100 +
    sinceDate.getUTCDate();

  const rows = (await db
    .select({ code: stocks.code })
    .from(stocks)
    .innerJoin(
      sql`(SELECT code, MAX(close) AS max_c, MIN(close) AS min_c
           FROM candles WHERE date >= ${sinceYmd} AND close > 0
           GROUP BY code) c`,
      sql`c.code = ${stocks.code}`,
    )
    .where(
      sql`${stocks.market} IN (${sql.join(markets.map((m) => sql`${m}`), sql`, `)})
          AND c.max_c / c.min_c >= ${1 + minRange}`,
    )) as Array<{ code: string }>;

  return c.json({
    codes: rows.map((r) => r.code),
    markets,
    minRange,
    lookbackYears,
    since: sinceYmd,
  });
});

app.get("/api/pattern-picks", async (c) => {
  const db = drizzle(c.env.DB);
  const limit = Math.min(Number(c.req.query("limit") ?? "500"), 2000);

  const latestDateRow = await db
    .select({ d: sql<number>`MAX(${patternPicks.runDate})` })
    .from(patternPicks);
  const latestDate = latestDateRow[0]?.d ?? null;

  const today = latestDate
    ? await db
        .select({
          code: patternPicks.code,
          runDate: patternPicks.runDate,
          patterns: patternPicks.patterns,
          entryClose: patternPicks.entryClose,
          name: stocks.name,
        })
        .from(patternPicks)
        .leftJoin(stocks, eq(stocks.code, patternPicks.code))
        .where(eq(patternPicks.runDate, latestDate))
        .orderBy(asc(patternPicks.code))
    : [];

  const [agg] = await db
    .select({
      n: sql<number>`COUNT(*)`,
      n5d: sql<number>`SUM(CASE WHEN ${patternPicks.return5dPct} IS NOT NULL THEN 1 ELSE 0 END)`,
      wr5d: sql<number>`ROUND(100.0 * SUM(CASE WHEN ${patternPicks.return5dPct} > 0 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN ${patternPicks.return5dPct} IS NOT NULL THEN 1 ELSE 0 END), 0), 2)`,
      avg5d: sql<number>`ROUND(AVG(${patternPicks.return5dPct}), 3)`,
      n15d: sql<number>`SUM(CASE WHEN ${patternPicks.return15dPct} IS NOT NULL THEN 1 ELSE 0 END)`,
      wr15d: sql<number>`ROUND(100.0 * SUM(CASE WHEN ${patternPicks.return15dPct} > 0 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN ${patternPicks.return15dPct} IS NOT NULL THEN 1 ELSE 0 END), 0), 2)`,
      avg15d: sql<number>`ROUND(AVG(${patternPicks.return15dPct}), 3)`,
      n30d: sql<number>`SUM(CASE WHEN ${patternPicks.return30dPct} IS NOT NULL THEN 1 ELSE 0 END)`,
      wr30d: sql<number>`ROUND(100.0 * SUM(CASE WHEN ${patternPicks.return30dPct} > 0 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN ${patternPicks.return30dPct} IS NOT NULL THEN 1 ELSE 0 END), 0), 2)`,
      avg30d: sql<number>`ROUND(AVG(${patternPicks.return30dPct}), 3)`,
      firstDate: sql<number>`MIN(${patternPicks.runDate})`,
      lastDate: sql<number>`MAX(${patternPicks.runDate})`,
    })
    .from(patternPicks);

  const history = (await db
    .select({
      runDate: patternPicks.runDate,
      n: sql<number>`COUNT(*)`,
      avg5d: sql<number>`AVG(${patternPicks.return5dPct})`,
      avg15d: sql<number>`AVG(${patternPicks.return15dPct})`,
      avg30d: sql<number>`AVG(${patternPicks.return30dPct})`,
    })
    .from(patternPicks)
    .groupBy(patternPicks.runDate)
    .orderBy(asc(patternPicks.runDate))
    .limit(limit)) as Array<{
    runDate: number;
    n: number;
    avg5d: number | null;
    avg15d: number | null;
    avg30d: number | null;
  }>;

  return c.json({ latestDate, today, agg, history });
});

const dispatchDailyFxSignal = async (token: string): Promise<void> => {
  const res = await fetch(
    "https://api.github.com/repos/johncompany-jun/stock-ai/actions/workflows/daily-fx-signal.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "stock-ai-cron",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`workflow_dispatch failed: ${res.status} ${res.statusText} ${detail}`);
  }
};

export default {
  fetch: app.fetch,
  scheduled: async (
    _event: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) => {
    if (!env.GITHUB_TOKEN) {
      console.error("GITHUB_TOKEN secret not set; skipping workflow dispatch");
      return;
    }
    ctx.waitUntil(dispatchDailyFxSignal(env.GITHUB_TOKEN));
  },
};
