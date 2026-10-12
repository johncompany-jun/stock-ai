import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { candles, fxPredictions, patternPicks, stocks } from "./db/schema";

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

  const perPatternRows = (await db
    .select({
      patterns: patternPicks.patterns,
      n: sql<number>`COUNT(*)`,
      wr30d: sql<number>`ROUND(100.0 * SUM(CASE WHEN ${patternPicks.return30dPct} > 0 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN ${patternPicks.return30dPct} IS NOT NULL THEN 1 ELSE 0 END), 0), 2)`,
      avg30d: sql<number>`ROUND(AVG(${patternPicks.return30dPct}), 3)`,
    })
    .from(patternPicks)
    .groupBy(patternPicks.patterns)) as Array<{
    patterns: string;
    n: number;
    wr30d: number | null;
    avg30d: number | null;
  }>;
  const perPatternMap = new Map(perPatternRows.map((r) => [r.patterns, r]));

  const todayRaw = latestDate
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
    : [];

  const scoreOf = (
    avg: number | null,
    wr: number | null,
    n: number,
  ): number | null => {
    if (avg == null || wr == null) return null;
    const reliability = Math.min(1, n / 100);
    const winBonus = Math.max(0.5, Math.min(1.5, wr / 50));
    return avg * reliability * winBonus;
  };

  const today = todayRaw
    .map((r) => {
      const s = perPatternMap.get(r.patterns);
      const patternN = s?.n ?? 0;
      const patternWr30d = s?.wr30d ?? null;
      const patternAvg30d = s?.avg30d ?? null;
      return {
        ...r,
        patternN,
        patternWr30d,
        patternAvg30d,
        patternScore: scoreOf(patternAvg30d, patternWr30d, patternN),
      };
    })
    .sort((a, b) => {
      const av = a.patternScore;
      const bv = b.patternScore;
      if (av == null && bv == null) return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });

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

app.get("/api/fx-signals", async (c) => {
  const db = drizzle(c.env.DB);
  const pair = c.req.query("pair") ?? "USDJPY";
  const startCapital = Math.max(1, Number(c.req.query("startCapital") ?? "500000"));
  const lotSize = Math.max(1, Number(c.req.query("lotSize") ?? "10000"));
  const pipYen = lotSize / 100;

  const rows = (await db
    .select({
      date: fxPredictions.date,
      direction: fxPredictions.direction,
      entryPrice: fxPredictions.entryPrice,
      probability: fxPredictions.probability,
      confidence: fxPredictions.confidence,
      longWins: fxPredictions.longWins,
      shortWins: fxPredictions.shortWins,
      k: fxPredictions.k,
      actualLabelPips: fxPredictions.actualLabelPips,
      actualTpHitMin: fxPredictions.actualTpHitMin,
      actualSlHitMin: fxPredictions.actualSlHitMin,
      pnlPips: fxPredictions.pnlPips,
      hit: fxPredictions.hit,
      updatedAt: fxPredictions.updatedAt,
    })
    .from(fxPredictions)
    .where(eq(fxPredictions.pair, pair))
    .orderBy(asc(fxPredictions.date))) as Array<{
    date: string;
    direction: string;
    entryPrice: number;
    probability: number;
    confidence: number;
    longWins: number;
    shortWins: number;
    k: number;
    actualLabelPips: number | null;
    actualTpHitMin: number | null;
    actualSlHitMin: number | null;
    pnlPips: number | null;
    hit: number | null;
    updatedAt: number;
  }>;

  let equity = startCapital;
  const trades = rows.map((r) => {
    const resolved = r.pnlPips != null;
    const pnlYen = resolved ? (r.pnlPips as number) * pipYen : null;
    if (resolved) equity += pnlYen as number;
    return {
      ...r,
      pnlYen,
      equityAfter: resolved ? equity : null,
    };
  });

  const resolved = trades.filter((t) => t.hit != null);
  const wins = resolved.filter((t) => t.hit === 1).length;
  const losses = resolved.filter((t) => t.hit === 0).length;
  const totalPips = resolved.reduce((s, t) => s + (t.pnlPips ?? 0), 0);
  const totalYen = resolved.reduce((s, t) => s + (t.pnlYen ?? 0), 0);
  const finalEquity = startCapital + totalYen;
  const returnPct = ((finalEquity - startCapital) / startCapital) * 100;

  const equitySeries = trades
    .filter((t) => t.equityAfter != null)
    .map((t) => ({ date: t.date, equity: t.equityAfter as number }));
  let peak = startCapital;
  let maxDrawdown = 0;
  for (const { equity: e } of equitySeries) {
    if (e > peak) peak = e;
    const dd = ((peak - e) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return c.json({
    pair,
    startCapital,
    lotSize,
    pipYen,
    summary: {
      n: trades.length,
      resolved: resolved.length,
      pending: trades.length - resolved.length,
      wins,
      losses,
      winRate: resolved.length > 0 ? (wins / resolved.length) * 100 : null,
      totalPips: Number(totalPips.toFixed(2)),
      totalYen: Math.round(totalYen),
      finalEquity: Math.round(finalEquity),
      returnPct: Number(returnPct.toFixed(2)),
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
    },
    trades,
  });
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
