import { renderLayout, htmlEscape } from "./html";

export type FxLogRow = {
  date: string;
  direction: string;
  entryPrice: number;
  probability: number;
  confidence: number;
  longWins: number;
  shortWins: number;
  avgLong: number;
  avgShort: number;
  k: number;
  actualLabelPips: number | null;
  actualTpHitMin: number | null;
  actualSlHitMin: number | null;
  pnlPips: number | null;
  hit: number | null;
};

const dirJa = (d: string): string =>
  d === "LONG" ? "買い (LONG)" : d === "SHORT" ? "売り (SHORT)" : d;

const fmtPips = (v: number | null): string =>
  v == null ? "判定前" : `${v >= 0 ? "+" : ""}${v.toFixed(1)} pips`;

const fmtPct = (v: number): string => `${(v * 100).toFixed(1)}%`;

const hitLabel = (hit: number | null): string => {
  if (hit == null) return `<span class="hit pending">判定前</span>`;
  return hit === 1
    ? `<span class="hit win">勝ち</span>`
    : `<span class="hit loss">負け</span>`;
};

export type FxIndexData = {
  rows: FxLogRow[];
  totalPips: number;
  resolvedCount: number;
  winCount: number;
  recent30Pips: number;
  recent30Count: number;
  recent30Wins: number;
};

export const renderFxIndex = (data: FxIndexData): string => {
  const { rows, totalPips, resolvedCount, winCount, recent30Pips, recent30Count, recent30Wins } =
    data;
  const latest = rows[0];
  const items = rows
    .slice(0, 60)
    .map(
      (r) => `
      <li>
        <a href="/fx/log/${htmlEscape(r.date)}">
          <span class="log-date">${htmlEscape(r.date)}</span>
          <span class="log-dir ${r.direction.toLowerCase()}">${htmlEscape(dirJa(r.direction))}</span>
          <span class="log-pips ${(r.pnlPips ?? 0) >= 0 ? "pos" : "neg"}">${htmlEscape(fmtPips(r.pnlPips))}</span>
          ${hitLabel(r.hit)}
        </a>
      </li>`,
    )
    .join("");

  const wr = resolvedCount > 0 ? ((winCount / resolvedCount) * 100).toFixed(1) : "—";
  const recentWr = recent30Count > 0 ? ((recent30Wins / recent30Count) * 100).toFixed(1) : "—";

  return renderLayout({
    title: "FX USDJPY 寄付方向の検証ログ — stock-ai",
    description:
      "USDJPY の寄付方向を 5-seed MLP アンサンブル + kNN で予測し、TP+30/SL-20pips で検証した日次ログの一覧。",
    path: "/fx/",
    content: `
    <h1>FX USDJPY 寄付方向の検証ログ</h1>
    <p>
      USDJPY の 9:00 JST 寄付足 (= 00:00 UTC) に対して、5-seed MLP アンサンブルと kNN で方向判定を行い、
      TP +30 / SL -20 pips の非対称 R:R で検証した日次ログの一覧です。
      <strong>仮想検証であり、実売買を推奨するものではありません。</strong>
    </p>

    ${
      latest
        ? `
    <section class="latest-card">
      <h2>最新のシグナル (${htmlEscape(latest.date)})</h2>
      <dl class="latest-dl">
        <dt>方向</dt><dd>${htmlEscape(dirJa(latest.direction))}</dd>
        <dt>確率</dt><dd>${fmtPct(latest.probability)}</dd>
        <dt>信頼度</dt><dd>${latest.confidence.toFixed(2)}</dd>
        <dt>類似日</dt><dd>LONG勝ち ${latest.longWins} / SHORT勝ち ${latest.shortWins} <small>(k=${latest.k})</small></dd>
        <dt>結果</dt><dd>${fmtPips(latest.pnlPips)} ${hitLabel(latest.hit)}</dd>
      </dl>
      <p class="latest-link"><a href="/fx/log/${htmlEscape(latest.date)}">詳細を見る →</a></p>
    </section>`
        : ""
    }

    <section class="agg">
      <h2>通算成績</h2>
      <dl class="agg-dl">
        <dt>直近 30 営業日</dt>
        <dd>${recent30Pips >= 0 ? "+" : ""}${recent30Pips.toFixed(1)} pips <small>(勝率 ${recentWr}% / n=${recent30Count})</small></dd>
        <dt>通算</dt>
        <dd>${totalPips >= 0 ? "+" : ""}${totalPips.toFixed(1)} pips <small>(勝率 ${wr}% / n=${resolvedCount})</small></dd>
      </dl>
    </section>

    <section class="list">
      <h2>日次ログ一覧 (直近 60 件)</h2>
      <ul class="log-list">${items}</ul>
    </section>

    <style>
      .latest-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin: 1.5rem 0; }
      .latest-card h2 { margin-top: 0; }
      .latest-dl { display: grid; grid-template-columns: auto 1fr; gap: 0.4rem 0.75rem; margin: 0; font-size: 0.95rem; }
      .latest-dl dt { color: #64748b; font-size: 0.85rem; }
      .latest-dl dd { margin: 0; font-weight: 600; }
      .latest-dl dd small { color: #94a3b8; font-weight: 400; font-size: 0.85em; }
      .latest-link { margin: 0.75rem 0 0; font-size: 0.9rem; }
      .agg-dl { display: grid; grid-template-columns: auto 1fr; gap: 0.4rem 0.75rem; margin: 0; font-size: 0.95rem; }
      .agg-dl dt { color: #64748b; font-size: 0.85rem; }
      .agg-dl dd { margin: 0; font-weight: 600; }
      .agg-dl dd small { color: #94a3b8; font-weight: 400; }
      .log-list { list-style: none; padding: 0; margin: 1rem 0; }
      .log-list li { border-bottom: 1px solid #f1f5f9; }
      .log-list a { display: grid; grid-template-columns: 7rem 7rem 1fr auto; gap: 0.5rem; align-items: center; padding: 0.5rem 0; text-decoration: none; color: inherit; font-size: 0.9rem; }
      .log-list a:hover { background: #f8fafc; }
      .log-date { font-family: ui-monospace, monospace; color: #475569; }
      .log-dir { font-weight: 600; }
      .log-dir.long { color: #047857; }
      .log-dir.short { color: #b91c1c; }
      .log-pips { text-align: right; font-family: ui-monospace, monospace; }
      .log-pips.pos { color: #047857; }
      .log-pips.neg { color: #b91c1c; }
      .hit { font-size: 0.75rem; padding: 0.1rem 0.4rem; border-radius: 999px; font-weight: 600; }
      .hit.win { background: #d1fae5; color: #065f46; }
      .hit.loss { background: #fee2e2; color: #991b1b; }
      .hit.pending { background: #f1f5f9; color: #475569; }
    </style>
`,
  });
};

export const renderFxLog = (
  row: FxLogRow,
  prev: FxLogRow | null,
): string => {
  const dateJp = row.date;
  const title = `USDJPY ${dateJp} 寄付方向の検証ログ — ${dirJa(row.direction)}`;
  const description = `USDJPY ${dateJp} の寄付方向は ${dirJa(row.direction)}。確率 ${fmtPct(row.probability)}, 類似日 k=${row.k} 中 LONG勝ち${row.longWins}/SHORT勝ち${row.shortWins}。結果: ${fmtPips(row.pnlPips)}`;

  const prevSection = prev
    ? `
    <section class="prev">
      <h2>前日の答え合わせ (${htmlEscape(prev.date)})</h2>
      <dl class="log-dl">
        <dt>方向</dt><dd>${htmlEscape(dirJa(prev.direction))}</dd>
        <dt>結果</dt><dd>${fmtPips(prev.pnlPips)} ${hitLabel(prev.hit)}</dd>
      </dl>
      <p><a href="/fx/log/${htmlEscape(prev.date)}">前日の詳細 →</a></p>
    </section>`
    : "";

  const dominantSide = row.longWins >= row.shortWins ? "LONG" : "SHORT";
  const sideCount = Math.max(row.longWins, row.shortWins);
  const nnShare = row.k > 0 ? ((sideCount / row.k) * 100).toFixed(0) : "0";

  return renderLayout({
    title,
    description,
    path: `/fx/log/${row.date}`,
    ogType: "article",
    content: `
    <article>
      <header class="log-header">
        <p class="log-date-head">${htmlEscape(dateJp)}</p>
        <h1>USDJPY 寄付方向: ${htmlEscape(dirJa(row.direction))}</h1>
      </header>

      <section class="signal">
        <h2>モデル判定</h2>
        <dl class="log-dl">
          <dt>方向</dt><dd class="dir-${row.direction.toLowerCase()}">${htmlEscape(dirJa(row.direction))}</dd>
          <dt>確率</dt><dd>${fmtPct(row.probability)}</dd>
          <dt>信頼度</dt><dd>${row.confidence.toFixed(2)}</dd>
          <dt>エントリー価格</dt><dd>${row.entryPrice.toFixed(3)}</dd>
        </dl>
      </section>

      <section class="knn">
        <h2>過去類似日 (k=${row.k})</h2>
        <p>
          当日の寄付条件に特徴量が最も近い過去 ${row.k} 営業日を kNN で検索しました。
          その日の 9:00-11:00 のうちに TP+30pips / SL-20pips に先に当たった側で勝敗を定義しています。
        </p>
        <dl class="log-dl">
          <dt>LONG 勝ちの類似日</dt><dd>${row.longWins} 日 (平均 ${row.avgLong >= 0 ? "+" : ""}${row.avgLong.toFixed(1)} pips)</dd>
          <dt>SHORT 勝ちの類似日</dt><dd>${row.shortWins} 日 (平均 ${row.avgShort >= 0 ? "+" : ""}${row.avgShort.toFixed(1)} pips)</dd>
          <dt>優勢側</dt><dd>${dominantSide} (${nnShare}%)</dd>
        </dl>
      </section>

      <section class="result">
        <h2>当日の結果</h2>
        ${
          row.pnlPips == null
            ? `<p>当日の結果はまだ判定されていません。11:00 以降に自動更新されます。</p>`
            : `
        <dl class="log-dl">
          <dt>pips</dt><dd>${fmtPips(row.pnlPips)}</dd>
          <dt>勝敗</dt><dd>${hitLabel(row.hit)}</dd>
          <dt>TP ヒット (分)</dt><dd>${row.actualTpHitMin ?? "—"}</dd>
          <dt>SL ヒット (分)</dt><dd>${row.actualSlHitMin ?? "—"}</dd>
        </dl>`
        }
      </section>

      ${prevSection}

      <section class="notes">
        <h2>検証ルール</h2>
        <ul>
          <li>エントリー: 9:00 JST (= 00:00 UTC) の寄付足</li>
          <li>利確/損切: TP +30 pips / SL -20 pips</li>
          <li>強制手仕舞い: 11:00 JST 時点でまだ残っていればクローズ</li>
          <li>モデル: 5-seed MLP アンサンブル + 類似日 kNN</li>
        </ul>
        <p class="notice">
          <strong>仮想検証であり、実売買を推奨するものではありません。</strong>
          投資判断はご自身の責任でお願いします。
        </p>
      </section>

      <p><a href="/fx/">← 日次ログ一覧へ</a></p>
    </article>

    <style>
      .log-header p.log-date-head { margin: 0; color: #94a3b8; font-size: 0.85rem; font-family: ui-monospace, monospace; }
      .log-dl { display: grid; grid-template-columns: auto 1fr; gap: 0.4rem 0.75rem; margin: 0.5rem 0 0; font-size: 0.95rem; }
      .log-dl dt { color: #64748b; font-size: 0.85rem; }
      .log-dl dd { margin: 0; font-weight: 600; }
      .dir-long { color: #047857; }
      .dir-short { color: #b91c1c; }
      .hit { font-size: 0.78rem; padding: 0.1rem 0.5rem; border-radius: 999px; font-weight: 600; }
      .hit.win { background: #d1fae5; color: #065f46; }
      .hit.loss { background: #fee2e2; color: #991b1b; }
      .hit.pending { background: #f1f5f9; color: #475569; }
      .signal, .knn, .result, .prev, .notes { margin: 1.5rem 0; }
    </style>
`,
  });
};

export const renderFxNotFound = (date: string): string =>
  renderLayout({
    title: "FX ログが見つかりません — stock-ai",
    description: "指定日の FX 検証ログは記録されていません。",
    path: `/fx/log/${date}`,
    content: `
    <h1>FX ログが見つかりません</h1>
    <p>日付 <code>${htmlEscape(date)}</code> の USDJPY 検証ログは記録されていません。</p>
    <p><a href="/fx/">日次ログ一覧へ戻る</a></p>
`,
  });
