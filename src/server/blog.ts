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

export const renderBlogIndex = (): string => {
  const posts = listPostMeta();
  const items = posts
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
    .join("\n");
  return renderLayout({
    title: "ブログ — stock-ai",
    description: "stock-ai の開発ログと、モデル改善・検証結果の記録。",
    path: "/blog/",
    content: `
    <section class="hero">
      <h1>ブログ</h1>
      <p class="lead">開発ログと、モデル改善・検証結果の記録です。</p>
    </section>
    <section class="section">
      <ul class="post-list">${items}</ul>
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
