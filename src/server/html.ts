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
  <style>
    :root { color-scheme: light; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; color: #111827; max-width: 720px; margin: 0 auto; padding: 1.5rem 1rem 3rem; line-height: 1.75; }
    header.site { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1.5rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.75rem; }
    header.site a.logo { font-weight: 700; color: #111827; text-decoration: none; font-size: 1.1rem; }
    header.site nav a { margin-left: 1rem; color: #475569; text-decoration: none; font-size: 0.9rem; }
    header.site nav a:hover { text-decoration: underline; }
    main h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
    main h2 { font-size: 1.15rem; margin: 1.75rem 0 0.5rem; }
    main h3 { font-size: 1rem; margin: 1.25rem 0 0.4rem; }
    main p { margin: 0 0 0.75rem; }
    main ul, main ol { margin: 0 0 0.75rem; padding-left: 1.5rem; }
    main code { background: #f1f5f9; padding: 0 0.3rem; border-radius: 3px; font-size: 0.9em; }
    main pre { background: #0f172a; color: #e2e8f0; padding: 0.75rem 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; }
    main pre code { background: transparent; padding: 0; color: inherit; }
    main a { color: #2563eb; }
    .notice { background: #fef3c7; border: 1px solid #fde68a; color: #78350f; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem; margin-bottom: 1rem; }
    footer.site { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 0.78rem; text-align: center; }
    footer.site p { margin: 0.3rem 0; }
    footer.site nav { display: inline-flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center; margin: 0.4rem 0; }
    footer.site a { color: #334155; text-decoration: none; }
    footer.site a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header class="site">
    <a href="/" class="logo">${SITE_NAME}</a>
    <nav>
      <a href="/">ホーム</a>
      <a href="/blog/">ブログ</a>
      <a href="/about">このサイトについて</a>
    </nav>
  </header>
  <main>
${o.content}
  </main>
  <footer class="site">
    <p>過去データにもとづく分析結果の共有であり、売買を勧めるものではありません。投資判断はご自身の責任でお願いします。</p>
    <nav>
      <a href="/about">このサイトについて</a>
      <a href="/disclaimer">免責事項</a>
      <a href="/privacy">プライバシーポリシー</a>
      <a href="/blog/">ブログ</a>
    </nav>
    <p>© ${SITE_NAME}</p>
  </footer>
</body>
</html>`;
};

export const htmlEscape = esc;
