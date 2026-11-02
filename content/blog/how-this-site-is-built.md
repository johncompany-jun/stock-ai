---
title: このサイトの作り方 — 個人が月 500 円で投資 AI サイトを立てる手順
description: 日本株と FX の AI 予測を日次で公開しているこのサイトの技術構成を全部公開。同じようなサイトを個人で作りたい方向けの手順まとめです。
date: 2026-11-02
---

このサイトは、1 人の個人開発者が運営している投資 AI 検証サイトです。
日本株の銘柄パターン検出、ドル円の寄付方向予測、どちらも毎日自動で更新されています。

「同じようなサイト、自分でも作れるの?」と聞かれることが増えたので、
全部の構成を公開します。
月額コストは 500 - 1,000 円程度、
Node.js と Python の基本が分かる方なら、休日を 2-3 回使えば立ち上げられる構成です。

## 全体像

| 役割 | 使っているもの |
|---|---|
| フロントエンド (SSR + SPA) | Vue 3 + Vite |
| サーバー (Workers) | Hono + Cloudflare Workers |
| データベース | Cloudflare D1 (SQLite 互換) |
| ORM | Drizzle ORM |
| スタイル | Tailwind CSS v4 |
| AI の学習と推論 | GitHub Actions + TensorFlow.js |
| データ取得 (株) | Yahoo Finance Japan (yahoo-finance2) |
| データ取得 (FX) | Dukascopy (dukascopy-node) |
| メール配信 | Resend |
| 自動デプロイ | GitHub Actions → Cloudflare Workers |

全部無料枠から始められるツールの組み合わせです。

## 1. サーバー: Cloudflare Workers + Hono

Cloudflare Workers は「世界中にレスポンスを配信する超速サーバー」。
月額 $5 (約 750 円) の有料プランでも、1,000 万リクエスト / 月まで入っています。
個人サイトのアクセスなら使い切れません。

Hono は Cloudflare Workers 向けの軽量な Web フレームワーク。
Express に似た書き心地で、SSR のページも API も同じコードで書けます。

```typescript
app.get("/fx/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select(...).from(fxPredictions);
  return c.html(renderFxIndex(rows));
});
```

## 2. データベース: Cloudflare D1

Cloudflare D1 は SQLite 互換のサーバーレス DB。
Workers と同じエッジに置かれていて、クエリが数ミリ秒で返ります。
無料枠で月 500 万行の読み書きが可能。

スキーマ定義は Drizzle ORM で TypeScript から:

```typescript
export const fxPredictions = sqliteTable("fx_predictions", {
  date: text("date").notNull(),
  direction: text("direction").notNull(),
  probability: real("probability").notNull(),
  // ...
});
```

マイグレーションは `wrangler d1 migrations apply` で本番にも適用。

## 3. AI 推論は GitHub Actions で

Cloudflare Workers 上で TensorFlow.js を動かすのはサイズと時間の制限で難しい
([詳細はこちら](/blog/ai-server-pick-failure))。
そこで AI の学習と推論は GitHub Actions で実行し、
結果だけを D1 に書き込んでいます。

```yaml
name: Daily FX signal
on:
  schedule:
    - cron: "5 0 * * MON-FRI"  # 毎日 9:05 JST
jobs:
  predict:
    runs-on: ubuntu-latest
    steps:
      - run: bun run scripts/fx-signal.ts --apply
```

GitHub Actions の無料枠は月 2,000 分。
日次バッチなら余裕で収まります。

## 4. スタイルは Tailwind v4

Tailwind v4 の `@theme` でブランド色を定義し、
再利用コンポーネントを `@layer components` にまとめています。

```css
@theme {
  --color-brand: #0f766e;
  --color-brand-soft: #ccfbf1;
}

@layer components {
  .card {
    background: white;
    border: 1px solid var(--color-divider);
    border-radius: 12px;
    padding: 1.1rem 1.25rem;
  }
}
```

SSR の文字列 HTML でも、クラス名を書けば CLI が検出して CSS を生成してくれます。

## 5. 自動デプロイ

GitHub の main ブランチに push すると、GitHub Actions が自動で:

1. TypeScript 型チェック
2. 新規 DB マイグレーション適用
3. CSS ビルド (Tailwind)
4. Vite ビルド
5. Cloudflare Workers にデプロイ

という流れで本番公開されます。
`git push` 一発でデプロイが済むので、ローカルで `wrangler deploy` を叩く必要がありません。

## 「個人で作ってみたい人」への順序

もし同じようなサイトを個人で立ち上げるなら、おすすめの順序は:

1. **Cloudflare アカウント開設** (無料) → Workers と D1 の無料枠を確保
2. **GitHub リポジトリ作成** → Actions の無料枠を確保
3. **Hono + Vite のテンプレートを `bun create`** → ベースの SSR サイトが 10 分で立つ
4. **データ取得のバッチを 1 本書く** → Yahoo Finance から 1 銘柄だけ毎日取得
5. **データを D1 に保存して、SSR で表示** → 最小の MVP
6. **AI の学習と推論を追加** → kNN から始めるのがおすすめ (シンプル)
7. **ドメイン取得と Cloudflare 紐付け**
8. **公開**

6 と 7 は後回しでも、最初の 5 までで「毎日データが貯まるサイト」はできあがります。
その先の AI 部分は、慣れてからで十分です。

## 実際のコスト

- Cloudflare Workers Paid: 月 $5 (約 750 円)
- Cloudflare D1 / GitHub Actions / Resend: 無料枠内
- ドメイン: 月 125 円

合計 **月 875 円 ほど**。
これで日本株数千銘柄のデータ取得、AI の毎日学習と推論、サイト公開、まで回ります。

## 教訓

- Cloudflare が月 $5 の価格で異常に強い (他クラウドで同じことをやると月数万円)
- 「AI 推論は Workers」はまず諦めて GitHub Actions に逃がす
- 自動デプロイは最初に組んでおくと、記事書きのスピードが段違い
- SSR はブログ系・情報サイト系では SEO と速度の両面で有利

同じ構成で「自分の実験記録サイト」を作りたい方の参考になれば。
技術スタックや各コンポーネントの詳細は、別記事で少しずつ書いていきます。
