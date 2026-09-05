/**
 * 「哪些表装的是用户学习数据」—— 出厂词库泄漏守卫的**唯一**一份清单。
 *
 * 以前这份清单在四个地方各抄了一份（bake-seed-db / build-furigana /
 * rewrite-independent-examples / verify-release-db），于是它们**互相之间就已经对不上**：
 * 有的漏 `word_question_meanings`、有的漏 `dictionary_discovered_words`，
 * 而四份全都漏掉了 `achievements`、`content_favorites`、`reverse_memory`、
 * `kanji_reading_memory`、`moments`、`grammar_highlights` 等 16 张同步表。
 * 也就是说，这道防线从来没有覆盖过成就、收藏、反向记忆和汉字读音记忆。
 *
 * 手抄清单必然漂移，所以改成一份 + 一条测试：
 * `src/lib/sync/user-data-tables.test.ts` 断言这份清单是 `SYNCED_TABLES` 的超集，
 * 以后**新加一张同步表却忘了登记，测试会红**。
 */

/** 只要有行就是用户数据的表。 */
export const USER_DATA_TABLES = [
  // 词
  "progress", "reviews", "checkins", "critical_reviews", "word_notes",
  "word_study_time", "word_study_time_by_device", "word_question_meanings",
  "stage1_tasks", "stage2_progress", "reverse_memory", "confusion_mastered",
  "dictionary_discovered_words", "moji_migrated_reviews",
  // 汉字
  "kanji_progress", "kanji_memory", "kanji_char_overrides",
  "kanji_reading_memory", "kanji_reading_progress",
  "kanji_unit_memory", "kanji_unit_flags", "kanji_unit_tasks", "kanji_unit_reviews",
  // 语法
  "grammar_progress", "grammar_reviews", "grammar_mistakes",
  "grammar_points_archive", "grammar_highlights", "grammar_reading_positions",
  // 其它
  "achievements", "content_favorites", "favorite_folders", "moments", "vocab_test_history"
];

/**
 * 同步基础设施表。**同样不许发出去**，但它们不在 `SYNCED_TABLES` 里
 * （它们是同步机制本身，不是被同步的业务表），所以「守卫清单 ⊇ 同步表」这条
 * 断言覆盖不到它们 —— 实测活库里 `sync_tombstones` 有 4,741 行删除记录（带 word_id）、
 * `sync_device` 有 1 行设备标识。必须单列。
 */
export const SYNC_INFRA_TABLES = ["sync_device", "sync_tombstones", "sync_context"];

/**
 * 出厂内容表：这些表**有行是正常的**，它们就是要发出去的东西。
 * 任何一张表要么在这里，要么在上面的用户数据清单里 —— 两边都不在的，
 * 就是没人登记过的新表，`verify-release-db.mjs` 会当场拒绝构建。
 */
export const FACTORY_CONTENT_TABLES = [
  "words", "grammar_points", "dictionary_entries", "kanji_units", "sqlite_sequence"
];

/**
 * key-value 状态表：出厂库里**合法地**带着内容版本戳，不能整表判定。
 * 只有不在允许名单里的 key 才算用户数据。
 */
export const STATE_TABLES = ["app_state", "grammar_state"];

export const ALLOWED_STATE_KEYS = new Set([
  "furigana_version",
  "jlpt_word_metadata_version",
  "jlpt_level_override_version",
  "jlpt_seed_version",
  "jlpt_example_version",
  "dictionary_supplement_version",
  "dataset_version"
]);

/**
 * 逐表数用户数据行数。`count(sql)` 由调用方给（各脚本的 sql.js 实例不同）。
 * 表不存在 = 这份库还没升到那一版 schema，等价于空 —— 但清单本身必须是全的。
 */
export const findPopulatedUserTables = (count) => {
  const safeCount = (sql) => {
    try {
      return Number(count(sql)) || 0;
    } catch {
      return 0;
    }
  };
  const rows = [...USER_DATA_TABLES, ...SYNC_INFRA_TABLES]
    .map((table) => [table, safeCount(`SELECT COUNT(*) FROM ${table}`)]);
  const keys = [...ALLOWED_STATE_KEYS].map((key) => `'${key}'`).join(", ");
  STATE_TABLES.forEach((table) => {
    rows.push([table, safeCount(`SELECT COUNT(*) FROM ${table} WHERE key NOT IN (${keys})`)]);
  });
  return rows.filter(([, n]) => n > 0);
};

/**
 * 出厂库里出现了一张谁也没登记过的表 —— 那就是下一个泄漏。
 * `listTables()` 由调用方给（各脚本的 sql.js 实例不同），返回库里所有表名。
 */
export const unregisteredTables = (listTables) => {
  const known = new Set([
    ...USER_DATA_TABLES, ...SYNC_INFRA_TABLES, ...STATE_TABLES, ...FACTORY_CONTENT_TABLES
  ]);
  return listTables().filter((table) => !known.has(table) && !table.startsWith("sqlite_"));
};
