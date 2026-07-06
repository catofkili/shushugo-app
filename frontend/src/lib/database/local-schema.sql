CREATE TABLE IF NOT EXISTS grammar_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  meaning TEXT NOT NULL,
  prompt TEXT NOT NULL,
  formation TEXT NOT NULL,
  example_jp TEXT NOT NULL,
  example_meaning TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  confusions TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'N5',
  importance INTEGER NOT NULL DEFAULT 3,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grammar_progress (
  grammar_id INTEGER PRIMARY KEY,
  score REAL NOT NULL DEFAULT 0,
  seen_count INTEGER NOT NULL DEFAULT 0,
  low_history INTEGER NOT NULL DEFAULT 0,
  known_forever INTEGER NOT NULL DEFAULT 0,
  mastered_on TEXT,
  last_seen_on TEXT,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  last_decay_amount INTEGER NOT NULL DEFAULT 10,
  FOREIGN KEY(grammar_id) REFERENCES grammar_points(id)
);

CREATE TABLE IF NOT EXISTS grammar_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grammar_id INTEGER NOT NULL,
  answer TEXT NOT NULL,
  score_after REAL NOT NULL,
  reviewed_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(grammar_id) REFERENCES grammar_points(id)
);

CREATE TABLE IF NOT EXISTS grammar_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grammar_points_archive (
  archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dataset_version TEXT NOT NULL,
  id INTEGER,
  pattern TEXT NOT NULL,
  meaning TEXT NOT NULL,
  prompt TEXT NOT NULL,
  formation TEXT NOT NULL,
  example_jp TEXT NOT NULL,
  example_meaning TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  confusions TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'N5',
  importance INTEGER NOT NULL DEFAULT 3,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS content_favorites (
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (item_type, item_id)
);

CREATE TABLE IF NOT EXISTS grammar_mistakes (
  grammar_id INTEGER PRIMARY KEY,
  answer TEXT NOT NULL,
  score_after REAL NOT NULL DEFAULT 0,
  mistake_count INTEGER NOT NULL DEFAULT 1,
  first_seen_on TEXT NOT NULL,
  last_seen_on TEXT NOT NULL,
  resolved_on TEXT,
  FOREIGN KEY(grammar_id) REFERENCES grammar_points(id)
);

CREATE TABLE IF NOT EXISTS moji_migrated_reviews (
  word_id INTEGER PRIMARY KEY,
  imported_on TEXT NOT NULL,
  priority REAL NOT NULL DEFAULT 0,
  activated_on TEXT,
  FOREIGN KEY(word_id) REFERENCES words(id)
);

CREATE INDEX IF NOT EXISTS idx_moji_migrated_reviews_activation
  ON moji_migrated_reviews(activated_on, priority);
