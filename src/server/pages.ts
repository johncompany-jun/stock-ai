import { renderLayout, htmlEscape } from "./html";
import { listPostMeta } from "./blog";

const formatYmd = (ymd: number): string => {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor((ymd % 10000) / 100);
  const d = ymd % 100;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export type HomeSnapshot = {
  stocks: {
    latestDate: number | null;
    todayCount: number;
    wr30d: number | null;
    avg30d: number | null;
    sampleN: number;
  };
  fx: {
    latestDate: string | null;
    direction: string | null;
    probability: number | null;
    confidence: number | null;
    pnlPips: number | null;
  };
};

const renderSnapshotStocks = (s: HomeSnapshot["stocks"]): string => {
  if (!s.latestDate) {
    return `<p class="snap-empty">株の検証データはまだ記録されていません。</p>`;
  }
  const wr = s.wr30d != null ? `${s.wr30d.toFixed(1)}%` : "—";
  const avg = s.avg30d != null ? `${s.avg30d >= 0 ? "+" : ""}${s.avg30d.toFixed(2)}%` : "—";
  return `
    <dl class="snap-dl">
      <dt>最新日</dt><dd>${htmlEscape(formatYmd(s.latestDate))}</dd>
      <dt>当日ピック数</dt><dd>${s.todayCount} 件</dd>
      <dt>過去 30 日勝率</dt><dd>${wr} <small>(n=${s.sampleN})</small></dd>
      <dt>平均リターン</dt><dd>${avg}</dd>
    </dl>
    <p class="snap-link"><a href="/stocks/">株の検証ログを見る →</a></p>`;
};

const renderSnapshotFx = (f: HomeSnapshot["fx"]): string => {
  if (!f.latestDate) {
    return `<p class="snap-empty">FX の検証データはまだ記録されていません。</p>`;
  }
  const dirJa = f.direction === "LONG" ? "買い (LONG)" : f.direction === "SHORT" ? "売り (SHORT)" : "—";
  const prob = f.probability != null ? `${(f.probability * 100).toFixed(1)}%` : "—";
  const conf = f.confidence != null ? f.confidence.toFixed(2) : "—";
  const pnl =
    f.pnlPips != null ? `${f.pnlPips >= 0 ? "+" : ""}${f.pnlPips.toFixed(1)} pips` : "判定前";
  return `
    <dl class="snap-dl">
      <dt>最新日</dt><dd>${htmlEscape(f.latestDate)}</dd>
      <dt>方向</dt><dd>${htmlEscape(dirJa)}</dd>
      <dt>確率</dt><dd>${prob}</dd>
      <dt>信頼度</dt><dd>${conf}</dd>
      <dt>結果</dt><dd>${pnl}</dd>
    </dl>
    <p class="snap-link"><a href="/fx/">FX の検証ログを見る →</a></p>`;
};

export const renderHome = (snapshot: HomeSnapshot): string => {
  const posts = listPostMeta().slice(0, 3);
  const postItems = posts
    .map(
      (p) => `
      <li>
        <a href="/blog/${htmlEscape(p.slug)}">
          <span class="post-date">${htmlEscape(p.date)}</span>
          <span class="post-title">${htmlEscape(p.title)}</span>
        </a>
      </li>`,
    )
    .join("");

  return renderLayout({
    title: "stock-ai — 日本株とFXをAIで検証する個人サイト",
    description:
      "日本株のパターン検出と USDJPY の寄付予測を機械学習で日次検証し、仮想50万円で勝率と平均リターンを公開するサイトです。",
    path: "/",
    content: `
    <section class="hero">
      <h1>日本株とFXをAIで検証する個人サイト</h1>
      <p class="lead">
        LSTM と kNN を使って、日本株のパターン検出と USDJPY の寄付方向を日次で検証しています。
        仮想 50 万円でパターンの勝率と平均リターンを記録・公開し、答え合わせを積み重ねるためのサイトです。
      </p>
      <p class="notice">本サイトは過去データにもとづく検証記録であり、売買を勧めるものではありません。</p>
    </section>

    <section class="today">
      <h2>今日の検証スナップショット</h2>
      <div class="snap-grid">
        <div class="snap-card">
          <h3>日本株 (レンジサイクル)</h3>
          ${renderSnapshotStocks(snapshot.stocks)}
        </div>
        <div class="snap-card">
          <h3>FX USDJPY (寄付方向)</h3>
          ${renderSnapshotFx(snapshot.fx)}
        </div>
      </div>
    </section>

    <section class="how">
      <h2>このサイトの使い方</h2>
      <ol>
        <li><a href="/stocks/">株の検証ログ</a> — レンジ安値で検出した銘柄と、その後の値動き記録</li>
        <li><a href="/fx/">FX の検証ログ</a> — 寄付方向の予測と、kNN が返した過去類似日の勝敗</li>
        <li><a href="/blog/">ブログ</a> — 月次レポートと開発記録</li>
      </ol>
    </section>

    ${
      posts.length > 0
        ? `
    <section class="latest-posts">
      <h2>最新のブログ</h2>
      <ul class="post-list">${postItems}</ul>
      <p><a href="/blog/">ブログ一覧へ →</a></p>
    </section>`
        : ""
    }

    <section class="waitlist" id="waitlist">
      <h2>検証ログの配信を受け取る (待ちリスト)</h2>
      <p>
        FX 日次ログと株の月次レポートの配信を予定しています。
        配信が始まる前に、確認メールをお送りします。確認ボタンを押していただいた方にのみ本配信を行います。
        <strong>配信開始時期は未定です。</strong>
      </p>
      <form method="post" action="/api/waitlist" class="waitlist-form">
        <label>
          <span>メールアドレス</span>
          <input type="email" name="email" required placeholder="you@example.com" autocomplete="email" />
        </label>
        <fieldset>
          <legend>興味のあるカテゴリ</legend>
          <label class="radio"><input type="radio" name="category" value="both" checked /> 両方 (株と FX)</label>
          <label class="radio"><input type="radio" name="category" value="fx" /> FX のみ</label>
          <label class="radio"><input type="radio" name="category" value="stocks" /> 株のみ</label>
        </fieldset>
        <button type="submit">待ちリストに登録</button>
        <p class="form-note">
          メールアドレスは配信目的以外には使用せず、第三者に提供することもありません。
          詳しくは <a href="/privacy">プライバシーポリシー</a> をご覧ください。
        </p>
      </form>
    </section>

    <section class="about-short">
      <h2>このサイトについて</h2>
      <p>
        個人開発者 <a href="https://x.com/jun2000jp" rel="me noopener">@jun2000jp</a> が
        build in public で開発しています。詳しくは <a href="/about">このサイトについて</a> と
        <a href="/disclaimer">免責事項</a> をご覧ください。
      </p>
    </section>

    <style>
      .hero { margin-bottom: 2rem; }
      .hero .lead { font-size: 1rem; color: #334155; }
      .today { margin: 2rem 0; }
      .snap-grid { display: grid; gap: 1rem; grid-template-columns: 1fr; }
      @media (min-width: 640px) { .snap-grid { grid-template-columns: 1fr 1fr; } }
      .snap-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.75rem 1rem; background: #fafafa; }
      .snap-card h3 { font-size: 0.95rem; margin: 0 0 0.5rem; color: #0f172a; }
      .snap-dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; margin: 0; font-size: 0.9rem; }
      .snap-dl dt { color: #64748b; }
      .snap-dl dd { margin: 0; font-weight: 600; color: #0f172a; }
      .snap-dl small { color: #94a3b8; font-weight: 400; font-size: 0.8em; }
      .snap-link { margin: 0.6rem 0 0; font-size: 0.85rem; }
      .snap-empty { color: #64748b; font-size: 0.9rem; }
      .how ol { margin-left: 0; padding-left: 1.25rem; }
      .how a { font-weight: 600; }
      .latest-posts { margin: 2rem 0; }
      .latest-posts .post-list { list-style: none; padding: 0; margin: 0.5rem 0; }
      .latest-posts .post-list li { padding: 0.5rem 0; border-bottom: 1px solid #f1f5f9; }
      .latest-posts a { display: flex; gap: 0.75rem; text-decoration: none; align-items: baseline; }
      .latest-posts a:hover .post-title { text-decoration: underline; }
      .latest-posts .post-date { color: #94a3b8; font-size: 0.8rem; font-family: ui-monospace, monospace; flex-shrink: 0; }
      .latest-posts .post-title { color: #111827; font-weight: 600; }
      .waitlist { margin: 2.5rem 0; padding: 1rem 1.25rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
      .waitlist h2 { margin-top: 0.25rem; }
      .waitlist-form { display: grid; gap: 0.75rem; }
      .waitlist-form label > span { display: block; font-size: 0.85rem; color: #475569; margin-bottom: 0.25rem; }
      .waitlist-form input[type="email"] { width: 100%; padding: 0.55rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 1rem; box-sizing: border-box; }
      .waitlist-form fieldset { border: none; padding: 0; margin: 0; }
      .waitlist-form legend { font-size: 0.85rem; color: #475569; margin-bottom: 0.25rem; }
      .waitlist-form .radio { display: inline-flex; align-items: center; gap: 0.25rem; margin-right: 0.9rem; font-size: 0.9rem; cursor: pointer; }
      .waitlist-form button { padding: 0.55rem 1rem; background: #0f172a; color: #fff; border: none; border-radius: 6px; font-size: 0.95rem; cursor: pointer; width: fit-content; }
      .waitlist-form button:hover { background: #334155; }
      .form-note { font-size: 0.78rem; color: #64748b; margin: 0.25rem 0 0; }
      .about-short { margin-top: 2rem; }
    </style>
`,
  });
};

export const renderAbout = (): string =>
  renderLayout({
    title: "このサイトについて — stock-ai",
    description: "stock-ai は AI による相場予測の検証記録を公開する個人サイトです。仮想50万円での検証で、売買を勧めるものではありません。",
    path: "/about",
    content: `
    <h1>このサイトについて</h1>
    <div class="notice">本サイトは仮想50万円での検証です。実売買の推奨ではありません。</div>

    <h2>運営</h2>
    <p>個人開発者 <a href="https://x.com/jun2000jp" rel="me noopener">@jun2000jp</a> が運営する個人サイトです。build in public で開発過程を X に投稿しています。</p>

    <h2>目的</h2>
    <p>AI を用いた日本株および FX の相場予測モデルの精度を、過去データと仮想運用の形で記録・公開することが目的です。</p>

    <h2>検証の内容</h2>
    <ul>
      <li><strong>株</strong>: レンジサイクル戦略 (3M安値で種まき/3M高値で収穫) に合致した銘柄を日次でピック。仮想50万円での検証ポートフォリオを公開。</li>
      <li><strong>FX</strong>: USDJPY の寄付方向を 5-seed MLP アンサンブル + kNN で予測。TP +30 / SL -20 pips の非対称 R:R で検証。</li>
    </ul>

    <h2>データの出典</h2>
    <ul>
      <li>日本株日足: <a href="https://finance.yahoo.co.jp/" rel="noopener">Yahoo! Finance Japan</a> (yahoo-finance2 経由で取得)</li>
      <li>USDJPY 分足: <a href="https://www.dukascopy.com/" rel="noopener">Dukascopy</a></li>
    </ul>

    <h2>モデル概要</h2>
    <ul>
      <li>株 LSTM 5日先リターン予測 + パターンマッチ (レンジ安値/高値+SMA200方向一致)</li>
      <li>FX 5-seed MLP アンサンブル + kNN による類似日検索</li>
      <li>バックテストで勝率と平均リターンを提示</li>
    </ul>

    <h2>配信希望の受付 (待ちリスト)</h2>
    <p>月次レポートや FX 日次ログの配信を予定しています。待ちリストにご登録いただいた方には、配信が始まる前に確認メールをお送りします。確認ボタンを押していただいた方にのみ本配信を行います。</p>
    <p><a href="/#waitlist">トップページの登録フォームへ</a></p>
    <p>配信停止・データ削除のご依頼、そのほかのご連絡は <a href="/contact">お問い合わせフォーム</a> からお送りください。メールアドレスは配信以外の目的で使用せず、第三者に提供することもありません。詳細は <a href="/privacy">プライバシーポリシー</a> をご覧ください。</p>
`,
  });

export const renderDisclaimer = (): string =>
  renderLayout({
    title: "免責事項 — stock-ai",
    description: "stock-ai の免責事項。本サイトは過去データにもとづく分析結果の共有であり、売買を勧めるものではありません。",
    path: "/disclaimer",
    content: `
    <h1>免責事項</h1>
    <div class="notice">本サイトは過去データにもとづく分析結果の共有であり、売買を勧めるものではありません。投資判断はご自身の責任でお願いします。</div>

    <h2>1. 情報の性質</h2>
    <p>本サイトおよびメール配信で提供される情報は、過去の相場データと機械学習モデルによる分析結果の共有を目的としています。<strong>特定の金融商品の売買を推奨するもの、投資助言を行うものではありません。</strong></p>

    <h2>2. 投資助言業ではないこと</h2>
    <p>運営者は金融商品取引業の登録を受けていません。本サイトは一切の投資助言サービスを提供しません。</p>

    <h2>3. 検証について</h2>
    <p>サイト内の「ポートフォリオ」および「FX」に表示される損益・成績は、すべて<strong>仮想50万円を使った検証</strong>によるものであり、実際の売買を行った結果ではありません。</p>

    <h2>4. 情報の正確性・完全性</h2>
    <p>情報の正確性・完全性・有用性について、運営者は一切の保証を行いません。元データ提供元の仕様変更やバグ、通信障害等により情報が欠落・遅延することがあります。</p>

    <h2>5. 損害の免責</h2>
    <p>本サイトおよびメール配信の情報を利用したこと、または利用できなかったことに起因するいかなる損害についても、運営者は責任を負いません。</p>

    <h2>6. 変更について</h2>
    <p>本免責事項は予告なく変更されることがあります。</p>
`,
  });

const CONTACT_CATEGORIES = [
  { value: "general", label: "一般的な問い合わせ" },
  { value: "unsubscribe", label: "配信停止・データ削除" },
  { value: "bug", label: "不具合報告" },
  { value: "other", label: "その他" },
];

export const renderContactForm = (errorMessage?: string): string =>
  renderLayout({
    title: "お問い合わせ — stock-ai",
    description: "stock-ai への問い合わせ、配信停止、不具合報告はこちらからお送りください。",
    path: "/contact",
    content: `
    <h1>お問い合わせ</h1>
    <p>
      stock-ai へのご質問、配信停止・データ削除のご依頼、不具合報告はこちらのフォームからお送りください。
      ご返信は入力いただいたメールアドレス宛に行います。
    </p>
    ${errorMessage ? `<div class="notice">${htmlEscape(errorMessage)}</div>` : ""}
    <form method="post" action="/api/contact" class="contact-form">
      <label>
        <span>メールアドレス (返信先)</span>
        <input type="email" name="email" required placeholder="you@example.com" autocomplete="email" maxlength="254" />
      </label>
      <label>
        <span>種別</span>
        <select name="category" required>
          ${CONTACT_CATEGORIES.map(
            (c) => `<option value="${htmlEscape(c.value)}">${htmlEscape(c.label)}</option>`,
          ).join("")}
        </select>
      </label>
      <label>
        <span>内容</span>
        <textarea name="message" required rows="6" maxlength="4000" placeholder="お問い合わせ内容をご記入ください"></textarea>
      </label>
      <div class="hp" aria-hidden="true">
        <label>Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
      </div>
      <button type="submit">送信</button>
      <p class="form-note">
        送信いただいた内容とメールアドレスは返信目的でのみ使用し、第三者に提供することはありません。
        詳細は <a href="/privacy">プライバシーポリシー</a> をご覧ください。
      </p>
    </form>

    <style>
      .contact-form { display: grid; gap: 0.9rem; max-width: 540px; }
      .contact-form label { display: block; }
      .contact-form label > span { display: block; font-size: 0.85rem; color: #475569; margin-bottom: 0.25rem; }
      .contact-form input[type="email"], .contact-form select, .contact-form textarea {
        width: 100%; padding: 0.55rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 1rem; box-sizing: border-box; font-family: inherit;
      }
      .contact-form textarea { resize: vertical; min-height: 140px; }
      .contact-form button { padding: 0.55rem 1.25rem; background: #0f172a; color: #fff; border: none; border-radius: 6px; font-size: 0.95rem; cursor: pointer; width: fit-content; }
      .contact-form button:hover { background: #334155; }
      .contact-form .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
      .form-note { font-size: 0.78rem; color: #64748b; margin: 0.25rem 0 0; }
    </style>
`,
  });

export const renderContactThanks = (): string =>
  renderLayout({
    title: "お問い合わせありがとうございます — stock-ai",
    description: "お問い合わせを受け付けました。",
    path: "/contact/thanks",
    content: `
    <h1>お問い合わせを受け付けました</h1>
    <p>内容を確認のうえ、ご入力いただいたメールアドレス宛にご返信いたします。少々お時間をいただく場合があります。</p>
    <p><a href="/">トップへ戻る</a></p>
`,
  });

export type ContactsAdminRow = {
  id: number;
  email: string;
  category: string;
  message: string;
  addedAt: number;
  repliedAt: number | null;
};

export const renderContactsAdmin = (
  counts: { total: number; unreplied: number },
  rows: ContactsAdminRow[],
): string => {
  const fmtTs = (t: number): string => {
    const d = new Date(t * 1000);
    const jst = new Date(d.getTime() + 9 * 3600 * 1000);
    return (
      jst.getUTCFullYear() +
      "-" +
      String(jst.getUTCMonth() + 1).padStart(2, "0") +
      "-" +
      String(jst.getUTCDate()).padStart(2, "0") +
      " " +
      String(jst.getUTCHours()).padStart(2, "0") +
      ":" +
      String(jst.getUTCMinutes()).padStart(2, "0")
    );
  };

  const items = rows
    .map(
      (r) => `
      <article class="contact-row">
        <header>
          <span class="meta">#${r.id} · ${htmlEscape(r.category)} · ${htmlEscape(fmtTs(r.addedAt))}</span>
          <span class="meta ${r.repliedAt ? "replied" : "unreplied"}">${r.repliedAt ? `返信済 ${htmlEscape(fmtTs(r.repliedAt))}` : "未返信"}</span>
          <form method="post" action="/admin/contacts/${r.id}/delete" onsubmit="return confirm('この問い合わせを削除しますか?');" style="margin:0;">
            <button class="btn-del">削除</button>
          </form>
        </header>
        <p class="email"><a href="mailto:${htmlEscape(r.email)}">${htmlEscape(r.email)}</a></p>
        <pre class="message">${htmlEscape(r.message)}</pre>
      </article>`,
    )
    .join("");

  return renderLayout({
    title: "問い合わせ管理 — stock-ai",
    description: "contacts admin",
    path: "/admin/contacts",
    content: `
    <h1>問い合わせ管理</h1>
    <section class="counts">
      <dl>
        <dt>合計</dt><dd>${counts.total}</dd>
        <dt>未返信</dt><dd>${counts.unreplied}</dd>
      </dl>
    </section>
    <section class="list">
      ${items || `<p style="color:#94a3b8;">問い合わせはまだありません。</p>`}
    </section>
    <style>
      .counts dl { display: grid; grid-template-columns: auto auto; gap: 0.3rem 1rem; font-size: 0.9rem; margin: 0 0 1rem; }
      .counts dt { color: #64748b; }
      .counts dd { margin: 0; font-weight: 600; }
      .contact-row { border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; background: #fff; }
      .contact-row header { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem; }
      .contact-row .meta { font-size: 0.78rem; color: #64748b; font-family: ui-monospace, monospace; }
      .contact-row .meta.unreplied { color: #b91c1c; font-weight: 600; }
      .contact-row .meta.replied { color: #047857; }
      .contact-row .email { margin: 0.25rem 0; font-size: 0.9rem; }
      .contact-row .message { background: #f8fafc; padding: 0.5rem 0.75rem; border-radius: 4px; font-family: inherit; white-space: pre-wrap; margin: 0.4rem 0 0; font-size: 0.9rem; }
      .btn-del { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; border-radius: 4px; padding: 0.2rem 0.5rem; font-size: 0.75rem; cursor: pointer; }
      .btn-del:hover { background: #fecaca; }
    </style>
`,
  });
};

export const renderWaitlistThanks = (status: "added" | "already"): string =>
  renderLayout({
    title: "待ちリスト登録ありがとうございます — stock-ai",
    description: "待ちリストにご登録いただきありがとうございます。",
    path: "/waitlist/thanks",
    content: `
    <h1>登録を受け付けました</h1>
    ${
      status === "added"
        ? `<p>待ちリストへのご登録ありがとうございます。配信が始まる前に、確認メールをお送りします。</p>`
        : `<p>このメールアドレスはすでに登録されています。重ねての登録は行っていません。</p>`
    }
    <p><strong>配信開始時期は未定です。</strong> 準備が整い次第、ご登録のアドレスに確認メールをお送りします。</p>
    <p><a href="/">トップへ戻る</a></p>
`,
  });

export const renderWaitlistError = (message: string): string =>
  renderLayout({
    title: "登録エラー — stock-ai",
    description: "待ちリスト登録でエラーが発生しました。",
    path: "/waitlist/error",
    content: `
    <h1>登録できませんでした</h1>
    <p>${htmlEscape(message)}</p>
    <p><a href="/#waitlist">フォームに戻る</a></p>
`,
  });

export type WaitlistAdminRow = {
  id: number;
  email: string;
  category: string;
  addedAt: number;
  confirmedAt: number | null;
  unsubscribedAt: number | null;
};

export const renderWaitlistAdmin = (
  counts: { total: number; fx: number; stocks: number; both: number; confirmed: number; unsubscribed: number },
  rows: WaitlistAdminRow[],
): string => {
  const fmtTs = (t: number): string => {
    const d = new Date(t * 1000);
    const jst = new Date(d.getTime() + 9 * 3600 * 1000);
    return (
      jst.getUTCFullYear() +
      "-" +
      String(jst.getUTCMonth() + 1).padStart(2, "0") +
      "-" +
      String(jst.getUTCDate()).padStart(2, "0") +
      " " +
      String(jst.getUTCHours()).padStart(2, "0") +
      ":" +
      String(jst.getUTCMinutes()).padStart(2, "0")
    );
  };

  const items = rows
    .map(
      (r) => `
      <tr>
        <td>${r.id}</td>
        <td>${htmlEscape(r.email)}</td>
        <td>${htmlEscape(r.category)}</td>
        <td>${htmlEscape(fmtTs(r.addedAt))}</td>
        <td>${r.confirmedAt ? htmlEscape(fmtTs(r.confirmedAt)) : "—"}</td>
        <td>${r.unsubscribedAt ? htmlEscape(fmtTs(r.unsubscribedAt)) : "—"}</td>
        <td><form method="post" action="/admin/waitlist/${r.id}/delete" onsubmit="return confirm('${htmlEscape(r.email)} を削除しますか?');"><button class="btn-del">削除</button></form></td>
      </tr>`,
    )
    .join("");

  return renderLayout({
    title: "待ちリスト管理 — stock-ai",
    description: "waitlist admin",
    path: "/admin/waitlist",
    content: `
    <h1>待ちリスト管理</h1>
    <section class="counts">
      <h2>件数</h2>
      <dl>
        <dt>合計</dt><dd>${counts.total}</dd>
        <dt>FX のみ</dt><dd>${counts.fx}</dd>
        <dt>株のみ</dt><dd>${counts.stocks}</dd>
        <dt>両方</dt><dd>${counts.both}</dd>
        <dt>確認済み</dt><dd>${counts.confirmed}</dd>
        <dt>配信停止</dt><dd>${counts.unsubscribed}</dd>
      </dl>
      <p class="hint">目安: 100件を超えたら Resend Pro ($20/月) 検討。それまでは送信コスト不要。</p>
    </section>
    <section class="recent">
      <h2>直近の登録 (最新 100 件)</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Email</th><th>Category</th><th>登録 (JST)</th><th>確認済み</th><th>解除</th><th></th>
          </tr>
        </thead>
        <tbody>${items || `<tr><td colspan="7" style="text-align:center;color:#94a3b8;">登録なし</td></tr>`}</tbody>
      </table>
    </section>
    <style>
      .counts dl { display: grid; grid-template-columns: auto auto; gap: 0.3rem 1rem; font-size: 0.9rem; }
      .counts dt { color: #64748b; }
      .counts dd { margin: 0; font-weight: 600; }
      .counts .hint { color: #64748b; font-size: 0.8rem; margin-top: 0.75rem; }
      table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 0.5rem; }
      th, td { padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-align: left; }
      th { background: #f8fafc; color: #475569; font-size: 0.78rem; }
      .btn-del { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; border-radius: 4px; padding: 0.2rem 0.5rem; font-size: 0.75rem; cursor: pointer; }
      .btn-del:hover { background: #fecaca; }
    </style>
`,
  });
};

export const renderPrivacy = (): string =>
  renderLayout({
    title: "プライバシーポリシー — stock-ai",
    description: "stock-ai のプライバシーポリシー。収集するのはメール配信希望者のメールアドレスのみで、第三者提供は行いません。",
    path: "/privacy",
    content: `
    <h1>プライバシーポリシー</h1>

    <h2>1. 収集する情報</h2>
    <ul>
      <li><strong>メール配信希望者のメールアドレス</strong>: FX 検証ログの配信をご希望いただいた方のメールアドレスのみを保管します。</li>
      <li>サーバログ (IP アドレス、ユーザーエージェント等): Cloudflare のインフラ標準ログに準じて記録されます。</li>
    </ul>

    <h2>2. 利用目的</h2>
    <ul>
      <li>FX 検証ログメールの配信</li>
      <li>サイト運営・不正アクセス対策</li>
    </ul>

    <h2>3. 保管場所</h2>
    <p>メールアドレスは Cloudflare D1 (Workers のデータベース) に保管し、メール送信には <a href="https://resend.com/" rel="noopener">Resend</a> を利用します。両者ともに業界標準のセキュリティ対策を講じています。</p>

    <h2>4. 第三者提供</h2>
    <p>法令に基づく場合を除き、第三者にメールアドレスを提供することはありません。</p>

    <h2>5. 配信停止・削除</h2>
    <p>配信停止・データ削除をご希望の方は、<a href="/contact">お問い合わせフォーム</a> からご連絡ください。速やかに対応します。</p>

    <h2>6. Cookie</h2>
    <p>オーナーのログイン状態を保持するためだけに、HttpOnly / Secure / SameSite=Strict の Cookie を 1 つ利用します。アクセス解析用の Cookie やサードパーティ Cookie は使用していません。</p>

    <h2>7. 変更について</h2>
    <p>本ポリシーは予告なく変更されることがあります。重要な変更はサイト上で告知します。</p>
`,
  });
