# stock-ai

日本株の Top N 発掘ツール + USD/JPY 中値トレード判定 (`/fx` サブシステム)。
本番: **https://stock-ai.uk**

## Stack

- Runtime: Cloudflare Workers (Hono)
- Frontend: Vue 3 + Vite
- DB: Cloudflare D1 (SQLite) + drizzle-orm / drizzle-kit
- ML: TensorFlow.js (LSTM は Web Worker)
- データ取得: yahoo-finance2 (日足株価 / 1分足 FX), dukascopy-node (FX ヒストリカル)
- ランタイム: Bun

## Directory

```
src/
  server/          Hono app (API), D1 スキーマ
    index.ts       /api/{health,stocks,candles,rankings,backtest,...} 定義
    db/schema.ts   drizzle schema (stocks, candles, predictions, prediction_log, fx_candles)
  client/          Vue アプリ
    App.vue, main.ts
    ml/            LSTM 推論用 Web Worker + 前処理
scripts/           バッチ / ETL / 予測 / バックテスト
  fetch-candles.ts       yfinance 差分取り込み → candles
  import-stocks.ts       銘柄マスタ投入
  predict-all.ts         全銘柄予測 (モデル指定)
  models/                SMA cross / RSI reversal / Volume breakout / LSTM 実装
  backtest.ts            単モデル バックテスト
  backtest-ensemble.ts   アンサンブル + 信頼度スコア検証
  backtest-report.ts     結果サマリ
  agreement-analysis.sql モデル間一致率解析
  dump-local-to-sql.ts   ローカル D1 → SQL エクスポート
  fx-import-dukascopy.ts USD/JPY 3年ヒストリカル (月ごと chunk apply)
  fx-update-yfinance.ts  USD/JPY 日次差分 (JPY=X, 1m)
drizzle/           マイグレーション (0000..0005)
.github/workflows/
  daily-candles.yml     JST 01:00 平日: candles + SMA/RSI/Volume predict
  daily-lstm.yml        daily-candles 成功後: 4-way matrix で LSTM 予測
  daily-fx-candles.yml  JST 07:00 平日: fx_candles yfinance 更新
  backtest.yml          週1 日曜 JST 06:00: SEED ローテで prediction_log 蓄積
data/              seed_*.sql (wrangler が migration 誤認しないよう隔離)
docker-compose.yml, Dockerfile   ローカル D1 コンテナ運用
wrangler.toml, drizzle.config.ts
```

## Models

`scripts/models/` 配下の 4 モデル + weighted-average アンサンブル。
- `sma_cross_v1` / `rsi_reversal_v1` / `volume_breakout_v1` / `lstm_v1`
- 信頼度スコア = 0.65 × directionScore + 0.35 × magnitudeScore
- 予測結果は `predictions` (最新) + `prediction_log` (バックテスト蓄積) に保存
- 週次 backtest cron が SEED をローテしてサンプルを追記

## FX sub-system (`/fx`)

Phase 1 (完了): データパイプライン
- `fx_candles(pair, timestamp_utc PK, open, high, low, close, volume)`
- Dukascopy 3 年 (2023-01-01..2025-12-31) をローカル + 本番 D1 に投入済み (~111 万行)
- 日次 cron `daily-fx-candles.yml` で yfinance 差分補充

Phase 2 以降: TFJS 二値分類 (up/down) → バックテストで 60% 閾値検証 → 日次推論 + Resend メール配信 → `/fx` Vue ルート。

## Commands

```
bun install
bun run dev            # Vite dev (client) + Hono middleware
bun run typecheck
bun run build          # vue-tsc + vite build
bun run deploy         # vite build + wrangler deploy (手動デプロイのみ)

# DB
bunx drizzle-kit generate --name=<name>
bunx wrangler d1 execute stock-ai --local  --file drizzle/xxxx.sql
bunx wrangler d1 execute stock-ai --remote --file drizzle/xxxx.sql

# バッチ (例)
bun run scripts/fetch-candles.ts
bun run scripts/predict-all.ts --model lstm_v1
bun run scripts/fx-import-dukascopy.ts --from 2023-01-01 --to 2025-12-31 --remote
bun run scripts/fx-update-yfinance.ts --daysBack 7 --remote
```

## Infra notes

- D1: `stock-ai` (`a40fd260-c66d-433d-9739-2e8222304033`, region APAC)
- 本番デプロイは `bun run deploy` の手動運用。API 挙動異常時は `bunx wrangler deployments list --name stock-ai` で最終デプロイ日時をまず確認
- GitHub Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
