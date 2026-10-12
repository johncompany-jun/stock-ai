CREATE TABLE IF NOT EXISTS virtual_portfolio_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS virtual_portfolio_buy_date_idx ON virtual_portfolio_trades(buy_date);
CREATE INDEX IF NOT EXISTS virtual_portfolio_sell_date_idx ON virtual_portfolio_trades(sell_date);
