const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export type LayoutOpts = {
  title: string;
  description: string;
  path: string;
  content: string;
  ogType?: "website" | "article";
};

const SITE_URL = "https://stock-ai.uk";
const SITE_NAME = "stock-ai";

export const renderLayout = (o: LayoutOpts): string => {
  const url = `${SITE_URL}${o.path}`;
  const ogType = o.ogType ?? "website";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(o.title)}</title>
  <meta name="description" content="${esc(o.description)}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:title" content="${esc(o.title)}" />
  <meta property="og:description" content="${esc(o.description)}" />
  <meta property="og:url" content="${url}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(o.title)}" />
  <meta name="twitter:description" content="${esc(o.description)}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Noto+Serif+JP:wght@600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="site-wrap">
    <header class="site-header">
      <a href="/" class="site-logo"><img src="/logo.svg" alt="" width="26" height="26" />${SITE_NAME}</a>
      <nav class="site-nav">
        <a href="/stocks/">株</a>
        <a href="/picks/">推し実績</a>
        <a href="/fx/">FX</a>
        <a href="/blog/">ブログ</a>
        <a href="/about">このサイト</a>
      </nav>
    </header>
    <main>
${o.content}
    </main>
    <footer class="site-footer">
      <p>過去データにもとづく分析結果の共有であり、売買を勧めるものではありません。投資判断はご自身の責任でお願いします。</p>
      <nav>
        <a href="/about">このサイトについて</a>
        <a href="/disclaimer">免責事項</a>
        <a href="/privacy">プライバシーポリシー</a>
        <a href="/blog/">ブログ</a>
        <a href="/contact">お問い合わせ</a>
      </nav>
      <p>© ${SITE_NAME}</p>
    </footer>
  </div>
</body>
</html>`;
};

export const htmlEscape = esc;
