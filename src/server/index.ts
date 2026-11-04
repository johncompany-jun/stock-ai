import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { candles, contacts, fxPredictions, patternPicks, stockTrades, stocks, virtualPortfolioTrades, waitlist, watchlist } from "./db/schema";
import {
  clearCookie,
  isAuthenticated,
  requireOwner,
  sessionCookie,
  signSession,
  timingSafeEqualStr,
} from "./auth";
import {
  renderAbout,
  renderContactForm,
  renderContactThanks,
  renderContactsAdmin,
  renderDisclaimer,
  renderHome,
  renderPrivacy,
  renderWaitlistAdmin,
  renderWaitlistError,
  renderWaitlistThanks,
  type ContactsAdminRow,
  type HomeSnapshot,
  type WaitlistAdminRow,
} from "./pages";
import {
  categoryPageCount,
  listCategorySlugs,
  listPostMeta,
  renderBlogIndex,
  renderBlogPost,
  renderCategoryPage,
} from "./blog";
import { renderFxIndex, renderFxLog, renderFxNotFound, type FxLogRow } from "./fx";
import {
  renderStocksIndex,
  type StocksAgg,
  type StocksHistoryRow,
  type StocksIndexData,
  type StocksMonthlyRow,
  type StocksPick,
} from "./stocks";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  GITHUB_TOKEN?: string;
  OWNER_PASSWORD?: string;
  SESSION_SECRET?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.post("/api/auth/login", async (c) => {
  if (!c.env.OWNER_PASSWORD || !c.env.SESSION_SECRET) {
    return c.json({ error: "auth not configured" }, 503);
  }
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  const supplied = body.password ?? "";
  const ok = timingSafeEqualStr(supplied, c.env.OWNER_PASSWORD);
  if (!ok) return c.json({ error: "invalid password" }, 401);
  const token = await signSession(c.env.SESSION_SECRET);
  c.header("Set-Cookie", sessionCookie(token));
  return c.json({ authenticated: true });
});

app.post("/api/auth/logout", (c) => {
  c.header("Set-Cookie", clearCookie());
  return c.json({ authenticated: false });
});

app.get("/api/auth/me", async (c) => {
  const ok = await isAuthenticated(c.req.header("cookie"), c.env);
  return c.json({ authenticated: ok });
});

const htmlResponse = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

const loadHomeSnapshot = async (db: ReturnType<typeof drizzle>): Promise<HomeSnapshot> => {
  const strategy = "range_oscillator_buy";
  const [latestStockRow] = (await db
    .select({ d: sql<number>`MAX(${patternPicks.runDate})` })
    .from(patternPicks)
    .where(eq(patternPicks.patterns, strategy))) as Array<{ d: number | null }>;
  const latestStockDate = latestStockRow?.d ?? null;

  let todayCount = 0;
  if (latestStockDate) {
    const [cnt] = (await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(patternPicks)
      .where(
        and(
          eq(patternPicks.patterns, strategy),
          eq(patternPicks.runDate, latestStockDate),
        ),
      )) as Array<{ n: number }>;
    todayCount = cnt?.n ?? 0;
  }

  const [agg] = (await db
    .select({
      n: sql<number>`SUM(CASE WHEN ${patternPicks.return30dPct} IS NOT NULL THEN 1 ELSE 0 END)`,
      wr30d: sql<number>`ROUND(100.0 * SUM(CASE WHEN ${patternPicks.return30dPct} > 0 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN ${patternPicks.return30dPct} IS NOT NULL THEN 1 ELSE 0 END), 0), 2)`,
      avg30d: sql<number>`ROUND(AVG(${patternPicks.return30dPct}), 3)`,
    })
    .from(patternPicks)
    .where(eq(patternPicks.patterns, strategy))) as Array<{
    n: number | null;
    wr30d: number | null;
    avg30d: number | null;
  }>;

  const [latestFx] = (await db
    .select({
      date: fxPredictions.date,
      direction: fxPredictions.direction,
      probability: fxPredictions.probability,
      confidence: fxPredictions.confidence,
      pnlPips: fxPredictions.pnlPips,
    })
    .from(fxPredictions)
    .where(eq(fxPredictions.pair, "USDJPY"))
    .orderBy(desc(fxPredictions.date))
    .limit(1)) as Array<{
    date: string;
    direction: string;
    probability: number;
    confidence: number;
    pnlPips: number | null;
  }>;

  return {
    stocks: {
      latestDate: latestStockDate,
      todayCount,
      wr30d: agg?.wr30d ?? null,
      avg30d: agg?.avg30d ?? null,
      sampleN: agg?.n ?? 0,
    },
    fx: {
      latestDate: latestFx?.date ?? null,
      direction: latestFx?.direction ?? null,
      probability: latestFx?.probability ?? null,
      confidence: latestFx?.confidence ?? null,
      pnlPips: latestFx?.pnlPips ?? null,
    },
  };
};

app.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const snapshot = await loadHomeSnapshot(db);
  return htmlResponse(renderHome(snapshot));
});

const DEV_SPA_SHELL = `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>stock-ai (app)</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/client/main.ts"></script>
  </body>
</html>`;

app.get("/app", (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(new URL("/index.html", c.req.url).toString());
  }
  return htmlResponse(DEV_SPA_SHELL);
});

app.get("/about", () => htmlResponse(renderAbout()));
app.get("/disclaimer", () => htmlResponse(renderDisclaimer()));
app.get("/privacy", () => htmlResponse(renderPrivacy()));

app.get("/stocks", (c) => c.redirect("/stocks/", 301));
app.get("/stocks/", async (c) => {
  const db = drizzle(c.env.DB);
  const strategy = "range_oscillator_buy";

  const [latestRow] = (await db
    .select({ d: sql<number>`MAX(${patternPicks.runDate})` })
    .from(patternPicks)
    .where(eq(patternPicks.patterns, strategy))) as Array<{ d: number | null }>;
  const latestDate = latestRow?.d ?? null;

  const today = latestDate
    ? ((await db
        .select({
          code: patternPicks.code,
          name: stocks.name,
          patterns: patternPicks.patterns,
          entryClose: patternPicks.entryClose,
        })
        .from(patternPicks)
        .leftJoin(stocks, eq(stocks.code, patternPicks.code))
        .where(
          and(eq(patternPicks.patterns, strategy), eq(patternPicks.runDate, latestDate)),
        )) as Array<{
        code: string;
        name: string | null;
        patterns: string;
        entryClose: number;
      }>)
    : [];

  const [perPatternAgg] = (await db
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

  const todayEnriched: StocksPick[] = today.map((r) => ({
    code: r.code,
    name: r.name,
    patterns: r.patterns,
    entryClose: r.entryClose,
    patternN: perPatternAgg?.n ?? 0,
    patternWr30d: perPatternAgg?.wr30d ?? null,
    patternAvg30d: perPatternAgg?.avg30d ?? null,
  }));

  const [agg] = (await db
    .select({
      n: sql<number>`COUNT(*)`,
      n30d: sql<number>`SUM(CASE WHEN ${patternPicks.return30dPct} IS NOT NULL THEN 1 ELSE 0 END)`,
      wr30d: sql<number>`ROUND(100.0 * SUM(CASE WHEN ${patternPicks.return30dPct} > 0 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN ${patternPicks.return30dPct} IS NOT NULL THEN 1 ELSE 0 END), 0), 2)`,
      avg30d: sql<number>`ROUND(AVG(${patternPicks.return30dPct}), 3)`,
      firstDate: sql<number>`MIN(${patternPicks.runDate})`,
      lastDate: sql<number>`MAX(${patternPicks.runDate})`,
    })
    .from(patternPicks)
    .where(eq(patternPicks.patterns, strategy))) as Array<StocksAgg>;

  const history = (await db
    .select({
      runDate: patternPicks.runDate,
      code: patternPicks.code,
      name: stocks.name,
      entryClose: patternPicks.entryClose,
      return30dPct: patternPicks.return30dPct,
    })
    .from(patternPicks)
    .leftJoin(stocks, eq(stocks.code, patternPicks.code))
    .where(eq(patternPicks.patterns, strategy))
    .orderBy(desc(patternPicks.runDate))
    .limit(50)) as StocksHistoryRow[];

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
    .all()).results) as StocksMonthlyRow[];

  const currentMonth = new Date(Date.now() + 9 * 3600 * 1000).getUTCMonth() + 1;
  const currentMonthStat = monthlyRows.find((r) => r.buy_month === currentMonth) ?? null;

  const data: StocksIndexData = {
    latestDate,
    today: todayEnriched,
    agg: agg ?? null,
    history,
    monthly: monthlyRows,
    currentMonth,
    currentMonthStat,
  };

  return htmlResponse(renderStocksIndex(data));
});

app.get("/fx", (c) => c.redirect("/fx/", 301));
app.get("/fx/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = (await db
    .select({
      date: fxPredictions.date,
      direction: fxPredictions.direction,
      entryPrice: fxPredictions.entryPrice,
      probability: fxPredictions.probability,
      confidence: fxPredictions.confidence,
      longWins: fxPredictions.longWins,
      shortWins: fxPredictions.shortWins,
      avgLong: fxPredictions.avgLong,
      avgShort: fxPredictions.avgShort,
      k: fxPredictions.k,
      actualLabelPips: fxPredictions.actualLabelPips,
      actualTpHitMin: fxPredictions.actualTpHitMin,
      actualSlHitMin: fxPredictions.actualSlHitMin,
      pnlPips: fxPredictions.pnlPips,
      hit: fxPredictions.hit,
    })
    .from(fxPredictions)
    .where(eq(fxPredictions.pair, "USDJPY"))
    .orderBy(desc(fxPredictions.date))) as FxLogRow[];

  const resolved = rows.filter((r) => r.hit != null);
  const totalPips = resolved.reduce((s, r) => s + (r.pnlPips ?? 0), 0);
  const winCount = resolved.filter((r) => r.hit === 1).length;
  const recent30 = resolved.slice(0, 30);
  const recent30Pips = recent30.reduce((s, r) => s + (r.pnlPips ?? 0), 0);
  const recent30Wins = recent30.filter((r) => r.hit === 1).length;

  return htmlResponse(
    renderFxIndex({
      rows,
      totalPips,
      resolvedCount: resolved.length,
      winCount,
      recent30Pips,
      recent30Count: recent30.length,
      recent30Wins,
    }),
  );
});

app.get("/fx/log/:date", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return htmlResponse(renderFxNotFound(date), 400);
  }
  const db = drizzle(c.env.DB);
  const [row] = (await db
    .select({
      date: fxPredictions.date,
      direction: fxPredictions.direction,
      entryPrice: fxPredictions.entryPrice,
      probability: fxPredictions.probability,
      confidence: fxPredictions.confidence,
      longWins: fxPredictions.longWins,
      shortWins: fxPredictions.shortWins,
      avgLong: fxPredictions.avgLong,
      avgShort: fxPredictions.avgShort,
      k: fxPredictions.k,
      actualLabelPips: fxPredictions.actualLabelPips,
      actualTpHitMin: fxPredictions.actualTpHitMin,
      actualSlHitMin: fxPredictions.actualSlHitMin,
      pnlPips: fxPredictions.pnlPips,
      hit: fxPredictions.hit,
    })
    .from(fxPredictions)
    .where(and(eq(fxPredictions.pair, "USDJPY"), eq(fxPredictions.date, date)))
    .limit(1)) as FxLogRow[];

  if (!row) return htmlResponse(renderFxNotFound(date), 404);

  const [prevRow] = (await db
    .select({
      date: fxPredictions.date,
      direction: fxPredictions.direction,
      entryPrice: fxPredictions.entryPrice,
      probability: fxPredictions.probability,
      confidence: fxPredictions.confidence,
      longWins: fxPredictions.longWins,
      shortWins: fxPredictions.shortWins,
      avgLong: fxPredictions.avgLong,
      avgShort: fxPredictions.avgShort,
      k: fxPredictions.k,
      actualLabelPips: fxPredictions.actualLabelPips,
      actualTpHitMin: fxPredictions.actualTpHitMin,
      actualSlHitMin: fxPredictions.actualSlHitMin,
      pnlPips: fxPredictions.pnlPips,
      hit: fxPredictions.hit,
    })
    .from(fxPredictions)
    .where(
      and(
        eq(fxPredictions.pair, "USDJPY"),
        sql`${fxPredictions.date} < ${date}`,
      ),
    )
    .orderBy(desc(fxPredictions.date))
    .limit(1)) as FxLogRow[];

  return htmlResponse(renderFxLog(row, prevRow ?? null));
});

app.get("/blog", (c) => c.redirect("/blog/", 301));
app.get("/blog/", () => htmlResponse(renderBlogIndex()));
app.get("/blog/category/:slug", (c) => {
  const html = renderCategoryPage(c.req.param("slug"), 1);
  if (!html) return htmlResponse("<h1>404</h1><p>カテゴリが見つかりません。</p>", 404);
  return htmlResponse(html);
});
app.get("/blog/category/:slug/page/:page", (c) => {
  const page = Number(c.req.param("page"));
  if (!Number.isInteger(page) || page < 1) {
    return htmlResponse("<h1>404</h1><p>ページが見つかりません。</p>", 404);
  }
  const html = renderCategoryPage(c.req.param("slug"), page);
  if (!html) return htmlResponse("<h1>404</h1><p>ページが見つかりません。</p>", 404);
  return htmlResponse(html);
});
app.get("/blog/:slug", (c) => {
  const html = renderBlogPost(c.req.param("slug"));
  if (!html) return htmlResponse("<h1>404</h1><p>記事が見つかりません。</p>", 404);
  return htmlResponse(html);
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_CATEGORIES = new Set(["fx", "stocks", "both"]);
const VALID_CONTACT_CATEGORIES = new Set(["general", "unsubscribe", "bug", "other"]);

app.get("/contact", () => htmlResponse(renderContactForm()));

app.post("/api/contact", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  let email = "";
  let category = "general";
  let message = "";
  let honeypot = "";
  if (contentType.includes("application/json")) {
    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      category?: string;
      message?: string;
      website?: string;
    };
    email = (body.email ?? "").trim();
    category = (body.category ?? "general").trim();
    message = (body.message ?? "").trim();
    honeypot = (body.website ?? "").trim();
  } else {
    const body = await c.req.parseBody();
    email = String(body.email ?? "").trim();
    category = String(body.category ?? "general").trim();
    message = String(body.message ?? "").trim();
    honeypot = String(body.website ?? "").trim();
  }

  if (honeypot) {
    return c.redirect("/contact/thanks", 303);
  }
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return htmlResponse(renderContactForm("メールアドレスの形式が正しくありません。"), 400);
  }
  if (!message || message.length > 4000) {
    return htmlResponse(renderContactForm("内容が空、または長すぎます (最大 4000 文字)。"), 400);
  }
  if (!VALID_CONTACT_CATEGORIES.has(category)) category = "general";

  const now = Math.floor(Date.now() / 1000);
  const ip = c.req.header("cf-connecting-ip") ?? null;
  const ua = c.req.header("user-agent") ?? null;

  const db = drizzle(c.env.DB);
  await db.insert(contacts).values({
    email: email.toLowerCase(),
    category,
    message,
    addedAt: now,
    repliedAt: null,
    ip,
    userAgent: ua,
  });

  return c.redirect("/contact/thanks", 303);
});

app.get("/contact/thanks", () => htmlResponse(renderContactThanks()));

app.get("/admin/contacts", async (c) => {
  const ok = await isAuthenticated(c.req.header("cookie"), c.env);
  if (!ok) return c.redirect("/app", 302);
  const db = drizzle(c.env.DB);
  const rows = (await db
    .select({
      id: contacts.id,
      email: contacts.email,
      category: contacts.category,
      message: contacts.message,
      addedAt: contacts.addedAt,
      repliedAt: contacts.repliedAt,
    })
    .from(contacts)
    .orderBy(desc(contacts.addedAt))
    .limit(200)) as ContactsAdminRow[];

  const [agg] = (await db
    .select({
      total: sql<number>`COUNT(*)`,
      unreplied: sql<number>`SUM(CASE WHEN replied_at IS NULL THEN 1 ELSE 0 END)`,
    })
    .from(contacts)) as Array<{ total: number; unreplied: number }>;

  return htmlResponse(
    renderContactsAdmin({ total: agg?.total ?? 0, unreplied: agg?.unreplied ?? 0 }, rows),
  );
});

app.post("/api/waitlist", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  let email = "";
  let category = "both";
  if (contentType.includes("application/json")) {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; category?: string };
    email = (body.email ?? "").trim().toLowerCase();
    category = (body.category ?? "both").trim();
  } else {
    const body = await c.req.parseBody();
    email = String(body.email ?? "").trim().toLowerCase();
    category = String(body.category ?? "both").trim();
  }

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return htmlResponse(renderWaitlistError("メールアドレスの形式が正しくありません。"), 400);
  }
  if (!VALID_CATEGORIES.has(category)) category = "both";

  const now = Math.floor(Date.now() / 1000);
  const ip = c.req.header("cf-connecting-ip") ?? null;
  const ua = c.req.header("user-agent") ?? null;

  const db = drizzle(c.env.DB);
  const existing = (await db
    .select({ id: waitlist.id })
    .from(waitlist)
    .where(eq(waitlist.email, email))
    .limit(1)) as Array<{ id: number }>;

  if (existing.length > 0) {
    return c.redirect("/waitlist/thanks?status=already", 303);
  }

  await db.insert(waitlist).values({
    email,
    category,
    addedAt: now,
    confirmedAt: null,
    unsubscribedAt: null,
    ip,
    userAgent: ua,
  });

  return c.redirect("/waitlist/thanks?status=added", 303);
});

app.get("/waitlist/thanks", (c) => {
  const status = c.req.query("status") === "already" ? "already" : "added";
  return htmlResponse(renderWaitlistThanks(status));
});

app.post("/admin/waitlist/:id/delete", async (c) => {
  const ok = await isAuthenticated(c.req.header("cookie"), c.env);
  if (!ok) return c.redirect("/app", 302);
  const id = Number(c.req.param("id"));
  if (!id) return c.redirect("/admin/waitlist", 303);
  const db = drizzle(c.env.DB);
  await db.delete(waitlist).where(eq(waitlist.id, id));
  return c.redirect("/admin/waitlist", 303);
});

app.post("/admin/contacts/:id/delete", async (c) => {
  const ok = await isAuthenticated(c.req.header("cookie"), c.env);
  if (!ok) return c.redirect("/app", 302);
  const id = Number(c.req.param("id"));
  if (!id) return c.redirect("/admin/contacts", 303);
  const db = drizzle(c.env.DB);
  await db.delete(contacts).where(eq(contacts.id, id));
  return c.redirect("/admin/contacts", 303);
});

app.get("/admin/waitlist", async (c) => {
  const ok = await isAuthenticated(c.req.header("cookie"), c.env);
  if (!ok) return c.redirect("/app", 302);
  const db = drizzle(c.env.DB);
  const rows = (await db
    .select({
      id: waitlist.id,
      email: waitlist.email,
      category: waitlist.category,
      addedAt: waitlist.addedAt,
      confirmedAt: waitlist.confirmedAt,
      unsubscribedAt: waitlist.unsubscribedAt,
    })
    .from(waitlist)
    .orderBy(desc(waitlist.addedAt))
    .limit(100)) as WaitlistAdminRow[];

  const [agg] = (await db
    .select({
      total: sql<number>`COUNT(*)`,
      fx: sql<number>`SUM(CASE WHEN category = 'fx' THEN 1 ELSE 0 END)`,
      stocks: sql<number>`SUM(CASE WHEN category = 'stocks' THEN 1 ELSE 0 END)`,
      both: sql<number>`SUM(CASE WHEN category = 'both' THEN 1 ELSE 0 END)`,
      confirmed: sql<number>`SUM(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END)`,
      unsubscribed: sql<number>`SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END)`,
    })
    .from(waitlist)) as Array<{
    total: number;
    fx: number;
    stocks: number;
    both: number;
    confirmed: number;
    unsubscribed: number;
  }>;

  return htmlResponse(
    renderWaitlistAdmin(
      {
        total: agg?.total ?? 0,
        fx: agg?.fx ?? 0,
        stocks: agg?.stocks ?? 0,
        both: agg?.both ?? 0,
        confirmed: agg?.confirmed ?? 0,
        unsubscribed: agg?.unsubscribed ?? 0,
      },
      rows,
    ),
  );
});

app.get("/robots.txt", () => {
  const body = `User-agent: *\nAllow: /\nSitemap: https://stock-ai.uk/sitemap.xml\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
});

app.get("/sitemap.xml", async (c) => {
  const db = drizzle(c.env.DB);
  const urls: Array<{ loc: string; lastmod?: string }> = [
    { loc: "https://stock-ai.uk/" },
    { loc: "https://stock-ai.uk/about" },
    { loc: "https://stock-ai.uk/disclaimer" },
    { loc: "https://stock-ai.uk/privacy" },
    { loc: "https://stock-ai.uk/blog/" },
    { loc: "https://stock-ai.uk/fx/" },
    { loc: "https://stock-ai.uk/stocks/" },
    { loc: "https://stock-ai.uk/contact" },
  ];
  for (const catSlug of listCategorySlugs()) {
    urls.push({ loc: `https://stock-ai.uk/blog/category/${catSlug}` });
    const pages = categoryPageCount(catSlug);
    for (let p = 2; p <= pages; p++) {
      urls.push({ loc: `https://stock-ai.uk/blog/category/${catSlug}/page/${p}` });
    }
  }
  for (const p of listPostMeta()) {
    urls.push({ loc: `https://stock-ai.uk/blog/${p.slug}`, lastmod: p.date });
  }
  const fxDates = (await db
    .select({ date: fxPredictions.date })
    .from(fxPredictions)
    .where(eq(fxPredictions.pair, "USDJPY"))
    .orderBy(desc(fxPredictions.date))
    .limit(500)) as Array<{ date: string }>;
  for (const r of fxDates) {
    urls.push({ loc: `https://stock-ai.uk/fx/log/${r.date}`, lastmod: r.date });
  }
  const items = urls
    .map(
      (u) =>
        `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`,
    )
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
});

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

app.post("/api/portfolio/buy", requireOwner(), async (c) => {
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

app.post("/api/watchlist", requireOwner(), async (c) => {
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

app.delete("/api/watchlist/:id", requireOwner(), async (c) => {
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

app.post("/api/portfolio/sell", requireOwner(), async (c) => {
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

app.all("*", (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.notFound();
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
