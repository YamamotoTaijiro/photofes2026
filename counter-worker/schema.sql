CREATE TABLE IF NOT EXISTS views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_index INTEGER NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT,
  ui_lang TEXT
);

CREATE INDEX IF NOT EXISTS idx_views_photo_index ON views (photo_index);

CREATE TABLE IF NOT EXISTS thumbnails (
  photo_index INTEGER PRIMARY KEY,
  image BLOB NOT NULL,
  content_type TEXT NOT NULL
);
