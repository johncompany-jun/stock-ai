import { Marked } from "marked";
import { renderLayout, htmlEscape } from "./html";
import { RAW_POSTS } from "./blog-posts";

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  body: string;
};

const parseFrontmatter = (raw: string): { data: Record<string, string>; body: string } => {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: m[2] };
};

const allPosts = (): BlogPost[] => {
  const posts: BlogPost[] = [];
  for (const [slug, raw] of Object.entries(RAW_POSTS)) {
    const { data, body } = parseFrontmatter(raw);
    posts.push({
      slug,
      title: data.title ?? slug,
      description: data.description ?? "",
      date: data.date ?? "",
      body,
    });
  }
  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return posts;
};

export const listPostMeta = (): Array<Omit<BlogPost, "body">> =>
  allPosts().map(({ body: _b, ...rest }) => rest);

const marked = new Marked({ gfm: true, breaks: false });

const CATEGORIES: Array<{ slug: string; label: string; description: string }> = [
  { slug: "stock", label: "日本株", description: "レンジサイクル戦略・季節性・低位株の教育記事" },
  { slug: "fx", label: "FX (USD/JPY)", description: "モデル構築・特徴量・実運用ルール" },
  { slug: "broker", label: "口座・サービス比較", description: "証券口座・FX 口座・NISA の選び方" },
  { slug: "strategy", label: "戦略・検証", description: "方法論・バックテストの罠・ポートフォリオ設計" },
  { slug: "dev", label: "開発ログ・運営", description: "サイト構成・コスト・月次振り返り" },
];

const CATEGORY_OF: Record<string, string> = {
  "range-cycle-backtest-1235": "stock",
  "stock-seasonality-september": "stock",
  "low-price-stock-range-cycle": "stock",
  "sma-touch-strategy-3-patterns": "stock",
  "golden-cross-why-slow": "stock",
  "no-margin-trading": "stock",
  "2026-11-candidate-stocks": "stock",
  "weekly-pick-01-klab-review": "stock",
  "ipo-exclusion-rule": "stock",
  "fx-model-build-review": "fx",
  "gotoubi-anomaly-check": "fx",
  "knn-similar-day-prediction": "fx",
  "5-seed-average": "fx",
  "1man-yen-usdjpy-start": "fx",
  "stoploss-20pips-fixed": "fx",
  "stock-broker-comparison-100k": "broker",
  "nisa-broker-selection": "broker",
  "fx-broker-small-lot": "broker",
  "stock-model-collapse-2026-10": "strategy",
  "backtest-5-pitfalls": "strategy",
  "stock-fx-two-wheels": "strategy",
  "hello-stock-ai": "dev",
  "ai-server-pick-failure": "dev",
  "monthly-cost-breakdown": "dev",
  "how-this-site-is-built": "dev",
  "2026-10-monthly-review": "dev",
  "cloudflare-d1-workers-zero-cost": "dev",
  "weekly-pick-02-ai-prediction-wrapup": "strategy",
};

const POSTS_PER_CATEGORY_ON_INDEX = 5;
const POSTS_PER_PAGE = 10;

const postsOfCategory = (slug: string): Array<Omit<BlogPost, "body">> =>
  listPostMeta().filter((p) => (CATEGORY_OF[p.slug] ?? "dev") === slug);

export const listCategorySlugs = (): string[] => CATEGORIES.map((c) => c.slug);

export const categoryPageCount = (slug: string): number => {
  const n = postsOfCategory(slug).length;
  return Math.max(1, Math.ceil(n / POSTS_PER_PAGE));
};

const renderPostListItem = (p: Omit<BlogPost, "body">): string => `
      <li>
        <a href="/blog/${htmlEscape(p.slug)}">
          <span class="post-date">${htmlEscape(p.date)}</span>
          <span class="post-title">${htmlEscape(p.title)}</span>
          ${p.description ? `<p class="post-desc">${htmlEscape(p.description)}</p>` : ""}
        </a>
      </li>`;

export const renderBlogIndex = (): string => {
  const posts = listPostMeta();
  const byCategory = new Map<string, typeof posts>();
  for (const p of posts) {
    const cat = CATEGORY_OF[p.slug] ?? "dev";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(p);
  }

  const toc = CATEGORIES.map((c) => {
    const n = byCategory.get(c.slug)?.length ?? 0;
    return `<a href="#cat-${c.slug}" class="btn btn-outline text-sm">${htmlEscape(c.label)} <span class="text-xs text-[color:var(--color-muted-soft)]">(${n})</span></a>`;
  }).join("");

  const sections = CATEGORIES.map((c) => {
    const list = byCategory.get(c.slug) ?? [];
    if (list.length === 0) return "";
    const head = list.slice(0, POSTS_PER_CATEGORY_ON_INDEX);
    const items = head.map(renderPostListItem).join("\n");
    const more =
      list.length > POSTS_PER_CATEGORY_ON_INDEX
        ? `<p class="mt-3"><a href="/blog/category/${c.slug}" class="btn btn-outline text-sm">${htmlEscape(c.label)}の記事をすべて見る (${list.length} 本) →</a></p>`
        : "";
    return `
    <section class="section" id="cat-${c.slug}">
      <h2><a href="/blog/category/${c.slug}" class="no-underline hover:underline">${htmlEscape(c.label)}</a> <span class="text-sm font-normal text-[color:var(--color-muted-soft)]">(${list.length})</span></h2>
      <p class="text-sm text-[color:var(--color-muted)] mb-3">${htmlEscape(c.description)}</p>
      <ul class="post-list">${items}</ul>
      ${more}
    </section>`;
  }).join("\n");

  return renderLayout({
    title: "ブログ — stock-ai",
    description: "stock-ai の開発ログと、モデル改善・検証結果の記録。日本株・FX・口座比較・戦略検証・開発ログの 5 カテゴリに整理。",
    path: "/blog/",
    content: `
    <section class="hero">
      <h1>ブログ</h1>
      <p class="lead">開発ログと、モデル改善・検証結果の記録です。</p>
      <div class="flex flex-wrap gap-2 mt-4">${toc}</div>
    </section>
    ${sections}
`,
  });
};

export const renderCategoryPage = (slug: string, page: number): string | null => {
  const cat = CATEGORIES.find((c) => c.slug === slug);
  if (!cat) return null;
  const list = postsOfCategory(slug);
  const totalPages = Math.max(1, Math.ceil(list.length / POSTS_PER_PAGE));
  if (page < 1 || page > totalPages) return null;
  const start = (page - 1) * POSTS_PER_PAGE;
  const pageItems = list.slice(start, start + POSTS_PER_PAGE);

  const items = pageItems.map(renderPostListItem).join("\n");

  const baseUrl = `/blog/category/${slug}`;
  const linkTo = (n: number): string => (n === 1 ? baseUrl : `${baseUrl}/page/${n}`);
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
      ? `<nav class="flex items-center justify-between mt-6">${prev}<span class="text-sm text-[color:var(--color-muted)]">${page} / ${totalPages}</span>${next}</nav>`
      : "";

  const otherCats = CATEGORIES.filter((c) => c.slug !== slug)
    .map(
      (c) =>
        `<a href="/blog/category/${c.slug}" class="btn btn-outline text-sm">${htmlEscape(c.label)}</a>`,
    )
    .join("");

  const pageSuffix = page > 1 ? ` (${page}/${totalPages})` : "";
  return renderLayout({
    title: `${cat.label} — ブログ${pageSuffix} — stock-ai`,
    description: `${cat.description} — stock-ai ブログの「${cat.label}」カテゴリ (${list.length} 本)。`,
    path: page === 1 ? `/blog/category/${slug}` : `/blog/category/${slug}/page/${page}`,
    content: `
    <section class="hero">
      <p class="text-xs text-[color:var(--color-muted-soft)] font-mono m-0 mb-2"><a href="/blog/">← ブログ一覧へ</a></p>
      <h1>${htmlEscape(cat.label)} <span class="text-sm font-normal text-[color:var(--color-muted-soft)]">(${list.length} 本)</span></h1>
      <p class="lead">${htmlEscape(cat.description)}</p>
    </section>
    <section class="section">
      <ul class="post-list">${items}</ul>
      ${nav}
    </section>
    <section class="section">
      <h2 class="text-base">他のカテゴリ</h2>
      <div class="flex flex-wrap gap-2 mt-2">${otherCats}</div>
    </section>
`,
  });
};

const RELATED: Record<string, string[]> = {
  "hello-stock-ai": ["range-cycle-backtest-1235", "fx-model-build-review", "how-this-site-is-built"],
  "weekly-pick-01-klab-review": ["range-cycle-backtest-1235", "stock-model-collapse-2026-10", "stock-broker-comparison-100k"],
  "stock-model-collapse-2026-10": ["range-cycle-backtest-1235", "knn-similar-day-prediction", "weekly-pick-01-klab-review"],
  "range-cycle-backtest-1235": ["stock-seasonality-september", "2026-11-candidate-stocks", "stock-broker-comparison-100k"],
  "stock-seasonality-september": ["range-cycle-backtest-1235", "2026-11-candidate-stocks", "nisa-broker-selection"],
  "fx-model-build-review": ["knn-similar-day-prediction", "gotoubi-anomaly-check", "fx-broker-small-lot"],
  "ai-server-pick-failure": ["how-this-site-is-built", "monthly-cost-breakdown", "fx-model-build-review"],
  "knn-similar-day-prediction": ["fx-model-build-review", "5-seed-average", "fx-broker-small-lot"],
  "5-seed-average": ["knn-similar-day-prediction", "fx-model-build-review", "ai-server-pick-failure"],
  "monthly-cost-breakdown": ["how-this-site-is-built", "ai-server-pick-failure", "fx-model-build-review"],
  "gotoubi-anomaly-check": ["fx-model-build-review", "knn-similar-day-prediction", "fx-broker-small-lot"],
  "how-this-site-is-built": ["ai-server-pick-failure", "monthly-cost-breakdown", "fx-model-build-review"],
  "2026-10-monthly-review": ["fx-model-build-review", "range-cycle-backtest-1235", "2026-11-candidate-stocks"],
  "2026-11-candidate-stocks": ["range-cycle-backtest-1235", "stock-seasonality-september", "stock-broker-comparison-100k"],
  "stock-broker-comparison-100k": ["nisa-broker-selection", "range-cycle-backtest-1235", "2026-11-candidate-stocks"],
  "fx-broker-small-lot": ["fx-model-build-review", "knn-similar-day-prediction", "gotoubi-anomaly-check"],
  "nisa-broker-selection": ["stock-broker-comparison-100k", "range-cycle-backtest-1235", "stock-seasonality-september"],
  "low-price-stock-range-cycle": ["range-cycle-backtest-1235", "nisa-broker-selection", "stock-broker-comparison-100k"],
  "sma-touch-strategy-3-patterns": ["range-cycle-backtest-1235", "golden-cross-why-slow", "low-price-stock-range-cycle"],
  "1man-yen-usdjpy-start": ["fx-broker-small-lot", "fx-model-build-review", "stoploss-20pips-fixed"],
  "golden-cross-why-slow": ["sma-touch-strategy-3-patterns", "range-cycle-backtest-1235", "backtest-5-pitfalls"],
  "ipo-exclusion-rule": ["range-cycle-backtest-1235", "low-price-stock-range-cycle", "backtest-5-pitfalls"],
  "no-margin-trading": ["nisa-broker-selection", "stock-broker-comparison-100k", "low-price-stock-range-cycle"],
  "stoploss-20pips-fixed": ["fx-model-build-review", "1man-yen-usdjpy-start", "backtest-5-pitfalls"],
  "backtest-5-pitfalls": ["range-cycle-backtest-1235", "fx-model-build-review", "stock-model-collapse-2026-10"],
  "stock-fx-two-wheels": ["range-cycle-backtest-1235", "fx-model-build-review", "no-margin-trading"],
  "cloudflare-d1-workers-zero-cost": ["how-this-site-is-built", "monthly-cost-breakdown", "ai-server-pick-failure"],
  "weekly-pick-02-ai-prediction-wrapup": ["weekly-pick-01-klab-review", "stock-model-collapse-2026-10", "range-cycle-backtest-1235"],
};

const renderRelatedPosts = (currentSlug: string): string => {
  const relatedSlugs = RELATED[currentSlug] ?? [];
  if (relatedSlugs.length === 0) return "";
  const posts = listPostMeta();
  const items = relatedSlugs
    .map((slug) => posts.find((p) => p.slug === slug))
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map(
      (p) => `
      <a href="/blog/${htmlEscape(p.slug)}" class="card">
        <div class="text-xs text-[color:var(--color-muted-soft)] font-mono mb-1">${htmlEscape(p.date)}</div>
        <div class="font-semibold mb-1 text-sm">${htmlEscape(p.title)}</div>
        ${p.description ? `<p class="text-xs text-[color:var(--color-muted)] m-0">${htmlEscape(p.description)}</p>` : ""}
      </a>`,
    )
    .join("");
  if (!items) return "";
  return `
    <section class="section">
      <h2>関連する記事</h2>
      <div class="grid gap-3 sm:grid-cols-3">${items}</div>
    </section>`;
};

export const renderBlogPost = (slug: string): string | null => {
  const post = allPosts().find((p) => p.slug === slug);
  if (!post) return null;
  const html = marked.parse(post.body) as string;
  return renderLayout({
    title: `${post.title} — stock-ai ブログ`,
    description: post.description || post.title,
    path: `/blog/${post.slug}`,
    ogType: "article",
    content: `
    <article class="prose">
      <header class="hero">
        <p class="text-xs text-[color:var(--color-muted-soft)] font-mono m-0 mb-2">${htmlEscape(post.date)}</p>
        <h1>${htmlEscape(post.title)}</h1>
      </header>
      <div class="blog-body">
        ${html}
      </div>
    </article>
    ${renderRelatedPosts(post.slug)}
    <p class="mt-6"><a href="/blog/" class="btn btn-outline">← ブログ一覧へ</a></p>
`,
  });
};
