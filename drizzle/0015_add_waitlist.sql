CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  unsubscribed_at INTEGER,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS waitlist_added_at_idx ON waitlist(added_at);
CREATE INDEX IF NOT EXISTS waitlist_category_idx ON waitlist(category);
