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
      <hr class="my-8 border-0 border-t border-[color:var(--color-divider)]" />
      <p><a href="/blog/" class="btn btn-outline">← ブログ一覧へ</a></p>
    </article>
`,
  });
};
