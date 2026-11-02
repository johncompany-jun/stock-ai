import { renderLayout, htmlEscape } from "./html";

export type StocksPick = {
  code: string;
  name: string | null;
  patterns: string;
  entryClose: number;
  patternN: number;
  patternWr30d: number | null;
  patternAvg30d: number | null;
};

export type StocksHistoryRow = {
  runDate: number;
  code: string;
  name: string | null;
  entryClose: number;
  return30dPct: number | null;
};

export type StocksMonthlyRow = {
  buy_month: number;
  n: number;
  wr_90d: number;
  avg_90d: number;
};

export type StocksAgg = {
  n: number;
  n30d: number;
  wr30d: number | null;
  avg30d: number | null;
  firstDate: number | null;
  lastDate: number | null;
};

export type StocksIndexData = {
  latestDate: number | null;
  today: StocksPick[];
  agg: StocksAgg | null;
  history: StocksHistoryRow[];
  monthly: StocksMonthlyRow[];
  currentMonth: number;
  currentMonthStat: StocksMonthlyRow | null;
};

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

export const renderStocksIndex = (data: StocksIndexData): string => {
  const { latestDate, today, agg, history, monthly, currentMonth, currentMonthStat } = data;

  const todayItems = today
    .map(
      (p) => `
      <tr>
        <td class="p-2 font-mono text-xs">${htmlEscape(p.code)}</td>
        <td class="p-2">${htmlEscape(p.name ?? "—")}</td>
        <td class="p-2 font-mono text-xs">${p.entryClose.toLocaleString("ja-JP")} 円</td>
        <td class="p-2 text-xs">${p.patternWr30d != null ? `${p.patternWr30d.toFixed(1)}%` : "—"} <span class="text-[color:var(--color-muted-soft)]">(n=${p.patternN})</span></td>
        <td class="p-2 text-xs ${pctCls(p.patternAvg30d)}">${pctFmt(p.patternAvg30d)}</td>
      </tr>`,
    )
    .join("");

  const historyItems = history
    .slice(0, 30)
    .map(
      (h) => `
      <li>
        <a href="#" onclick="return false;" aria-disabled="true">
          <span class="date">${htmlEscape(formatYmd(h.runDate))}</span>
          <span class="dir">${htmlEscape(h.code)}${h.name ? ` <span class="text-[color:var(--color-muted)] font-normal text-xs">${htmlEscape(h.name)}</span>` : ""}</span>
          <span class="pips ${pctCls(h.return30dPct)}">${pctFmt(h.return30dPct)}</span>
          ${h.return30dPct == null ? `<span class="badge pending">判定前</span>` : h.return30dPct >= 0 ? `<span class="badge win">勝ち</span>` : `<span class="badge loss">負け</span>`}
        </a>
      </li>`,
    )
    .join("");

  const monthNames = ["", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const monthlyItems = monthly
    .map(
      (m) => `
      <tr${m.buy_month === currentMonth ? ' class="bg-[color:var(--color-brand-soft)]"' : ""}>
        <td class="p-2">${monthNames[m.buy_month]}</td>
        <td class="p-2 font-mono text-xs">${m.wr_90d != null ? `${m.wr_90d.toFixed(1)}%` : "—"}</td>
        <td class="p-2 font-mono text-xs ${pctCls(m.avg_90d)}">${pctFmt(m.avg_90d)}</td>
        <td class="p-2 text-xs text-[color:var(--color-muted-soft)]">n=${m.n}</td>
      </tr>`,
    )
    .join("");

  return renderLayout({
    title: "日本株 レンジサイクル検証ログ — stock-ai",
    description:
      "東証スタンダード/グロース/プライムから、レンジサイクル戦略 (3M安値付近での仕込み) に合致する銘柄を日次検出。14ヶ月1,235件のバックテストで30日勝率47.88%・平均+1.05%。仮想検証ログを公開。",
    path: "/stocks/",
    content: `
    <section class="hero">
      <h1>日本株 レンジサイクル検証ログ</h1>
      <p class="lead">
        東証スタンダード / グロース / プライムから、
        3ヶ月安値付近での仕込みパターンに合致する銘柄を日次で検出しています。
        30日ホライズンで勝率と平均リターンを公開しているバックテスト+運用記録です。
      </p>
      <div class="notice">仮想検証であり、実売買を推奨するものではありません。</div>
    </section>

    ${
      agg
        ? `
    <section class="section">
      <h2>通算成績 (30日ホライズン)</h2>
      <div class="stat-grid">
        <div class="card">
          <span class="label block text-xs text-[color:var(--color-muted)] mb-1 font-semibold">勝率</span>
          <span class="value ${agg.wr30d != null && agg.wr30d >= 50 ? "pos" : agg.wr30d != null && agg.wr30d < 50 ? "neg" : ""} font-mono text-2xl font-bold">${agg.wr30d != null ? `${agg.wr30d.toFixed(2)}%` : "—"}</span>
          <div class="text-xs text-[color:var(--color-muted-soft)] mt-1">n = ${agg.n30d}</div>
        </div>
        <div class="card">
          <span class="label block text-xs text-[color:var(--color-muted)] mb-1 font-semibold">平均リターン</span>
          <span class="value ${pctCls(agg.avg30d)} font-mono text-2xl font-bold">${pctFmt(agg.avg30d)}</span>
          <div class="text-xs text-[color:var(--color-muted-soft)] mt-1">集計期間 ${agg.firstDate ? htmlEscape(formatYmd(agg.firstDate)) : "—"} 〜 ${agg.lastDate ? htmlEscape(formatYmd(agg.lastDate)) : "—"}</div>
        </div>
      </div>
      <p class="text-sm mt-3 text-[color:var(--color-muted)]">
        勝率は50%割れでも、平均リターンがプラスなら期待値はプラス (農家哲学: ホームランではなくヒット)。
        詳しい読み方は <a href="/blog/range-cycle-backtest-1235">バックテスト記事</a> をご覧ください。
      </p>
    </section>`
        : ""
    }

    ${
      latestDate && today.length > 0
        ? `
    <section class="section">
      <h2>最新のピック (${htmlEscape(formatYmd(latestDate))})</h2>
      <div class="card">
        <div class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="bg-[color:var(--color-surface-soft)] text-[color:var(--color-muted)] text-xs">
                <th class="p-2 text-left">コード</th>
                <th class="p-2 text-left">銘柄名</th>
                <th class="p-2 text-left">エントリー価格</th>
                <th class="p-2 text-left">パターン勝率</th>
                <th class="p-2 text-left">パターン平均</th>
              </tr>
            </thead>
            <tbody>${todayItems}</tbody>
          </table>
        </div>
        <p class="text-xs text-[color:var(--color-muted)] mt-3">
          「パターン勝率」「平均」は、過去の同一パターン発生時の 30 日後リターン集計です。
          未来の予測ではありません。
        </p>
      </div>
    </section>`
        : latestDate
          ? `<section class="section"><p class="text-sm text-[color:var(--color-muted)]">${htmlEscape(formatYmd(latestDate))} のピックはありません。</p></section>`
          : `<section class="section"><p class="text-sm text-[color:var(--color-muted)]">ピックデータはまだ記録されていません。</p></section>`
    }

    ${
      monthly.length > 0
        ? `
    <section class="section">
      <h2>月別 90日ホライズン</h2>
      <div class="card">
        ${currentMonthStat ? `<p class="text-sm mb-3">今月 (${monthNames[currentMonth]}) の過去実績: <strong>勝率 ${currentMonthStat.wr_90d.toFixed(1)}% / 平均 ${pctFmt(currentMonthStat.avg_90d)}</strong></p>` : ""}
        <div class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="bg-[color:var(--color-surface-soft)] text-[color:var(--color-muted)] text-xs">
                <th class="p-2 text-left">仕込み月</th>
                <th class="p-2 text-left">勝率 (90日)</th>
                <th class="p-2 text-left">平均リターン</th>
                <th class="p-2 text-left">件数</th>
              </tr>
            </thead>
            <tbody>${monthlyItems}</tbody>
          </table>
        </div>
        <p class="text-xs text-[color:var(--color-muted)] mt-3">
          「3ヶ月レンジで仕込んで3ヶ月で収穫」の戦略に合わせて、
          90日ホライズンで集計しています。詳細は <a href="/blog/stock-seasonality-september">季節性の記事</a>。
        </p>
      </div>
    </section>`
        : ""
    }

    ${
      history.length > 0
        ? `
    <section class="section">
      <h2>直近のピックと答え合わせ (30日後)</h2>
      <ul class="row-list">${historyItems}</ul>
      <p class="text-xs text-[color:var(--color-muted)] mt-3">
        各シグナルの 30日後の実リターン結果。「判定前」は 30 営業日経過前です。
      </p>
    </section>`
        : ""
    }

    <section class="section">
      <h2>戦略の説明</h2>
      <div class="card-soft">
        <ul class="list-disc pl-5 space-y-1 text-sm">
          <li><strong>対象</strong>: 東証スタンダード / グロース / プライムの 100-1,000 円銘柄 (10万円以内で 100 株買えるライン)</li>
          <li><strong>検出パターン</strong>: oversold_reversal / pullback_to_ma / gap_down_reversal</li>
          <li><strong>評価</strong>: 30 日後の価格リターン、勝率と平均で期待値を測定</li>
          <li><strong>原則</strong>: 単発の予測ではなく、過去同一パターンの統計で「N 回中 M 回勝ち」を提示</li>
        </ul>
        <p class="text-sm mt-3">詳しくは <a href="/blog/range-cycle-backtest-1235">1,235件バックテスト記事</a> と <a href="/blog/stock-model-collapse-2026-10">モデル崩壊の記録</a> をご覧ください。</p>
      </div>
    </section>
`,
  });
};
