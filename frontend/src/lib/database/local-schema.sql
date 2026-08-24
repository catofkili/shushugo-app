CREATE TABLE IF NOT EXISTS grammar_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  meaning TEXT NOT NULL,
  prompt TEXT NOT NULL,
  formation TEXT NOT NULL,
  example_jp TEXT NOT NULL,
  example_meaning TEXT NOT NULL,
  example_furigana TEXT NOT NULL DEFAULT '',
  example_tokens TEXT NOT NULL DEFAULT '',
  example_lemmas TEXT NOT NULL DEFAULT '',
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

-- 从例句词典主动加入的词。任务表按学习日轮换，这张小表保留发现意图，
-- 让未开始的词在第二天仍会优先进入新词计划。
CREATE TABLE IF NOT EXISTS dictionary_discovered_words (
  word_id INTEGER PRIMARY KEY,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 独立于 JLPT 学习词库的补充词典。这里的条目只供例句点词查询，
-- 不使用 words.id，也不会进入 progress、学习计划或 FSRS。
CREATE TABLE IF NOT EXISTS dictionary_entries (
  entry_key TEXT PRIMARY KEY,
  headword TEXT NOT NULL,
  kana TEXT NOT NULL,
  meaning TEXT NOT NULL,
  pos TEXT NOT NULL,
  verb_type TEXT,
  category TEXT NOT NULL,
  usage_note TEXT NOT NULL DEFAULT '',
  example_jp TEXT NOT NULL DEFAULT '',
  example_meaning TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 3,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL,
  seed_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dictionary_entries_headword
  ON dictionary_entries(headword);

CREATE INDEX IF NOT EXISTS idx_dictionary_entries_kana
  ON dictionary_entries(kana);

-- 语法页的划重点。范围用语法点稳定 id + 内容块 + 字符偏移定位，
-- dataset_version 用来识别 grammar.ts/grammar_seed 改版后已经漂移的旧锚点。
CREATE TABLE IF NOT EXISTS grammar_highlights (
  grammar_id TEXT NOT NULL,
  block TEXT NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  text TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grammar_id, block, start, end)
);

-- Library / 沉浸式阅读位置。存稳定的语法点 id，不存过滤数组下标。
CREATE TABLE IF NOT EXISTS grammar_reading_positions (
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  grammar_id TEXT NOT NULL,
  scroll_top REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, level)
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
  example_furigana TEXT NOT NULL DEFAULT '',
  example_tokens TEXT NOT NULL DEFAULT '',
  example_lemmas TEXT NOT NULL DEFAULT '',
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

-- 用户自己改写的题面首义。**不写 words.meaning**：words 表不同步，而且词单导入/
-- 换种子库会整表覆盖，手改的内容会一次性没掉。这张表走 lww 同步（见 sync/tables.ts），
-- 同时必须出现在 scripts/bake-seed-db.mjs 的 userDataTables 里，否则会随出厂词库外泄。
CREATE TABLE IF NOT EXISTS word_question_meanings (
  word_id INTEGER PRIMARY KEY,
  prompt_meaning TEXT NOT NULL,
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
-- 旧汉字 kanji_memory)各有一份自己的 FSRS 状态，规则完全一样：同一套到期集选词、
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

-- 汉字读音模式的长期记忆。旧 kanji_memory 记录的是「释义 → 汉字」题型，
-- 新题型改为「看表记，回忆汉字对应读音」后不能把旧稳定度冒充成读音能力。
-- 因此旧表原样保留作归档，新表从干净状态开始；fsrs_* 列由 ensureFsrsColumns 补。
CREATE TABLE IF NOT EXISTS kanji_reading_memory (
  word_id INTEGER PRIMARY KEY,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT,
  FOREIGN KEY(word_id) REFERENCES words(id)
);

-- 新题型也使用独立的当日任务表，避免发布当天把旧汉字模式的完成进度接过来。
CREATE TABLE IF NOT EXISTS kanji_reading_progress (
  reviewed_on TEXT NOT NULL,
  word_id INTEGER NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (reviewed_on, word_id),
  FOREIGN KEY(word_id) REFERENCES words(id)
);

-- 「疑难辨析」里标记为已掌握的词组。
--
-- 主键是词组的稳定标识（type:锚点，如 homophone:こうえん），刻意不用 word_id：
-- 去重和外来語合并动过 id（见 bake-seed-db 的 loanword-merge-map），拿 id 组键
-- 会让用户标过的掌握状态在下次清库后全部失效。
-- 成就。解锁了就永远解锁,所以只记「哪天拿到的」,没有取消这回事。
-- 判据不存在这里 —— 它们每次都从 reviews/progress 现算(见 lib/achievements/stats.ts),
-- 这样加新成就时,以前达成过的会自动补发。
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  unlocked_on TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS confusion_mastered (
  group_key TEXT PRIMARY KEY,
  mastered_on TEXT NOT NULL
);

-- 「时刻」播报台账:哪个时刻已经播过了。
--
-- 每加一种庆祝就配一个 app_state 键的话,很快会有一把彼此不认识的键,
-- 而且没人知道「今天总共已经蹦了几个」—— 预算就无从谈起。统一记这一张表:
--   kind = 时刻种类(plan_trend / leech_cleared / ...)
--   key  = 一次性的粒度,由各自的检测器决定:
--          每天一次 → 日期,每词一次 → word_id,一辈子一次 → 固定串或阈值
--   (注意:这个文件是按分号裸切后逐条执行的,注释里也不许出现半角分号)
--   fired_on = 播报当天的学习日,用来数每日预算
CREATE TABLE IF NOT EXISTS moments (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  fired_on TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS idx_moments_fired_on ON moments(fired_on);

-- 汉字单元调度的本地内容、长期记忆和学习日检查点。
-- 内容来自随 App 发布的 kanji_reading_unit_index.json，不属于用户同步数据；
-- memory/flags/tasks/reviews 才是用户状态，由 sync/tables.ts 分别合并。
CREATE TABLE IF NOT EXISTS kanji_units (
  unit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_key TEXT NOT NULL UNIQUE,
  unit_type TEXT NOT NULL,
  char TEXT NOT NULL DEFAULT '',
  base TEXT NOT NULL DEFAULT '',
  surface TEXT NOT NULL DEFAULT '',
  reading TEXT NOT NULL DEFAULT '',
  kinds TEXT NOT NULL DEFAULT '[]',
  CHECK (
    (unit_type = 'char' AND char <> '' AND base <> '' AND surface = '' AND reading = '')
    OR (unit_type = 'jukujikun' AND char = '' AND base = '' AND surface <> '' AND reading <> '')
  )
);

CREATE TABLE IF NOT EXISTS kanji_unit_memory (
  unit_key TEXT PRIMARY KEY,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT,
  fsrs_stability REAL,
  fsrs_difficulty REAL,
  fsrs_due TEXT,
  fsrs_last_review TEXT,
  fsrs_state INTEGER,
  fsrs_steps INTEGER,
  fsrs_reps INTEGER,
  fsrs_lapses INTEGER,
  FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
);

CREATE TABLE IF NOT EXISTS kanji_unit_flags (
  unit_key TEXT PRIMARY KEY,
  known_forever INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
);

CREATE TABLE IF NOT EXISTS kanji_unit_tasks (
  reviewed_on TEXT NOT NULL,
  unit_key TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (reviewed_on, unit_key),
  FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
);

-- 单元事件日志是跨设备 replay 的事实来源；memory 是可重建 checkpoint。
CREATE TABLE IF NOT EXISTS kanji_unit_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_key TEXT NOT NULL,
  answer TEXT NOT NULL,
  reviewed_on TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  scheduler_mode TEXT NOT NULL DEFAULT 'normal',
  fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
);

CREATE INDEX IF NOT EXISTS idx_kanji_unit_tasks_day
  ON kanji_unit_tasks(reviewed_on, order_index);
CREATE INDEX IF NOT EXISTS idx_kanji_unit_reviews_unit_time
  ON kanji_unit_reviews(unit_key, reviewed_at, id);
