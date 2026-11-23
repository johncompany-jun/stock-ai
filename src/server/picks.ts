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

export type PicksHistoryData = {
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

export const renderStocksHistory = (data: PicksHistoryData): string => {
  const { records, page, totalPages, total } = data;

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

  const linkTo = (n: number): string =>
    n === 1 ? "/stocks/history/" : `/stocks/history/page/${n}`;
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
    title: `ピック履歴 (${page} / ${totalPages}) — stock-ai`,
    description:
      "日本株 レンジサイクル戦略でピックした全銘柄の履歴。日付・コード・エントリー価格・5/15/30 日後のリターンを全件公開。",
    path: page === 1 ? "/stocks/history/" : `/stocks/history/page/${page}`,
    content: `
    <section class="hero">
      <h1>ピック履歴</h1>
      <p class="lead">レンジサイクル戦略でピックした銘柄の、過去全件の実績記録です。</p>
      <p class="text-sm mt-3"><a href="/stocks/">← 検証ログ (今日のピック / 通算成績) に戻る</a></p>
    </section>
    <section class="section">
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
      <p class="text-xs text-[color:var(--color-muted-soft)] mt-3">
        本ページは過去データにもとづく分析結果の共有であり、売買を勧めるものではありません。
      </p>
    </section>
`,
  });
};
