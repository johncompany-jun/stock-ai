CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  replied_at INTEGER,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS contacts_added_at_idx ON contacts(added_at);
CREATE INDEX IF NOT EXISTS contacts_category_idx ON contacts(category);
