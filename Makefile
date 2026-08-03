COMPOSE := docker compose
SERVICE := app

.PHONY: help up down restart build rebuild logs ps shell sh install add typecheck deploy clean db-generate db-migrate db-import db-reset db-shell db-fetch-candles db-fetch-candles-sample db-fetch-candles-remote db-predict db-predict-sample

help: ## 使い方を表示
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## バックグラウンドで起動 (http://localhost:5173)
	$(COMPOSE) up -d
	@until curl -sf http://localhost:5173 >/dev/null 2>&1; do sleep 1; done
	@open http://localhost:5173

down: ## 停止して削除
	$(COMPOSE) down

restart: ## 再起動
	$(COMPOSE) restart

build: ## イメージをビルド
	$(COMPOSE) build

rebuild: ## キャッシュを使わずビルドして起動し直す
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d

logs: ## ログを追従表示
	$(COMPOSE) logs -f $(SERVICE)

ps: ## 稼働状態を表示
	$(COMPOSE) ps

shell: ## コンテナ内でシェルを起動
	$(COMPOSE) exec $(SERVICE) sh

sh: shell ## shell のエイリアス

install: ## 依存を再インストール
	$(COMPOSE) exec $(SERVICE) bun install

add: ## 依存を追加 (make add PKG=xxx)
	$(COMPOSE) exec $(SERVICE) bun add $(PKG)

typecheck: ## 型チェック
	$(COMPOSE) exec $(SERVICE) bun run typecheck

deploy: ## Cloudflare にデプロイ (要 CLOUDFLARE_API_TOKEN)
	$(COMPOSE) exec -e CLOUDFLARE_API_TOKEN $(SERVICE) bun run deploy

clean: ## ボリューム含めて全削除
	$(COMPOSE) down -v --remove-orphans

db-generate: ## スキーマから SQL マイグレーションを生成
	$(COMPOSE) exec $(SERVICE) bunx drizzle-kit generate

db-migrate: ## ローカル D1 にマイグレーションを適用
	$(COMPOSE) exec $(SERVICE) bunx wrangler d1 migrations apply stock-ai --local

db-import: ## CSV から SQL 生成→ローカル D1 に流し込み
	$(COMPOSE) exec $(SERVICE) bun run scripts/import-stocks.ts
	$(COMPOSE) exec $(SERVICE) bunx wrangler d1 execute stock-ai --local --file=./drizzle/seed_stocks.sql

db-reset: ## ローカル D1 をリセット (マイグレーション再適用→再インポート)
	$(COMPOSE) exec $(SERVICE) rm -rf .wrangler/state/v3/d1
	$(MAKE) db-migrate
	$(MAKE) db-import

db-shell: ## ローカル D1 に対話 SQL シェル
	$(COMPOSE) exec $(SERVICE) bunx wrangler d1 execute stock-ai --local --command "SELECT COUNT(*) FROM stocks"

db-fetch-candles-sample: ## 動作確認: 3銘柄 × 1年分をローカル D1 に投入 (make db-fetch-candles-sample)
	$(COMPOSE) exec $(SERVICE) bun run scripts/fetch-candles.ts --codes=1301,7203,9984 --years=1 --apply

db-fetch-candles: ## 差分取得: ローカル D1 の全銘柄を今日まで更新 (CODES=1301,7203 で絞り込み可)
	$(COMPOSE) exec $(SERVICE) bun run scripts/fetch-candles.ts $(if $(CODES),--codes=$(CODES)) $(if $(LIMIT),--limit=$(LIMIT)) --apply

db-fetch-candles-full: ## フル取得: 5年分を全銘柄で取り直し (時間がかかる)
	$(COMPOSE) exec $(SERVICE) bun run scripts/fetch-candles.ts --full --years=5 --apply

db-fetch-candles-remote: ## 差分取得を Cloudflare リモート D1 に適用
	$(COMPOSE) exec -e CLOUDFLARE_API_TOKEN $(SERVICE) bun run scripts/fetch-candles.ts --remote $(if $(CODES),--codes=$(CODES)) --apply

db-predict-sample: ## 動作確認: 3銘柄で予測を生成しローカル D1 に投入
	$(COMPOSE) exec $(SERVICE) bun run scripts/predict-all.ts --codes=1301,7203,9984 --apply

db-predict: ## 全銘柄で LSTM 予測を生成しローカル D1 に投入 (LIMIT=N で件数制限, CODES=... で絞込)
	$(COMPOSE) exec $(SERVICE) bun run scripts/predict-all.ts $(if $(CODES),--codes=$(CODES)) $(if $(LIMIT),--limit=$(LIMIT)) --apply
