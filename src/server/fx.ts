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

const dirClass = (d: string): string =>
  d === "LONG" ? "long" : d === "SHORT" ? "short" : "";

const fmtPips = (v: number | null): string =>
  v == null ? "判定前" : `${v >= 0 ? "+" : ""}${v.toFixed(1)} pips`;

const fmtPct = (v: number): string => `${(v * 100).toFixed(1)}%`;

const hitBadge = (hit: number | null): string => {
  if (hit == null) return `<span class="badge pending">判定前</span>`;
  return hit === 1
    ? `<span class="badge win">勝ち</span>`
    : `<span class="badge loss">負け</span>`;
};

const pipsCls = (v: number | null): string =>
  v == null ? "" : v >= 0 ? "pos" : "neg";

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
          <span class="date">${htmlEscape(r.date)}</span>
          <span class="dir ${dirClass(r.direction)}">${htmlEscape(dirJa(r.direction))}</span>
          <span class="pips ${pipsCls(r.pnlPips)}">${htmlEscape(fmtPips(r.pnlPips))}</span>
          ${hitBadge(r.hit)}
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
    <section class="hero">
      <h1>FX USDJPY 寄付方向の検証ログ</h1>
      <p class="lead">
        USDJPY の 9:00 JST 寄付足 (= 00:00 UTC) に対して、5-seed MLP アンサンブルと kNN で方向判定を行い、
        TP +30 / SL -20 pips の非対称 R:R で検証した日次ログの一覧です。
      </p>
      <div class="notice">仮想検証であり、実売買を推奨するものではありません。</div>
    </section>

    ${
      latest
        ? `
    <section class="section">
      <h2>最新のシグナル (${htmlEscape(latest.date)})</h2>
      <div class="card">
        <div class="stat-grid">
          <div class="stat">
            <span class="label">方向</span>
            <span class="value sm"><span class="badge ${dirClass(latest.direction)}">${htmlEscape(dirJa(latest.direction))}</span></span>
          </div>
          <div class="stat">
            <span class="label">確率</span>
            <span class="value">${fmtPct(latest.probability)}</span>
            <span class="sub">信頼度 ${latest.confidence.toFixed(2)}</span>
          </div>
          <div class="stat">
            <span class="label">類似日</span>
            <span class="value sm">LONG勝ち ${latest.longWins} / SHORT勝ち ${latest.shortWins}</span>
            <span class="sub">k=${latest.k}</span>
          </div>
          <div class="stat">
            <span class="label">結果</span>
            <span class="value ${pipsCls(latest.pnlPips)}">${fmtPips(latest.pnlPips)}</span>
          </div>
        </div>
        <p class="mt-4"><a href="/fx/log/${htmlEscape(latest.date)}" class="btn btn-outline">詳細を見る →</a></p>
      </div>
    </section>`
        : ""
    }

    <section class="section">
      <h2>通算成績</h2>
      <div class="stat-grid">
        <div class="card">
          <span class="label block text-xs text-[color:var(--color-muted)] mb-1 font-semibold">直近 30 営業日</span>
          <span class="value ${pipsCls(recent30Pips)} font-mono text-2xl font-bold">${recent30Pips >= 0 ? "+" : ""}${recent30Pips.toFixed(1)} pips</span>
          <div class="text-xs text-[color:var(--color-muted-soft)] mt-1">勝率 ${recentWr}% (n=${recent30Count})</div>
        </div>
        <div class="card">
          <span class="label block text-xs text-[color:var(--color-muted)] mb-1 font-semibold">通算</span>
          <span class="value ${pipsCls(totalPips)} font-mono text-2xl font-bold">${totalPips >= 0 ? "+" : ""}${totalPips.toFixed(1)} pips</span>
          <div class="text-xs text-[color:var(--color-muted-soft)] mt-1">勝率 ${wr}% (n=${resolvedCount})</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>日次ログ一覧 (直近 60 件)</h2>
      <ul class="row-list">${items}</ul>
    </section>
`,
  });
};

export const renderFxLog = (row: FxLogRow, prev: FxLogRow | null): string => {
  const title = `USDJPY ${row.date} 寄付方向の検証ログ — ${dirJa(row.direction)}`;
  const description = `USDJPY ${row.date} の寄付方向は ${dirJa(row.direction)}。確率 ${fmtPct(row.probability)}, 類似日 k=${row.k} 中 LONG勝ち${row.longWins}/SHORT勝ち${row.shortWins}。結果: ${fmtPips(row.pnlPips)}`;

  const prevSection = prev
    ? `
    <section class="section">
      <h2>前日の答え合わせ (${htmlEscape(prev.date)})</h2>
      <div class="card">
        <div class="stat-grid">
          <div class="stat"><span class="label">方向</span><span class="value sm"><span class="badge ${dirClass(prev.direction)}">${htmlEscape(dirJa(prev.direction))}</span></span></div>
          <div class="stat"><span class="label">結果</span><span class="value ${pipsCls(prev.pnlPips)}">${fmtPips(prev.pnlPips)}</span></div>
        </div>
        <p class="mt-4"><a href="/fx/log/${htmlEscape(prev.date)}" class="btn btn-outline">前日の詳細 →</a></p>
      </div>
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
      <header class="hero">
        <p class="text-xs text-[color:var(--color-muted-soft)] font-mono m-0 mb-2">${htmlEscape(row.date)}</p>
        <h1>USDJPY 寄付方向: <span class="badge ${dirClass(row.direction)}" style="font-size: 0.6em; vertical-align: middle;">${htmlEscape(dirJa(row.direction))}</span></h1>
      </header>

      <section class="section">
        <h2>モデル判定</h2>
        <div class="card">
          <div class="stat-grid">
            <div class="stat"><span class="label">方向</span><span class="value sm"><span class="badge ${dirClass(row.direction)}">${htmlEscape(dirJa(row.direction))}</span></span></div>
            <div class="stat"><span class="label">確率</span><span class="value">${fmtPct(row.probability)}</span></div>
            <div class="stat"><span class="label">信頼度</span><span class="value sm">${row.confidence.toFixed(2)}</span></div>
            <div class="stat"><span class="label">エントリー価格</span><span class="value sm">${row.entryPrice.toFixed(3)}</span></div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>過去類似日 (k=${row.k})</h2>
        <p>
          当日の寄付条件に特徴量が最も近い過去 ${row.k} 営業日を kNN で検索しました。
          その日の 9:00-11:00 のうちに TP+30pips / SL-20pips に先に当たった側で勝敗を定義しています。
        </p>
        <div class="card">
          <div class="stat-grid">
            <div class="stat">
              <span class="label">LONG 勝ちの類似日</span>
              <span class="value sm">${row.longWins} 日</span>
              <span class="sub">平均 ${row.avgLong >= 0 ? "+" : ""}${row.avgLong.toFixed(1)} pips</span>
            </div>
            <div class="stat">
              <span class="label">SHORT 勝ちの類似日</span>
              <span class="value sm">${row.shortWins} 日</span>
              <span class="sub">平均 ${row.avgShort >= 0 ? "+" : ""}${row.avgShort.toFixed(1)} pips</span>
            </div>
            <div class="stat">
              <span class="label">優勢側</span>
              <span class="value sm"><span class="badge ${dirClass(dominantSide)}">${dominantSide}</span></span>
              <span class="sub">${nnShare}%</span>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>当日の結果</h2>
        ${
          row.pnlPips == null
            ? `<div class="card"><p class="m-0 text-sm">当日の結果はまだ判定されていません。11:00 以降に自動更新されます。</p></div>`
            : `
        <div class="card">
          <div class="stat-grid">
            <div class="stat"><span class="label">pips</span><span class="value ${pipsCls(row.pnlPips)}">${fmtPips(row.pnlPips)}</span></div>
            <div class="stat"><span class="label">勝敗</span><span class="value sm">${hitBadge(row.hit)}</span></div>
            <div class="stat"><span class="label">TP ヒット (分)</span><span class="value sm">${row.actualTpHitMin ?? "—"}</span></div>
            <div class="stat"><span class="label">SL ヒット (分)</span><span class="value sm">${row.actualSlHitMin ?? "—"}</span></div>
          </div>
        </div>`
        }
      </section>

      ${prevSection}

      <section class="section">
        <h2>検証ルール</h2>
        <ul class="list-disc pl-5 space-y-1 text-sm">
          <li>エントリー: 9:00 JST (= 00:00 UTC) の寄付足</li>
          <li>利確/損切: TP +30 pips / SL -20 pips</li>
          <li>強制手仕舞い: 11:00 JST 時点でまだ残っていればクローズ</li>
          <li>モデル: 5-seed MLP アンサンブル + 類似日 kNN</li>
        </ul>
        <div class="notice-strip mt-4">
          <strong>仮想検証であり、実売買を推奨するものではありません。</strong>
          投資判断はご自身の責任でお願いします。
        </div>
      </section>

      <p class="mt-6"><a href="/fx/" class="btn btn-outline">← 日次ログ一覧へ</a></p>
    </article>
`,
  });
};

export const renderFxNotFound = (date: string): string =>
  renderLayout({
    title: "FX ログが見つかりません — stock-ai",
    description: "指定日の FX 検証ログは記録されていません。",
    path: `/fx/log/${date}`,
    content: `
    <section class="hero">
      <h1>FX ログが見つかりません</h1>
      <p class="lead">日付 <code>${htmlEscape(date)}</code> の USDJPY 検証ログは記録されていません。</p>
    </section>
    <p><a href="/fx/" class="btn btn-outline">日次ログ一覧へ戻る</a></p>
`,
  });
