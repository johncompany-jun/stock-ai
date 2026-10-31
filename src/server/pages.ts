import { renderLayout } from "./html";

const SUPPORT_MAIL = "johncompany2000jp@gmail.com";

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
    <p>AI を用いた日本株および FX の相場予測モデルの精度を、過去データと仮想運用の形で記録・公開することが目的です。将来的には有料 SaaS 化を視野に入れていますが、現在は無料で公開しています。</p>

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

    <h2>メール配信について</h2>
    <p>FX の日次検証ログは、ご希望の方にメールでお送りしています (平日朝 9:05 JST 配信, Resend 利用)。</p>
    <ul>
      <li>登録: <a href="mailto:${SUPPORT_MAIL}?subject=stock-ai%20FX%E9%85%8D%E4%BF%A1%E7%99%BB%E9%8C%B2">${SUPPORT_MAIL}</a> まで、件名「stock-ai FX配信登録」で送信ください。</li>
      <li>解除: 配信メールへの返信で「配信停止」とお送りください。</li>
    </ul>
    <p>メールアドレスは配信以外の目的で使用せず、第三者に提供することもありません。詳細は <a href="/privacy">プライバシーポリシー</a> をご覧ください。</p>
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
    <p>配信停止・データ削除をご希望の方は、配信メールへの返信または <a href="mailto:${SUPPORT_MAIL}">${SUPPORT_MAIL}</a> までご連絡ください。速やかに対応します。</p>

    <h2>6. Cookie</h2>
    <p>オーナーのログイン状態を保持するためだけに、HttpOnly / Secure / SameSite=Strict の Cookie を 1 つ利用します。アクセス解析用の Cookie やサードパーティ Cookie は使用していません。</p>

    <h2>7. 変更について</h2>
    <p>本ポリシーは予告なく変更されることがあります。重要な変更はサイト上で告知します。</p>
`,
  });
