CREATE TABLE IF NOT EXISTS stock_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  code TEXT NOT NULL,
  signal_date INTEGER NOT NULL,
  buy_date INTEGER NOT NULL,
  buy_price REAL NOT NULL,
  shares INTEGER NOT NULL,
  investment_yen REAL NOT NULL,
  sell_date INTEGER,
  sell_price REAL,
  pnl_yen REAL,
  pnl_pct REAL,
  exit_reason TEXT,
  equity_after REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS stock_trades_strategy_idx ON stock_trades(strategy);
CREATE INDEX IF NOT EXISTS stock_trades_buy_date_idx ON stock_trades(buy_date);
CREATE INDEX IF NOT EXISTS stock_trades_sell_date_idx ON stock_trades(sell_date);
