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
      <li class="post-item">
        <a href="/blog/${htmlEscape(p.slug)}">
          <span class="post-date">${htmlEscape(p.date)}</span>
          <span class="post-title">${htmlEscape(p.title)}</span>
        </a>
        ${p.description ? `<p class="post-desc">${htmlEscape(p.description)}</p>` : ""}
      </li>`,
    )
    .join("\n");
  return renderLayout({
    title: "ブログ — stock-ai",
    description: "stock-ai の開発ログと、モデル改善・検証結果の記録。",
    path: "/blog/",
    content: `
    <h1>ブログ</h1>
    <p>開発ログと、モデル改善・検証結果の記録です。</p>
    <ul class="post-list">${items}</ul>
    <style>
      .post-list { list-style: none; padding: 0; margin: 1rem 0; }
      .post-item { padding: 0.75rem 0; border-bottom: 1px solid #e5e7eb; }
      .post-item a { display: flex; gap: 0.75rem; text-decoration: none; align-items: baseline; flex-wrap: wrap; }
      .post-item a:hover .post-title { text-decoration: underline; }
      .post-date { color: #94a3b8; font-size: 0.85rem; font-family: ui-monospace, monospace; flex-shrink: 0; }
      .post-title { color: #111827; font-weight: 600; }
      .post-desc { margin: 0.25rem 0 0; color: #475569; font-size: 0.9rem; }
    </style>
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
    <article>
      <header style="margin-bottom:1rem;">
        <p style="margin:0;color:#94a3b8;font-size:0.85rem;font-family:ui-monospace,monospace;">${htmlEscape(post.date)}</p>
        <h1>${htmlEscape(post.title)}</h1>
      </header>
      ${html}
      <hr style="margin:2rem 0;border:none;border-top:1px solid #e5e7eb;" />
      <p><a href="/blog/">← ブログ一覧へ</a></p>
    </article>
`,
  });
};
