CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  signal_date INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  added_at INTEGER NOT NULL,
  removed_at INTEGER,
  note TEXT
);

CREATE INDEX IF NOT EXISTS watchlist_code_idx ON watchlist(code);
CREATE INDEX IF NOT EXISTS watchlist_added_at_idx ON watchlist(added_at);
