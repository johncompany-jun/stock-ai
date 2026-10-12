import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { candles, fxPredictions, patternPicks, stockTrades, stocks, virtualPortfolioTrades, watchlist } from "./db/schema";

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
  const strategy = c.req.query("strategy") ?? "range_oscillator_buy";

  const latestDateRow = await db
    .select({ d: sql<number>`MAX(${patternPicks.runDate})` })
    .from(patternPicks)
    .where(eq(patternPicks.patterns, strategy));
  const latestDate = latestDateRow[0]?.d ?? null;

  const perPatternRows = (await db
    .select({
      patterns: patternPicks.patterns,
      n: sql<number>`COUNT(*)`,
      wr30d: sql<number>`ROUND(100.0 * SUM(CASE WHEN ${patternPicks.return30dPct} > 0 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN ${patternPicks.return30dPct} IS NOT NULL THEN 1 ELSE 0 END), 0), 2)`,
      avg30d: sql<number>`ROUND(AVG(${patternPicks.return30dPct}), 3)`,
    })
    .from(patternPicks)
    .where(eq(patternPicks.patterns, strategy))
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
        .where(and(eq(patternPicks.runDate, latestDate), eq(patternPicks.patterns, strategy)))
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
    .from(patternPicks)
    .where(eq(patternPicks.patterns, strategy));

  const history = (await db
    .select({
      runDate: patternPicks.runDate,
      n: sql<number>`COUNT(*)`,
      avg5d: sql<number>`AVG(${patternPicks.return5dPct})`,
      avg15d: sql<number>`AVG(${patternPicks.return15dPct})`,
      avg30d: sql<number>`AVG(${patternPicks.return30dPct})`,
    })
    .from(patternPicks)
    .where(eq(patternPicks.patterns, strategy))
    .groupBy(patternPicks.runDate)
    .orderBy(asc(patternPicks.runDate))
    .limit(limit)) as Array<{
    runDate: number;
    n: number;
    avg5d: number | null;
    avg15d: number | null;
    avg30d: number | null;
  }>;

  const monthlyRows = ((await c.env.DB.prepare(
    `WITH pp AS (
       SELECT code, run_date, entry_close,
              CAST(SUBSTR(CAST(run_date AS TEXT), 5, 2) AS INTEGER) AS buy_month
       FROM pattern_picks WHERE patterns = ?
     ),
     with_90 AS (
       SELECT pp.buy_month, pp.entry_close,
         (SELECT c.close FROM candles c
          WHERE c.code = pp.code AND c.date > pp.run_date AND c.close > 0
          ORDER BY c.date LIMIT 1 OFFSET 89) AS close_90d
       FROM pp
     )
     SELECT buy_month,
            COUNT(close_90d) AS n,
            ROUND(100.0 * SUM(CASE WHEN close_90d > entry_close THEN 1 ELSE 0 END) / COUNT(close_90d), 1) AS wr_90d,
            ROUND(AVG((close_90d - entry_close) / entry_close * 100), 2) AS avg_90d
     FROM with_90 WHERE close_90d IS NOT NULL
     GROUP BY buy_month ORDER BY buy_month`,
  )
    .bind(strategy)
    .all()).results) as Array<{
    buy_month: number;
    n: number;
    wr_90d: number;
    avg_90d: number;
  }>;

  const currentMonth = new Date(Date.now() + 9 * 3600 * 1000).getUTCMonth() + 1;
  const currentMonthStat = monthlyRows.find((r) => r.buy_month === currentMonth) ?? null;

  return c.json({
    latestDate,
    today,
    agg,
    history,
    monthly: monthlyRows,
    currentMonth,
    currentMonthStat,
  });
});

app.get("/api/stock-trades", async (c) => {
  const db = drizzle(c.env.DB);
  const strategy = c.req.query("strategy") ?? "range_oscillator_v1";
  const startCapital = Math.max(1, Number(c.req.query("startCapital") ?? "500000"));

  const rows = (await db
    .select({
      id: stockTrades.id,
      code: stockTrades.code,
      signalDate: stockTrades.signalDate,
      buyDate: stockTrades.buyDate,
      buyPrice: stockTrades.buyPrice,
      shares: stockTrades.shares,
      investmentYen: stockTrades.investmentYen,
      sellDate: stockTrades.sellDate,
      sellPrice: stockTrades.sellPrice,
      pnlYen: stockTrades.pnlYen,
      pnlPct: stockTrades.pnlPct,
      exitReason: stockTrades.exitReason,
      equityAfter: stockTrades.equityAfter,
      name: stocks.name,
    })
    .from(stockTrades)
    .leftJoin(stocks, eq(stocks.code, stockTrades.code))
    .where(eq(stockTrades.strategy, strategy))
    .orderBy(asc(stockTrades.sellDate), asc(stockTrades.buyDate))) as Array<{
    id: number;
    code: string;
    signalDate: number;
    buyDate: number;
    buyPrice: number;
    shares: number;
    investmentYen: number;
    sellDate: number | null;
    sellPrice: number | null;
    pnlYen: number | null;
    pnlPct: number | null;
    exitReason: string | null;
    equityAfter: number | null;
    name: string | null;
  }>;

  const resolved = rows.filter((r) => r.pnlYen != null);
  const wins = resolved.filter((r) => (r.pnlYen as number) > 0).length;
  const losses = resolved.length - wins;
  const totalPnl = resolved.reduce((s, r) => s + (r.pnlYen ?? 0), 0);
  const finalEquity = startCapital + totalPnl;
  const returnPct = ((finalEquity - startCapital) / startCapital) * 100;
  const firstDate = rows.length > 0 ? rows[0].buyDate : null;
  const lastDate = rows.length > 0 ? (rows[rows.length - 1].sellDate ?? rows[rows.length - 1].buyDate) : null;
  const years =
    firstDate && lastDate ? Math.max(0.01, (lastDate - firstDate) / 10000) : null;
  const annualizedPct = years ? returnPct / years : null;

  let peak = startCapital;
  let maxDrawdown = 0;
  for (const r of rows) {
    const e = r.equityAfter;
    if (e == null) continue;
    if (e > peak) peak = e;
    const dd = ((peak - e) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const bestTrade =
    resolved.length > 0
      ? [...resolved].sort((a, b) => (b.pnlYen as number) - (a.pnlYen as number))[0]
      : null;
  const worstTrade =
    resolved.length > 0
      ? [...resolved].sort((a, b) => (a.pnlYen as number) - (b.pnlYen as number))[0]
      : null;

  return c.json({
    strategy,
    startCapital,
    summary: {
      n: rows.length,
      resolved: resolved.length,
      pending: rows.length - resolved.length,
      wins,
      losses,
      winRate: resolved.length > 0 ? (wins / resolved.length) * 100 : null,
      totalPnl: Math.round(totalPnl),
      finalEquity: Math.round(finalEquity),
      returnPct: Number(returnPct.toFixed(2)),
      annualizedPct: annualizedPct != null ? Number(annualizedPct.toFixed(2)) : null,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      firstDate,
      lastDate,
      bestTrade,
      worstTrade,
    },
    trades: rows,
  });
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

const PORTFOLIO_START_CAPITAL = 500000;

const getLatestClose = async (
  db: ReturnType<typeof drizzle>,
  code: string,
): Promise<{ date: number; close: number } | null> => {
  const [row] = await db
    .select({ date: candles.date, close: candles.close })
    .from(candles)
    .where(and(eq(candles.code, code), sql`${candles.close} > 0`))
    .orderBy(desc(candles.date))
    .limit(1);
  return row ?? null;
};

app.get("/api/portfolio", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = (await db
    .select({
      id: virtualPortfolioTrades.id,
      code: virtualPortfolioTrades.code,
      signalDate: virtualPortfolioTrades.signalDate,
      buyDate: virtualPortfolioTrades.buyDate,
      buyPrice: virtualPortfolioTrades.buyPrice,
      shares: virtualPortfolioTrades.shares,
      investmentYen: virtualPortfolioTrades.investmentYen,
      sellDate: virtualPortfolioTrades.sellDate,
      sellPrice: virtualPortfolioTrades.sellPrice,
      pnlYen: virtualPortfolioTrades.pnlYen,
      pnlPct: virtualPortfolioTrades.pnlPct,
      createdAt: virtualPortfolioTrades.createdAt,
      name: stocks.name,
    })
    .from(virtualPortfolioTrades)
    .leftJoin(stocks, eq(stocks.code, virtualPortfolioTrades.code))
    .orderBy(desc(virtualPortfolioTrades.createdAt))) as Array<{
    id: number;
    code: string;
    signalDate: number;
    buyDate: number;
    buyPrice: number;
    shares: number;
    investmentYen: number;
    sellDate: number | null;
    sellPrice: number | null;
    pnlYen: number | null;
    pnlPct: number | null;
    createdAt: number;
    name: string | null;
  }>;

  const open = rows.filter((r) => r.sellDate == null);
  const closed = rows.filter((r) => r.sellDate != null);

  const latestClosesByCode = new Map<string, { date: number; close: number }>();
  for (const code of new Set(open.map((o) => o.code))) {
    const latest = await getLatestClose(db, code);
    if (latest) latestClosesByCode.set(code, latest);
  }

  const openEnriched = open.map((o) => {
    const latest = latestClosesByCode.get(o.code);
    const currentPrice = latest?.close ?? o.buyPrice;
    const currentValue = currentPrice * o.shares;
    const unrealizedYen = currentValue - o.investmentYen;
    const unrealizedPct = ((currentPrice - o.buyPrice) / o.buyPrice) * 100;
    return {
      ...o,
      currentPrice,
      currentDate: latest?.date ?? null,
      currentValue,
      unrealizedYen,
      unrealizedPct,
    };
  });

  const cashSpent = rows.reduce((s, r) => s + r.investmentYen, 0);
  const cashRecovered = closed.reduce((s, r) => s + (r.sellPrice ?? 0) * r.shares, 0);
  const cash = PORTFOLIO_START_CAPITAL - cashSpent + cashRecovered;
  const holdingsValue = openEnriched.reduce((s, o) => s + o.currentValue, 0);
  const equity = cash + holdingsValue;
  const realizedPnl = closed.reduce((s, c) => s + (c.pnlYen ?? 0), 0);
  const unrealizedPnl = openEnriched.reduce((s, o) => s + o.unrealizedYen, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const returnPct = ((equity - PORTFOLIO_START_CAPITAL) / PORTFOLIO_START_CAPITAL) * 100;

  return c.json({
    startCapital: PORTFOLIO_START_CAPITAL,
    cash: Math.round(cash),
    holdingsValue: Math.round(holdingsValue),
    equity: Math.round(equity),
    realizedPnl: Math.round(realizedPnl),
    unrealizedPnl: Math.round(unrealizedPnl),
    totalPnl: Math.round(totalPnl),
    returnPct: Number(returnPct.toFixed(2)),
    open: openEnriched,
    closed,
  });
});

app.post("/api/portfolio/buy", async (c) => {
  const db = drizzle(c.env.DB);
  const body = (await c.req.json()) as {
    code: string;
    signalDate: number;
    buyPrice: number;
    shares: number;
  };
  if (!body.code || !body.signalDate || !body.buyPrice || !body.shares) {
    return c.json({ error: "code, signalDate, buyPrice, shares は必須" }, 400);
  }
  if (body.shares % 100 !== 0 || body.shares <= 0) {
    return c.json({ error: "shares は 100 の倍数で指定してください" }, 400);
  }
  const investment = body.buyPrice * body.shares;

  const allRows = (await db
    .select({
      investmentYen: virtualPortfolioTrades.investmentYen,
      sellPrice: virtualPortfolioTrades.sellPrice,
      shares: virtualPortfolioTrades.shares,
      sellDate: virtualPortfolioTrades.sellDate,
    })
    .from(virtualPortfolioTrades)) as Array<{
    investmentYen: number;
    sellPrice: number | null;
    shares: number;
    sellDate: number | null;
  }>;
  const cashSpent = allRows.reduce((s, r) => s + r.investmentYen, 0);
  const cashRecovered = allRows.reduce(
    (s, r) => s + (r.sellDate != null ? (r.sellPrice ?? 0) * r.shares : 0),
    0,
  );
  const cash = PORTFOLIO_START_CAPITAL - cashSpent + cashRecovered;
  if (cash < investment) {
    return c.json({ error: `資金不足: 残高 ${Math.round(cash)}円 / 必要 ${investment}円` }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const buyYmd =
    jstNow.getUTCFullYear() * 10000 +
    (jstNow.getUTCMonth() + 1) * 100 +
    jstNow.getUTCDate();

  await db.insert(virtualPortfolioTrades).values({
    code: body.code,
    signalDate: body.signalDate,
    buyDate: buyYmd,
    buyPrice: body.buyPrice,
    shares: body.shares,
    investmentYen: investment,
    sellDate: null,
    sellPrice: null,
    pnlYen: null,
    pnlPct: null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ success: true });
});

app.get("/api/watchlist", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = (await db
    .select({
      id: watchlist.id,
      code: watchlist.code,
      signalDate: watchlist.signalDate,
      entryPrice: watchlist.entryPrice,
      addedAt: watchlist.addedAt,
      note: watchlist.note,
      name: stocks.name,
    })
    .from(watchlist)
    .leftJoin(stocks, eq(stocks.code, watchlist.code))
    .where(isNull(watchlist.removedAt))
    .orderBy(desc(watchlist.addedAt))) as Array<{
    id: number;
    code: string;
    signalDate: number;
    entryPrice: number;
    addedAt: number;
    note: string | null;
    name: string | null;
  }>;

  const latestPickDateRow = await db
    .select({ d: sql<number>`MAX(${patternPicks.runDate})` })
    .from(patternPicks)
    .where(eq(patternPicks.patterns, "range_oscillator_buy"));
  const latestPickDate = latestPickDateRow[0]?.d ?? null;

  const todayPickCodes = new Set<string>();
  if (latestPickDate) {
    const todayPicks = (await db
      .select({ code: patternPicks.code })
      .from(patternPicks)
      .where(
        and(
          eq(patternPicks.patterns, "range_oscillator_buy"),
          eq(patternPicks.runDate, latestPickDate),
        ),
      )) as Array<{ code: string }>;
    for (const p of todayPicks) todayPickCodes.add(p.code);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const items: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const latest = await getLatestClose(db, r.code);
    const currentPrice = latest?.close ?? r.entryPrice;
    const changePct = ((currentPrice - r.entryPrice) / r.entryPrice) * 100;
    const daysWatching = Math.floor((nowSec - r.addedAt) / 86400);
    const inTodaysSignal = todayPickCodes.has(r.code);

    const lastSignalRow = (await db
      .select({ d: sql<number>`MAX(${patternPicks.runDate})` })
      .from(patternPicks)
      .where(
        and(
          eq(patternPicks.code, r.code),
          eq(patternPicks.patterns, "range_oscillator_buy"),
        ),
      )) as Array<{ d: number | null }>;
    const lastSignalDate = lastSignalRow[0]?.d ?? null;
    let daysSinceLastSignal: number | null = null;
    if (lastSignalDate && latestPickDate) {
      const toDate = (ymd: number) => {
        const y = Math.floor(ymd / 10000);
        const m = Math.floor((ymd % 10000) / 100) - 1;
        const d = ymd % 100;
        return new Date(Date.UTC(y, m, d));
      };
      const diffMs = toDate(latestPickDate).getTime() - toDate(lastSignalDate).getTime();
      daysSinceLastSignal = Math.max(0, Math.floor(diffMs / 86400000));
    }

    const dropped = !inTodaysSignal && (daysSinceLastSignal === null || daysSinceLastSignal >= 7);
    const priceRanAway = changePct >= 8;

    items.push({
      ...r,
      currentPrice,
      currentDate: latest?.date ?? null,
      changePct: Number(changePct.toFixed(2)),
      daysWatching,
      inTodaysSignal,
      lastSignalDate,
      daysSinceLastSignal,
      dropped,
      priceRanAway,
    });
  }

  return c.json({ items, latestPickDate });
});

app.post("/api/watchlist", async (c) => {
  const db = drizzle(c.env.DB);
  const body = (await c.req.json()) as {
    items?: Array<{ code: string; signalDate: number; entryPrice: number }>;
    code?: string;
    signalDate?: number;
    entryPrice?: number;
    note?: string;
  };
  const toInsert = body.items
    ? body.items
    : body.code && body.signalDate && body.entryPrice
      ? [{ code: body.code, signalDate: body.signalDate, entryPrice: body.entryPrice }]
      : [];
  if (!toInsert.length) return c.json({ error: "code/signalDate/entryPrice または items が必要" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const existing = (await db
    .select({ code: watchlist.code })
    .from(watchlist)
    .where(isNull(watchlist.removedAt))) as Array<{ code: string }>;
  const existingSet = new Set(existing.map((e) => e.code));
  const filtered = toInsert.filter((it) => !existingSet.has(it.code));

  if (!filtered.length) return c.json({ success: true, added: 0, message: "全て既にウォッチ中" });

  for (const it of filtered) {
    await db.insert(watchlist).values({
      code: it.code,
      signalDate: it.signalDate,
      entryPrice: it.entryPrice,
      addedAt: now,
      removedAt: null,
      note: body.note ?? null,
    });
  }
  return c.json({ success: true, added: filtered.length });
});

app.delete("/api/watchlist/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!id) return c.json({ error: "id は必須" }, 400);
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(watchlist)
    .set({ removedAt: now })
    .where(eq(watchlist.id, id));
  return c.json({ success: true });
});

app.post("/api/portfolio/sell", async (c) => {
  const db = drizzle(c.env.DB);
  const body = (await c.req.json()) as { id: number };
  if (!body.id) return c.json({ error: "id は必須" }, 400);

  const [row] = await db
    .select()
    .from(virtualPortfolioTrades)
    .where(eq(virtualPortfolioTrades.id, body.id))
    .limit(1);
  if (!row) return c.json({ error: "trade not found" }, 404);
  if (row.sellDate != null) return c.json({ error: "既に売却済み" }, 400);

  const latest = await getLatestClose(db, row.code);
  if (!latest) return c.json({ error: `${row.code} の最新価格が取得できません` }, 400);
  const sellPrice = latest.close;
  const sellValue = sellPrice * row.shares;
  const pnlYen = sellValue - row.investmentYen;
  const pnlPct = ((sellPrice - row.buyPrice) / row.buyPrice) * 100;

  const now = Math.floor(Date.now() / 1000);
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const sellYmd =
    jstNow.getUTCFullYear() * 10000 +
    (jstNow.getUTCMonth() + 1) * 100 +
    jstNow.getUTCDate();

  await db
    .update(virtualPortfolioTrades)
    .set({
      sellDate: sellYmd,
      sellPrice,
      pnlYen,
      pnlPct,
      updatedAt: now,
    })
    .where(eq(virtualPortfolioTrades.id, body.id));

  return c.json({ success: true, pnlYen: Math.round(pnlYen), pnlPct: Number(pnlPct.toFixed(2)) });
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
