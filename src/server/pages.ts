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

const dirJa = (d: string | null): string =>
  d === "LONG" ? "買い (LONG)" : d === "SHORT" ? "売り (SHORT)" : "—";

const dirClass = (d: string | null): string =>
  d === "LONG" ? "long" : d === "SHORT" ? "short" : "";

const renderStocksCard = (s: HomeSnapshot["stocks"]): string => {
  if (!s.latestDate) {
    return `<p class="text-sm text-[color:var(--color-muted)]">株の検証データはまだ記録されていません。</p>`;
  }
  const wr = s.wr30d != null ? `${s.wr30d.toFixed(1)}%` : "—";
  const avg = s.avg30d != null ? `${s.avg30d >= 0 ? "+" : ""}${s.avg30d.toFixed(2)}%` : "—";
  const avgCls = s.avg30d != null && s.avg30d >= 0 ? "pos" : s.avg30d != null && s.avg30d < 0 ? "neg" : "";
  return `
    <div class="stat-grid">
      <div class="stat">
        <span class="label">最新日</span>
        <span class="value sm">${htmlEscape(formatYmd(s.latestDate))}</span>
      </div>
      <div class="stat">
        <span class="label">当日ピック数</span>
        <span class="value">${s.todayCount}<span class="sub"> 件</span></span>
      </div>
      <div class="stat">
        <span class="label">過去 30 日勝率</span>
        <span class="value">${wr}</span>
        <span class="sub">n = ${s.sampleN}</span>
      </div>
      <div class="stat">
        <span class="label">平均リターン</span>
        <span class="value ${avgCls}">${avg}</span>
      </div>
    </div>`;
};

const renderFxCard = (f: HomeSnapshot["fx"]): string => {
  if (!f.latestDate) {
    return `<p class="text-sm text-[color:var(--color-muted)]">FX の検証データはまだ記録されていません。</p>`;
  }
  const prob = f.probability != null ? `${(f.probability * 100).toFixed(1)}%` : "—";
  const conf = f.confidence != null ? f.confidence.toFixed(2) : "—";
  const pnl =
    f.pnlPips != null
      ? `${f.pnlPips >= 0 ? "+" : ""}${f.pnlPips.toFixed(1)} pips`
      : "判定前";
  const pnlCls = f.pnlPips != null && f.pnlPips >= 0 ? "pos" : f.pnlPips != null && f.pnlPips < 0 ? "neg" : "";
  return `
    <div class="stat-grid">
      <div class="stat">
        <span class="label">最新日</span>
        <span class="value sm">${htmlEscape(f.latestDate)}</span>
      </div>
      <div class="stat">
        <span class="label">方向</span>
        <span class="value sm"><span class="badge ${dirClass(f.direction)}">${htmlEscape(dirJa(f.direction))}</span></span>
      </div>
      <div class="stat">
        <span class="label">確率</span>
        <span class="value">${prob}</span>
        <span class="sub">信頼度 ${conf}</span>
      </div>
      <div class="stat">
        <span class="label">結果</span>
        <span class="value ${pnlCls}">${pnl}</span>
      </div>
    </div>`;
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
          ${p.description ? `<p class="post-desc">${htmlEscape(p.description)}</p>` : ""}
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
      <h1>AI の答え合わせを、<br />毎日公開しています。</h1>
      <p class="lead">
        日本株とFX (USDJPY) の値動きを機械学習モデルで予測し、
        仮想 50 万円で勝率と平均リターンを日次で検証・公開しているサイトです。
      </p>
      <div class="notice">本サイトは過去データにもとづく検証記録であり、売買を勧めるものではありません。</div>
    </section>

    <section class="section">
      <h2>今日の検証スナップショット</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="card">
          <h3 class="text-[0.95rem] font-semibold mb-3">日本株 (レンジサイクル)</h3>
          ${renderStocksCard(snapshot.stocks)}
          <p class="mt-3 text-sm"><a href="/stocks/">株の検証ログを見る →</a></p>
        </div>
        <div class="card">
          <h3 class="text-[0.95rem] font-semibold mb-3">FX USDJPY (寄付方向)</h3>
          ${renderFxCard(snapshot.fx)}
          <p class="mt-3 text-sm"><a href="/fx/">FX の検証ログを見る →</a></p>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>このサイトの使い方</h2>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <a href="/stocks/" class="card">
          <div class="text-xs text-[color:var(--color-muted)] font-semibold mb-1">1</div>
          <div class="font-semibold mb-1">株の検証ログ</div>
          <p class="text-sm text-[color:var(--color-muted)] m-0">レンジ安値で検出した銘柄のバックテスト勝率と、月別の季節性を公開しています。</p>
        </a>
        <a href="/fx/" class="card">
          <div class="text-xs text-[color:var(--color-muted)] font-semibold mb-1">2</div>
          <div class="font-semibold mb-1">FX の検証ログ</div>
          <p class="text-sm text-[color:var(--color-muted)] m-0">寄付方向の予測と、kNN が返した過去類似日の勝敗を日次で記録しています。</p>
        </a>
        <a href="/blog/" class="card">
          <div class="text-xs text-[color:var(--color-muted)] font-semibold mb-1">3</div>
          <div class="font-semibold mb-1">ブログを読む</div>
          <p class="text-sm text-[color:var(--color-muted)] m-0">月次レポートと、モデル改善の開発記録を更新しています。</p>
        </a>
        <a href="#waitlist" class="card">
          <div class="text-xs text-[color:var(--color-muted)] font-semibold mb-1">4</div>
          <div class="font-semibold mb-1">配信を受け取る</div>
          <p class="text-sm text-[color:var(--color-muted)] m-0">待ちリストにご登録いただくと、配信開始時に確認メールをお送りします。</p>
        </a>
      </div>
    </section>

    ${
      posts.length > 0
        ? `
    <section class="section">
      <h2>最新のブログ</h2>
      <ul class="post-list">${postItems}</ul>
      <p class="mt-3 text-sm"><a href="/blog/">ブログ一覧へ →</a></p>
    </section>`
        : ""
    }

    <section class="section" id="start">
      <h2>このサイトの検証を自分でも試したい方へ</h2>
      <p class="text-sm mb-4">
        掲載している株・FX の戦略を自分でも試すには、国内の証券口座 (株) か FX 口座が必要です。
        目的別に 3 本のガイド記事を用意しているので、まずはこちらから。
      </p>
      <div class="grid gap-3 sm:grid-cols-3">
        <a href="/blog/stock-broker-comparison-100k" class="card">
          <div class="text-xs text-[color:var(--color-brand-strong)] font-semibold mb-1">株 (通常口座)</div>
          <div class="font-semibold mb-1">10 万円で始める日本株</div>
          <p class="text-sm text-[color:var(--color-muted)] m-0">レンジサイクル実践用に、ネット証券 4 社を手数料・ツール・NISA 対応で比較。</p>
        </a>
        <a href="/blog/nisa-broker-selection" class="card">
          <div class="text-xs text-[color:var(--color-brand-strong)] font-semibold mb-1">株 (NISA)</div>
          <div class="font-semibold mb-1">NISA で非課税で始めたい方</div>
          <p class="text-sm text-[color:var(--color-muted)] m-0">年間 240 万円の成長投資枠で、売却益がまるごと非課税になる使い方。</p>
        </a>
        <a href="/blog/fx-broker-small-lot" class="card">
          <div class="text-xs text-[color:var(--color-brand-strong)] font-semibold mb-1">FX</div>
          <div class="font-semibold mb-1">1,000 通貨から始める FX</div>
          <p class="text-sm text-[color:var(--color-muted)] m-0">月数百円の動きから練習できる、少額対応の FX 口座をまとめました。</p>
        </a>
      </div>
      <p class="mt-3 text-xs text-[color:var(--color-muted)]">
        口座開設はまだ先、という方は、下記の待ちリストにご登録いただくと配信開始時にお知らせします。
      </p>
    </section>

    <section class="section" id="waitlist">
      <h2>検証ログの配信を受け取る (待ちリスト)</h2>
      <div class="card-soft">
        <p class="text-sm mb-4">
          FX 日次ログと株の月次レポートの配信を予定しています。
          配信が始まる前に、確認メールをお送りします。
          確認ボタンを押していただいた方にのみ本配信を行います。
          <strong>配信開始時期は未定です。</strong>
        </p>
        <form method="post" action="/api/waitlist" class="form-block">
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
          <button type="submit" class="btn">待ちリストに登録</button>
          <p class="form-note">
            メールアドレスは配信目的以外には使用せず、第三者に提供することもありません。
            詳しくは <a href="/privacy">プライバシーポリシー</a> をご覧ください。
          </p>
        </form>
      </div>
    </section>

    <section class="section">
      <h2>このサイトについて</h2>
      <p class="text-sm">
        個人開発者 <a href="https://x.com/jun2000jp" rel="me noopener">@jun2000jp</a> が
        build in public で開発しています。詳しくは <a href="/about">このサイトについて</a> と
        <a href="/disclaimer">免責事項</a> をご覧ください。
      </p>
    </section>
`,
  });
};

export const renderAbout = (): string =>
  renderLayout({
    title: "このサイトについて — stock-ai",
    description:
      "stock-ai は AI による相場予測の検証記録を公開する個人サイトです。仮想50万円での検証で、売買を勧めるものではありません。",
    path: "/about",
    content: `
    <section class="hero">
      <h1>このサイトについて</h1>
      <div class="notice">本サイトは仮想50万円での検証です。実売買の推奨ではありません。</div>
    </section>

    <section class="section">
      <h2>運営</h2>
      <p>個人開発者 <a href="https://x.com/jun2000jp" rel="me noopener">@jun2000jp</a> が運営する個人サイトです。build in public で開発過程を X に投稿しています。</p>
    </section>

    <section class="section">
      <h2>目的</h2>
      <p>AI を用いた日本株および FX の相場予測モデルの精度を、過去データと仮想運用の形で記録・公開することが目的です。</p>
    </section>

    <section class="section">
      <h2>検証の内容</h2>
      <ul class="list-disc pl-5 space-y-1">
        <li><strong>株</strong>: レンジサイクル戦略 (3M安値で種まき/3M高値で収穫) に合致した銘柄を日次でピック。仮想50万円での検証ポートフォリオを公開。</li>
        <li><strong>FX</strong>: USDJPY の寄付方向を 5-seed MLP アンサンブル + kNN で予測。TP+25 / SL-20 pips (symmetric R:R) で検証。</li>
      </ul>
    </section>

    <section class="section">
      <h2>データの出典</h2>
      <ul class="list-disc pl-5 space-y-1">
        <li>日本株日足: <a href="https://finance.yahoo.co.jp/" rel="noopener">Yahoo! Finance Japan</a> (yahoo-finance2 経由で取得)</li>
        <li>USDJPY 分足: <a href="https://www.dukascopy.com/" rel="noopener">Dukascopy</a></li>
      </ul>
    </section>

    <section class="section">
      <h2>モデル概要</h2>
      <ul class="list-disc pl-5 space-y-1">
        <li>株 LSTM 5日先リターン予測 + パターンマッチ (レンジ安値/高値+SMA200方向一致)</li>
        <li>FX 5-seed MLP アンサンブル + kNN による類似日検索</li>
        <li>バックテストで勝率と平均リターンを提示</li>
      </ul>
    </section>

    <section class="section">
      <h2>配信希望の受付 (待ちリスト)</h2>
      <p>月次レポートや FX 日次ログの配信を予定しています。待ちリストにご登録いただいた方には、配信が始まる前に確認メールをお送りします。確認ボタンを押していただいた方にのみ本配信を行います。</p>
      <p class="mt-2"><a href="/#waitlist" class="btn btn-outline">トップページの登録フォームへ</a></p>
      <p class="mt-4 text-sm">
        配信停止・データ削除のご依頼、そのほかのご連絡は <a href="/contact">お問い合わせフォーム</a> からお送りください。
        メールアドレスは配信以外の目的で使用せず、第三者に提供することもありません。
        詳細は <a href="/privacy">プライバシーポリシー</a> をご覧ください。
      </p>
    </section>
`,
  });

export const renderDisclaimer = (): string =>
  renderLayout({
    title: "免責事項 — stock-ai",
    description:
      "stock-ai の免責事項。本サイトは過去データにもとづく分析結果の共有であり、売買を勧めるものではありません。",
    path: "/disclaimer",
    content: `
    <section class="hero">
      <h1>免責事項</h1>
      <div class="notice">本サイトは過去データにもとづく分析結果の共有であり、売買を勧めるものではありません。投資判断はご自身の責任でお願いします。</div>
    </section>

    <section class="section">
      <h2>1. 情報の性質</h2>
      <p>本サイトおよびメール配信で提供される情報は、過去の相場データと機械学習モデルによる分析結果の共有を目的としています。<strong>特定の金融商品の売買を推奨するもの、投資助言を行うものではありません。</strong></p>
    </section>

    <section class="section">
      <h2>2. 投資助言業ではないこと</h2>
      <p>運営者は金融商品取引業の登録を受けていません。本サイトは一切の投資助言サービスを提供しません。</p>
    </section>

    <section class="section">
      <h2>3. 検証について</h2>
      <p>サイト内の「ポートフォリオ」および「FX」に表示される損益・成績は、すべて<strong>仮想50万円を使った検証</strong>によるものであり、実際の売買を行った結果ではありません。</p>
    </section>

    <section class="section">
      <h2>4. 情報の正確性・完全性</h2>
      <p>情報の正確性・完全性・有用性について、運営者は一切の保証を行いません。元データ提供元の仕様変更やバグ、通信障害等により情報が欠落・遅延することがあります。</p>
    </section>

    <section class="section">
      <h2>5. 損害の免責</h2>
      <p>本サイトおよびメール配信の情報を利用したこと、または利用できなかったことに起因するいかなる損害についても、運営者は責任を負いません。</p>
    </section>

    <section class="section">
      <h2>6. 変更について</h2>
      <p>本免責事項は予告なく変更されることがあります。</p>
    </section>
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
    <section class="hero">
      <h1>お問い合わせ</h1>
      <p class="lead">
        stock-ai へのご質問、配信停止・データ削除のご依頼、不具合報告はこちらのフォームからお送りください。
        ご返信は入力いただいたメールアドレス宛に行います。
      </p>
    </section>

    ${errorMessage ? `<div class="notice-strip">${htmlEscape(errorMessage)}</div>` : ""}

    <section class="section">
      <div class="card-soft">
        <form method="post" action="/api/contact" class="form-block">
          <label>
            <span>メールアドレス (返信先)</span>
            <input type="email" name="email" required placeholder="you@example.com" autocomplete="email" maxlength="254" />
          </label>
          <label>
            <span>種別</span>
            <select name="category" required>
              ${CONTACT_CATEGORIES.map(
                (c) =>
                  `<option value="${htmlEscape(c.value)}">${htmlEscape(c.label)}</option>`,
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
          <button type="submit" class="btn">送信</button>
          <p class="form-note">
            送信いただいた内容とメールアドレスは返信目的でのみ使用し、第三者に提供することはありません。
            詳細は <a href="/privacy">プライバシーポリシー</a> をご覧ください。
          </p>
        </form>
      </div>
    </section>
`,
  });

export const renderContactThanks = (): string =>
  renderLayout({
    title: "お問い合わせありがとうございます — stock-ai",
    description: "お問い合わせを受け付けました。",
    path: "/contact/thanks",
    content: `
    <section class="hero">
      <h1>お問い合わせを受け付けました</h1>
      <p class="lead">内容を確認のうえ、ご入力いただいたメールアドレス宛にご返信いたします。少々お時間をいただく場合があります。</p>
    </section>
    <p><a href="/" class="btn btn-outline">トップへ戻る</a></p>
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

const fmtTsJst = (t: number): string => {
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

export const renderContactsAdmin = (
  counts: { total: number; unreplied: number },
  rows: ContactsAdminRow[],
): string => {
  const items = rows
    .map(
      (r) => `
      <article class="card mb-3">
        <header class="flex justify-between flex-wrap gap-2 mb-2">
          <span class="text-xs text-[color:var(--color-muted)] font-mono">#${r.id} · ${htmlEscape(r.category)} · ${htmlEscape(fmtTsJst(r.addedAt))}</span>
          <div class="flex items-center gap-3">
            <span class="badge ${r.repliedAt ? "win" : "loss"}">${r.repliedAt ? `返信済 ${htmlEscape(fmtTsJst(r.repliedAt))}` : "未返信"}</span>
            <form method="post" action="/admin/contacts/${r.id}/delete" onsubmit="return confirm('この問い合わせを削除しますか?');" style="margin:0;">
              <button class="btn-del">削除</button>
            </form>
          </div>
        </header>
        <p class="text-sm m-0 mb-2"><a href="mailto:${htmlEscape(r.email)}">${htmlEscape(r.email)}</a></p>
        <pre class="whitespace-pre-wrap font-sans text-sm bg-[color:var(--color-surface-soft)] p-3 rounded m-0">${htmlEscape(r.message)}</pre>
      </article>`,
    )
    .join("");

  return renderLayout({
    title: "問い合わせ管理 — stock-ai",
    description: "contacts admin",
    path: "/admin/contacts",
    content: `
    <section class="hero">
      <h1>問い合わせ管理</h1>
    </section>
    <section class="section">
      <div class="stat-grid mb-4">
        <div class="stat"><span class="label">合計</span><span class="value">${counts.total}</span></div>
        <div class="stat"><span class="label">未返信</span><span class="value ${counts.unreplied > 0 ? "neg" : ""}">${counts.unreplied}</span></div>
      </div>
      ${items || `<p class="text-[color:var(--color-muted-soft)]">問い合わせはまだありません。</p>`}
    </section>
`,
  });
};

export const renderWaitlistThanks = (status: "added" | "already"): string =>
  renderLayout({
    title: "待ちリスト登録ありがとうございます — stock-ai",
    description: "待ちリストにご登録いただきありがとうございます。",
    path: "/waitlist/thanks",
    content: `
    <section class="hero">
      <h1>登録を受け付けました</h1>
      ${
        status === "added"
          ? `<p class="lead">待ちリストへのご登録ありがとうございます。配信が始まる前に、確認メールをお送りします。</p>`
          : `<p class="lead">このメールアドレスはすでに登録されています。重ねての登録は行っていません。</p>`
      }
      <p class="text-sm text-[color:var(--color-muted)] mt-2"><strong>配信開始時期は未定です。</strong> 準備が整い次第、ご登録のアドレスに確認メールをお送りします。</p>
    </section>
    <p><a href="/" class="btn btn-outline">トップへ戻る</a></p>
`,
  });

export const renderWaitlistError = (message: string): string =>
  renderLayout({
    title: "登録エラー — stock-ai",
    description: "待ちリスト登録でエラーが発生しました。",
    path: "/waitlist/error",
    content: `
    <section class="hero">
      <h1>登録できませんでした</h1>
      <p class="lead">${htmlEscape(message)}</p>
    </section>
    <p><a href="/#waitlist" class="btn btn-outline">フォームに戻る</a></p>
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
  counts: {
    total: number;
    fx: number;
    stocks: number;
    both: number;
    confirmed: number;
    unsubscribed: number;
  },
  rows: WaitlistAdminRow[],
): string => {
  const items = rows
    .map(
      (r) => `
      <tr>
        <td class="p-2">${r.id}</td>
        <td class="p-2">${htmlEscape(r.email)}</td>
        <td class="p-2">${htmlEscape(r.category)}</td>
        <td class="p-2 font-mono text-xs">${htmlEscape(fmtTsJst(r.addedAt))}</td>
        <td class="p-2 font-mono text-xs">${r.confirmedAt ? htmlEscape(fmtTsJst(r.confirmedAt)) : "—"}</td>
        <td class="p-2 font-mono text-xs">${r.unsubscribedAt ? htmlEscape(fmtTsJst(r.unsubscribedAt)) : "—"}</td>
        <td class="p-2"><form method="post" action="/admin/waitlist/${r.id}/delete" onsubmit="return confirm('${htmlEscape(r.email)} を削除しますか?');"><button class="btn-del">削除</button></form></td>
      </tr>`,
    )
    .join("");

  return renderLayout({
    title: "待ちリスト管理 — stock-ai",
    description: "waitlist admin",
    path: "/admin/waitlist",
    content: `
    <section class="hero">
      <h1>待ちリスト管理</h1>
    </section>
    <section class="section">
      <div class="stat-grid mb-4">
        <div class="stat"><span class="label">合計</span><span class="value">${counts.total}</span></div>
        <div class="stat"><span class="label">確認済み</span><span class="value">${counts.confirmed}</span></div>
        <div class="stat"><span class="label">FX のみ</span><span class="value sm">${counts.fx}</span></div>
        <div class="stat"><span class="label">株のみ</span><span class="value sm">${counts.stocks}</span></div>
        <div class="stat"><span class="label">両方</span><span class="value sm">${counts.both}</span></div>
        <div class="stat"><span class="label">配信停止</span><span class="value sm">${counts.unsubscribed}</span></div>
      </div>
      <p class="text-xs text-[color:var(--color-muted)] mb-3">目安: 100件を超えたら Resend Pro ($20/月) 検討。それまでは送信コスト不要。</p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr class="bg-[color:var(--color-surface-soft)] text-[color:var(--color-muted)] text-xs">
              <th class="p-2 text-left">ID</th>
              <th class="p-2 text-left">Email</th>
              <th class="p-2 text-left">Category</th>
              <th class="p-2 text-left">登録 (JST)</th>
              <th class="p-2 text-left">確認済み</th>
              <th class="p-2 text-left">解除</th>
              <th class="p-2"></th>
            </tr>
          </thead>
          <tbody>${items || `<tr><td colspan="7" class="text-center text-[color:var(--color-muted-soft)] p-4">登録なし</td></tr>`}</tbody>
        </table>
      </div>
    </section>
`,
  });
};

export const renderPrivacy = (): string =>
  renderLayout({
    title: "プライバシーポリシー — stock-ai",
    description:
      "stock-ai のプライバシーポリシー。収集するのはメール配信希望者のメールアドレスのみで、第三者提供は行いません。",
    path: "/privacy",
    content: `
    <section class="hero">
      <h1>プライバシーポリシー</h1>
    </section>

    <section class="section">
      <h2>1. 収集する情報</h2>
      <ul class="list-disc pl-5 space-y-1">
        <li><strong>メール配信希望者のメールアドレス</strong>: FX 検証ログの配信をご希望いただいた方のメールアドレスのみを保管します。</li>
        <li>サーバログ (IP アドレス、ユーザーエージェント等): Cloudflare のインフラ標準ログに準じて記録されます。</li>
      </ul>
    </section>

    <section class="section">
      <h2>2. 利用目的</h2>
      <ul class="list-disc pl-5 space-y-1">
        <li>FX 検証ログメールの配信</li>
        <li>サイト運営・不正アクセス対策</li>
      </ul>
    </section>

    <section class="section">
      <h2>3. 保管場所</h2>
      <p>メールアドレスは Cloudflare D1 (Workers のデータベース) に保管し、メール送信には <a href="https://resend.com/" rel="noopener">Resend</a> を利用します。両者ともに業界標準のセキュリティ対策を講じています。</p>
    </section>

    <section class="section">
      <h2>4. 第三者提供</h2>
      <p>法令に基づく場合を除き、第三者にメールアドレスを提供することはありません。</p>
    </section>

    <section class="section">
      <h2>5. 配信停止・削除</h2>
      <p>配信停止・データ削除をご希望の方は、<a href="/contact">お問い合わせフォーム</a> からご連絡ください。速やかに対応します。</p>
    </section>

    <section class="section">
      <h2>6. Cookie</h2>
      <p>オーナーのログイン状態を保持するためだけに、HttpOnly / Secure / SameSite=Strict の Cookie を 1 つ利用します。アクセス解析用の Cookie やサードパーティ Cookie は使用していません。</p>
    </section>

    <section class="section">
      <h2>7. 変更について</h2>
      <p>本ポリシーは予告なく変更されることがあります。重要な変更はサイト上で告知します。</p>
    </section>
`,
  });
