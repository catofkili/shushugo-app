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

CREATE TABLE IF NOT EXISTS word_notes (
  word_id INTEGER PRIMARY KEY,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(word_id) REFERENCES words(id)
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

-- 按 (kanji, kana) 找词是热路径：相似释义词对照每张卡都要查一次，词单导入
-- 每条记录也要查一次。没有这个索引就是 11k 行全表扫，一页快速学习能扫掉上百万行。
CREATE INDEX IF NOT EXISTS idx_words_kanji_kana ON words(kanji, kana);

-- 反向学习(日语 → 释义)的长期记忆。
--
-- 反向以前只有当天的 stage2_progress，关掉应用什么都不留 —— 它不是一个模式，
-- 是个用完就扔的临时队列。现在三个方向(正向 progress / 反向 reverse_memory /
-- 汉字 kanji_memory)各有一份自己的 FSRS 状态，规则完全一样：同一套到期集选词、
-- 同样的学习步骤和毕业判定、同样的每日上限。fsrs_* 列由 ensureFsrsColumns 补。
--
-- 三张卡挂同一个 word_id：词条、笔记、收藏、统计都是共享的，
-- 但各自的 due 只由各自方向的作答改写 —— 所以背没背反向，不影响常规模式出哪些词。
CREATE TABLE IF NOT EXISTS reverse_memory (
  word_id INTEGER PRIMARY KEY,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT,
  FOREIGN KEY(word_id) REFERENCES words(id)
);

-- 「疑难辨析」里标记为已掌握的词组。
--
-- 主键是词组的稳定标识（type:锚点，如 homophone:こうえん），刻意不用 word_id：
-- 去重和外来語合并动过 id（见 bake-seed-db 的 loanword-merge-map），拿 id 组键
-- 会让用户标过的掌握状态在下次清库后全部失效。
CREATE TABLE IF NOT EXISTS confusion_mastered (
  group_key TEXT PRIMARY KEY,
  mastered_on TEXT NOT NULL
);
