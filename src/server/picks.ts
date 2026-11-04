import { renderLayout, htmlEscape } from "./html";

export type PicksRecord = {
  runDate: number;
  code: string;
  name: string | null;
  patterns: string;
  entryClose: number;
  return5dPct: number | null;
  return15dPct: number | null;
  return30dPct: number | null;
};

export type PicksAgg = {
  n: number;
  n30d: number;
  wr30d: number | null;
  avg30d: number | null;
  firstDate: number | null;
  lastDate: number | null;
};

export type PicksYearly = {
  year: number;
  n: number;
  wr30d: number | null;
  avg30d: number | null;
};

export type PicksIndexData = {
  agg: PicksAgg | null;
  yearly: PicksYearly[];
  records: PicksRecord[];
  page: number;
  totalPages: number;
  total: number;
};

export const PICKS_PER_PAGE = 50;

const formatYmd = (ymd: number): string => {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor((ymd % 10000) / 100);
  const d = ymd % 100;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const pctCls = (v: number | null): string =>
  v == null ? "" : v >= 0 ? "pos" : "neg";

const pctFmt = (v: number | null, digits = 2): string =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;

const patternLabel = (patterns: string): string =>
  patterns
    .split(",")
    .map((p) =>
      p === "pullback_to_ma"
        ? "MA押し目"
        : p === "oversold_reversal"
          ? "売られすぎ反発"
          : p === "gap_down_reversal"
            ? "GDR 反発"
            : p === "volume_surge_breakout"
              ? "出来高急増"
              : p === "range_oscillator_buy"
                ? "レンジ安値"
                : p,
    )
    .join(" + ");

export const renderPicksIndex = (data: PicksIndexData): string => {
  const { agg, yearly, records, page, totalPages, total } = data;

  const aggTile = agg
    ? `
    <div class="grid gap-3 sm:grid-cols-4">
      <div class="card">
        <div class="text-xs text-[color:var(--color-muted-soft)]">総件数</div>
        <div class="text-2xl font-mono font-semibold">${agg.n.toLocaleString("ja-JP")}</div>
        <div class="text-xs text-[color:var(--color-muted)]">${agg.firstDate ? formatYmd(agg.firstDate) : "—"} 〜 ${agg.lastDate ? formatYmd(agg.lastDate) : "—"}</div>
      </div>
      <div class="card">
        <div class="text-xs text-[color:var(--color-muted-soft)]">30 日後 判定済み</div>
        <div class="text-2xl font-mono font-semibold">${(agg.n30d ?? 0).toLocaleString("ja-JP")}</div>
        <div class="text-xs text-[color:var(--color-muted)]">件</div>
      </div>
      <div class="card">
        <div class="text-xs text-[color:var(--color-muted-soft)]">30 日後 勝率</div>
        <div class="text-2xl font-mono font-semibold ${pctCls((agg.wr30d ?? 50) - 50)}">${agg.wr30d != null ? `${agg.wr30d.toFixed(2)}%` : "—"}</div>
      </div>
      <div class="card">
        <div class="text-xs text-[color:var(--color-muted-soft)]">30 日後 平均リターン</div>
        <div class="text-2xl font-mono font-semibold ${pctCls(agg.avg30d)}">${pctFmt(agg.avg30d, 2)}</div>
      </div>
    </div>`
    : "<p>集計データなし</p>";

  const yearlyRows = yearly
    .map(
      (y) => `
      <tr>
        <td class="p-2 font-mono">${y.year}</td>
        <td class="p-2 font-mono text-xs">${y.n.toLocaleString("ja-JP")}</td>
        <td class="p-2 font-mono text-xs ${pctCls((y.wr30d ?? 50) - 50)}">${y.wr30d != null ? `${y.wr30d.toFixed(2)}%` : "—"}</td>
        <td class="p-2 font-mono text-xs ${pctCls(y.avg30d)}">${pctFmt(y.avg30d, 2)}</td>
      </tr>`,
    )
    .join("");

  const recordRows = records
    .map(
      (r) => `
      <tr>
        <td class="p-2 font-mono text-xs">${htmlEscape(formatYmd(r.runDate))}</td>
        <td class="p-2 font-mono text-xs">${htmlEscape(r.code)}</td>
        <td class="p-2 text-xs">${htmlEscape(r.name ?? "—")}</td>
        <td class="p-2 text-xs text-[color:var(--color-muted)]">${htmlEscape(patternLabel(r.patterns))}</td>
        <td class="p-2 font-mono text-xs">${r.entryClose.toLocaleString("ja-JP")}</td>
        <td class="p-2 font-mono text-xs ${pctCls(r.return5dPct)}">${pctFmt(r.return5dPct, 1)}</td>
        <td class="p-2 font-mono text-xs ${pctCls(r.return15dPct)}">${pctFmt(r.return15dPct, 1)}</td>
        <td class="p-2 font-mono text-xs ${pctCls(r.return30dPct)}">${pctFmt(r.return30dPct, 1)}</td>
      </tr>`,
    )
    .join("");

  const linkTo = (n: number): string => (n === 1 ? "/picks/" : `/picks/page/${n}`);
  const prev =
    page > 1
      ? `<a href="${linkTo(page - 1)}" class="btn btn-outline text-sm" rel="prev">← 前のページ</a>`
      : `<span class="btn btn-outline text-sm opacity-50 pointer-events-none">← 前のページ</span>`;
  const next =
    page < totalPages
      ? `<a href="${linkTo(page + 1)}" class="btn btn-outline text-sm" rel="next">次のページ →</a>`
      : `<span class="btn btn-outline text-sm opacity-50 pointer-events-none">次のページ →</span>`;
  const nav =
    totalPages > 1
      ? `<nav class="flex items-center justify-between mt-4">${prev}<span class="text-sm text-[color:var(--color-muted)]">${page} / ${totalPages} ページ (全 ${total.toLocaleString("ja-JP")} 件)</span>${next}</nav>`
      : `<p class="text-sm text-[color:var(--color-muted)] mt-3">全 ${total.toLocaleString("ja-JP")} 件</p>`;

  return renderLayout({
    title: "推し実績 — stock-ai",
    description:
      "stock-ai がピックした銘柄の過去実績を全件公開。5 年分 6,000 件以上のバックテストと実運用シグナルで、30 日後の勝率・平均リターンがどう推移しているかを記録。",
    path: page === 1 ? "/picks/" : `/picks/page/${page}`,
    content: `
    <section class="hero">
      <h1>推し実績</h1>
      <p class="lead">レンジサイクル戦略でピックした銘柄の、過去全件の実績記録です。</p>
    </section>
    <section class="section">
      <h2>サマリー</h2>
      ${aggTile}
    </section>
    <section class="section">
      <h2>年別の勝率</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-[color:var(--color-muted-soft)] border-b">
              <th class="p-2">年</th>
              <th class="p-2">件数</th>
              <th class="p-2">30 日勝率</th>
              <th class="p-2">30 日平均</th>
            </tr>
          </thead>
          <tbody>${yearlyRows}</tbody>
        </table>
      </div>
      <p class="text-xs text-[color:var(--color-muted)] mt-2">※ 勝率は「エントリーから 30 営業日後に陽線で終わった割合」。平均はシンプル平均。</p>
    </section>
    <section class="section">
      <h2>ピック履歴</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-[color:var(--color-muted-soft)] border-b">
              <th class="p-2">日付</th>
              <th class="p-2">コード</th>
              <th class="p-2">銘柄</th>
              <th class="p-2">パターン</th>
              <th class="p-2">エントリー</th>
              <th class="p-2">5日</th>
              <th class="p-2">15日</th>
              <th class="p-2">30日</th>
            </tr>
          </thead>
          <tbody>${recordRows}</tbody>
        </table>
      </div>
      ${nav}
    </section>
    <section class="section">
      <p class="text-sm text-[color:var(--color-muted)]">
        戦略の全体像は <a href="/blog/range-cycle-backtest-1235">6,106 件バックテスト記事</a> を、
        今日のピックは <a href="/stocks/">/stocks/</a> をご覧ください。
      </p>
      <p class="text-xs text-[color:var(--color-muted-soft)] mt-2">本ページは過去データにもとづく分析結果の共有であり、売買を勧めるものではありません。</p>
    </section>
`,
  });
};
