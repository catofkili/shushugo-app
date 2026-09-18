import { getDatabase } from "./database";
import type { WordAnswer } from "../types/vocabulary";
import type { FavoriteType, StudyAnswer } from "./study-types";
import { ensureLocalSchema } from "./database/schema";
import { ensureLegacyBiruMigration } from "./legacy-word-migrations";
import { ensureSyncSchema } from "./sync/schema";
import { CONTENT_MIGRATION_STATE_KEYS } from "./sync/tables";
import {
  firstValue,
  getState,
  persistContentSoon,
  rowsFor,
  setState
} from "./database/db-utils";

export {
  daysSince,
  firstRow,
  firstValue,
  getState,
  persistSoon,
  rowsFor,
  setState,
  studyDate,
  studyDayEnd,
  today,
  type DbRow,
  type SqlValue
} from "./database/db-utils";

type JlptWordSeedRow = readonly [
  meaning: string,
  kana: string,
  kanji: string,
  pos: string,
  verbType: string | null,
  importance: number,
  exampleJp: string,
  exampleMeaning: string,
  jlptLevel: string,
  exampleFurigana: string,
  exampleTokens: string,
  exampleLemmas: string
];

type GrammarSeedRow = [
  pattern: string,
  meaning: string,
  prompt: string,
  formation: string,
  exampleJp: string,
  exampleMeaning: string,
  notes: string,
  confusions: string,
  level: string,
  importance: number,
  exampleFurigana: string,
  exampleTokens: string,
  exampleLemmas: string
];

type DictionarySupplementEntry = {
  entryKey: string;
  headword: string;
  kana: string;
  meaning: string;
  pos: string;
  verbType: string | null;
  category: string;
  usageNote: string;
  exampleJp: string;
  exampleMeaning: string;
  priority: number;
};

type DictionarySupplementSeed = {
  version: string;
  source: {
    name: string;
    url: string;
    license: string;
  };
  entries: DictionarySupplementEntry[];
};

type JlptCollocationContentEntry = {
  surface: string;
  kana: string;
  level: "N1" | "N2" | "N3" | "N4" | "N5";
  kind: string;
  meaning: string;
  jmdict_ent_seq: number;
};

type JlptCollocationContent = {
  schema_version: number;
  status: string;
  reviewed_at: string;
  entries: JlptCollocationContentEntry[];
};


const JLPT_SEED_VERSION = "2026-06-15-jlpt10k";
// Keep this aligned with the metadata already baked into public/nihongo.db so
// a fresh install does not replay all 11k metadata updates on first launch.
// 与 scripts/build-furigana.mjs、scripts/bake-seed-db.mjs 保持一致。
export const FURIGANA_VERSION = "2026-08-15-kuromoji-ipadic-v5-bunsetsu-morph-v1";
const JLPT_WORD_METADATA_VERSION = `2026-09-19-manual-meanings-5163-polish-1130-corrections-35-distinction-1559-examples-320-audit-revert-73-${FURIGANA_VERSION}`;
// 这张表只给历史词库里没有 N1-N5 的词补级别。和 metadata 版本分开,
// 这样既有用户不用重放整套释义/例句迁移,又能让老库收到这次分类。
const JLPT_LEVEL_OVERRIDE_VERSION = "2026-08-21-unleveled-v1";
// 与 src/data/grammar_seed.json 的 version 字段保持一致。种子 JSON 只在版本
// 不匹配需要迁移时才动态加载,避免打进主 bundle。
export const GRAMMAR_SEED_VERSION = "2026-09-18-grammar-split-variants-v1";
/**
 * 种子里有多少条语法点。⚠️ 它不是装饰,是**版本戳撒谎时的唯一兜底**。
 *
 * `grammar_state` 走云同步,而 `dataset_version` 说的是「本机这份语法内容迁到哪一版」——
 * 对端写下的「已完成」落到一台还没跑过迁移的设备上,之后每次启动都在
 * 「版本号相等就返回」上早退,版本标记新、内容是旧的(比如仍是 731 条),而且永远不会自愈。
 * 现在导出/导入两侧都过滤掉这个键了,但已经被写坏的库还得能自己爬回来。
 *
 * 用行数当兜底而不是无条件重跑:重建那条路会 DELETE + 重排 id、清空
 * `grammar_state.queue`、再往 archive 里写一份 —— 只有真的对不上才值得付这个代价。
 * `verify-release-db.mjs` 会钉住这个常数 == 出厂库 == seed。
 */
export const GRAMMAR_SEED_ROW_COUNT = 769;
export const DICTIONARY_SUPPLEMENT_VERSION = "2026-08-16-handwritten-v1";
export const JLPT_COLLOCATION_CONTENT_VERSION = "2026-08-28-jlpt-collocations-zh-v1";

const loadJlptWordSeed = async (): Promise<JlptWordSeedRow[]> => {
  const payload = await import("../data/jlpt_words_seed.json");
  return payload.default as unknown as JlptWordSeedRow[];
};

type JlptMeaningOverride = { kanji: string; kana: string; meaning: string };
type JlptExampleOverride = {
  kanji: string;
  kana: string;
  exampleJp: string;
  exampleMeaning: string;
  exampleFurigana?: string | unknown[];
  exampleTokens?: string;
  exampleLemmas?: string;
};

type JlptLevelOverride = {
  kanji: string;
  kana: string;
  jlptLevel: "N1" | "N2" | "N3" | "N4" | "N5";
  basis: string;
};

type JlptLevelOverrideSeed = {
  version: string;
  official: false;
  source: {
    name: string;
    url: string;
    mirror: string;
    note: string;
  };
  rows: JlptLevelOverride[];
};

/**
 * 疑难辨析的分组键:冻结在 2026-09-16 的词典首义,只给 confusion-groups 分组用。
 * 分组算法按「首义相同」成组,而释义审校正是要把首义写得不一样 —— 分组直接读
 * words.meaning 的话,审校做得越好组散得越多,手写辨析稿就成幽灵 key。
 * 出厂库由 bake-seed-db.mjs 烧同一份;这里是给老用户的本地库补列。
 */
type WordSenseKey = [kanji: string, kana: string, senseKey: string];
const loadWordSenseKeys = async (): Promise<WordSenseKey[]> => {
  const payload = await import("../data/word_sense_keys.json");
  return payload.default as WordSenseKey[];
};
const applyWordSenseKeys = (rows: WordSenseKey[]): void => {
  const db = getDatabase();
  rows.forEach(([kanji, kana, senseKey]) => {
    db.run("UPDATE words SET sense_key = ? WHERE kanji = ? AND kana = ?", [senseKey, kanji, kana]);
  });
};

const loadJlptMeaningOverrides = async (): Promise<JlptMeaningOverride[]> => {
  const payload = await import("../data/jlpt_meaning_overrides.json");
  return payload.default as JlptMeaningOverride[];
};

// 生产库里有一批不在种子行里的历史词条,它们的例句没有任何下发路径 ——
// 种子迁移是按 seed 逐行 UPDATE 的,压根扫不到这些行。和手写释义一样单独走
// 一张按 (kanji, kana) 的覆盖表。
const loadJlptExampleOverrides = async (): Promise<JlptExampleOverride[]> => {
  const payload = await import("../data/jlpt_example_overrides.json");
  return payload.default as JlptExampleOverride[];
};

const loadJlptLevelOverrides = async (): Promise<JlptLevelOverrideSeed> => {
  const payload = await import("../data/jlpt_level_overrides.json");
  return payload.default as JlptLevelOverrideSeed;
};

const loadGrammarSeed = async (): Promise<{ version: string; rows: GrammarSeedRow[] }> => {
  const payload = await import("../data/grammar_seed.json");
  return payload.default as unknown as { version: string; rows: GrammarSeedRow[] };
};

const loadDictionarySupplementSeed = async (): Promise<DictionarySupplementSeed> => {
  const payload = await import("../data/dictionary_supplement_seed.json");
  return payload.default as DictionarySupplementSeed;
};

const loadJlptCollocationContent = async (): Promise<JlptCollocationContent> => {
  const payload = await import("../data/jlpt_collocation_content.json");
  return payload.default as JlptCollocationContent;
};

// 建表/索引是幂等的,但每次调用都重跑 10+ 条 DDL + PRAGMA 很浪费——
// isFavorite 等热路径每渲染一行都会走到这里。按 Database 实例记忆化;
// importDatabase 换新实例后 WeakSet 查不到,自然会对新库重跑一遍。
const schemaReadyDbs = new WeakSet<object>();

export const ensureUserTables = () => {
  const db = getDatabase();
  if (schemaReadyDbs.has(db)) return;
  ensureLocalSchema();
  const wordColumns = rowsFor("PRAGMA table_info(words)").map((row) => String(row.name ?? ""));
  if (!wordColumns.includes("jlpt_level")) {
    db.run("ALTER TABLE words ADD COLUMN jlpt_level TEXT");
  }
  if (!wordColumns.includes("example_furigana")) {
    db.run("ALTER TABLE words ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''");
  }
  if (!wordColumns.includes("example_tokens")) {
    db.run("ALTER TABLE words ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''");
  }
  if (!wordColumns.includes("example_lemmas")) {
    db.run("ALTER TABLE words ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''");
  }
  if (!wordColumns.includes("sense_key")) {
    db.run("ALTER TABLE words ADD COLUMN sense_key TEXT NOT NULL DEFAULT ''");
  }
  const grammarColumns = rowsFor("PRAGMA table_info(grammar_points)").map((row) => String(row.name ?? ""));
  if (!grammarColumns.includes("example_furigana")) {
    db.run("ALTER TABLE grammar_points ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''");
  }
  if (!grammarColumns.includes("example_tokens")) {
    db.run("ALTER TABLE grammar_points ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''");
  }
  if (!grammarColumns.includes("example_lemmas")) {
    db.run("ALTER TABLE grammar_points ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''");
  }
  const archiveColumns = rowsFor("PRAGMA table_info(grammar_points_archive)").map((row) => String(row.name ?? ""));
  if (!archiveColumns.includes("example_furigana")) {
    db.run("ALTER TABLE grammar_points_archive ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''");
  }
  if (!archiveColumns.includes("example_tokens")) {
    db.run("ALTER TABLE grammar_points_archive ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''");
  }
  if (!archiveColumns.includes("example_lemmas")) {
    db.run("ALTER TABLE grammar_points_archive ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''");
  }
  const positionColumns = rowsFor("PRAGMA table_info(grammar_reading_positions)").map((row) => String(row.name ?? ""));
  if (!positionColumns.includes("scroll_top")) {
    db.run("ALTER TABLE grammar_reading_positions ADD COLUMN scroll_top REAL NOT NULL DEFAULT 0");
  }
  // 复习流水现在记「哪个方向」:正向/反向/汉字是三张卡,顽固判定、连败保护、
  // 当日进度都要各算各的。老数据没有这一列,补上并一律算正向(以前只有正向记流水)。
  // 老库的收藏没有收藏夹这一列;'' = 未分类,和新建库的默认值一致。
  const favoriteColumns = rowsFor("PRAGMA table_info(content_favorites)").map((row) => String(row.name ?? ""));
  if (!favoriteColumns.includes("folder")) {
    db.run("ALTER TABLE content_favorites ADD COLUMN folder TEXT NOT NULL DEFAULT ''");
  }
  // 历史成绩表是这一版才加的，早一版建过表的库缺 levels_json 这一列
  const vocabColumns = rowsFor("PRAGMA table_info(vocab_test_history)").map((row) => String(row.name ?? ""));
  if (vocabColumns.length && !vocabColumns.includes("levels_json")) {
    db.run("ALTER TABLE vocab_test_history ADD COLUMN levels_json TEXT NOT NULL DEFAULT ''");
  }
  const reviewColumns = rowsFor("PRAGMA table_info(reviews)").map((row) => String(row.name ?? ""));
  if (!reviewColumns.includes("direction")) {
    db.run("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'");
  }
  db.run("CREATE INDEX IF NOT EXISTS idx_reviews_day_direction ON reviews(reviewed_on, direction)");
  // 周日 14:00 周期计时与周报快照属于用户库本地数据，旧库启动时幂等补齐。
  db.run(`
    CREATE TABLE IF NOT EXISTS study_time_by_period (
      period_start TEXT NOT NULL,
      device_id TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      sync_updated_at TEXT,
      sync_origin_device TEXT,
      PRIMARY KEY (period_start, device_id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)");
  db.run("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)");
  schemaReadyDbs.add(db);
};

// 启动时(App 渲染前)调用一次,完成建表与所有种子数据迁移。
// 之后同步路径里的 ensureUserTables 只做廉价的建表/索引检查。
/**
 * 一次性重检：把「本机内容迁到哪一版」的标记清掉，让下面的迁移重跑一遍。
 *
 * 这些标记以前会随用户快照跨设备同步（见 sync/tables.ts 的
 * CONTENT_MIGRATION_STATE_KEYS）。对端写下的「已完成」落到一台还没跑过迁移的
 * 设备上，之后每次启动都在同一个相等判断上早退 —— 版本标记是新的、词典是旧的，
 * 而且不会自己好。现在导出/导入两侧都过滤掉了，但已经写进去的值得清一次。
 *
 * 这里清的**只有 app_state 里那几个词典侧的标记**：它们对应的迁移都是"补行 / 补列"，
 * 幂等且只增不删，重跑一遍的代价只是一次启动慢一点。
 *
 * ⚠️ **`grammar_state.dataset_version` 不在这里清。** 语法那条重建会
 * `DELETE FROM grammar_points` + 重排 id + 清空 `grammar_state.queue` + 往 archive
 * 写一整份 —— 对没被写坏的库来说全是白付的代价和风险。那条改成自愈判据，
 * 见 `ensureGrammarSeed` 里的 `GRAMMAR_SEED_ROW_COUNT` 检查。
 */
const CONTENT_MARKER_REPAIR_VERSION = "2026-09-09-unsynced-content-markers-v1";

const repairSyncedContentMarkers = () => {
  if (getState("content_marker_repair", "") === CONTENT_MARKER_REPAIR_VERSION) return;
  for (const key of CONTENT_MIGRATION_STATE_KEYS) setState(key, "");
  setState("content_marker_repair", CONTENT_MARKER_REPAIR_VERSION);
};

export const ensureSeedData = async () => {
  ensureUserTables();
  // 先建同步触发器：旧 id 的删除必须留下墓碑，否则另一台设备会把重复词复活。
  ensureSyncSchema();
  repairSyncedContentMarkers();
  await ensureLegacyBiruMigration();
  await ensureDictionarySupplementSeed();
  await ensureJlptCollocationContent();
  await ensureGrammarSeed();
  await ensureJlptWordSeed();
  await ensureJlptLevelOverrides();
  await ensureFuriganaAnnotations();
};

// 固定搭配是 JLPT 主词库之后的第二层种子。它独立于 10k JLPT seed 版本，
// 这样已有用户不会因为基础词库版本已满足而永远收不到新增表达；只按表记＋读音
// 插入缺失行，不覆盖用户可能自行导入或改写的同形词条。
const ensureJlptCollocationContent = async () => {
  if (getState("jlpt_collocation_content_version", "") === JLPT_COLLOCATION_CONTENT_VERSION) return;

  const content = await loadJlptCollocationContent();
  if (content.status !== "content_ready_runtime_migration" || content.entries.length !== 882) {
    throw new Error(`固定搭配内容版本无效: status=${content.status} entries=${content.entries.length}`);
  }
  if (content.entries.some((entry) => !entry.surface || !entry.kana || !entry.meaning || !/^N[1-5]$/.test(entry.level))) {
    throw new Error("固定搭配内容存在缺少表记、读音、释义或等级的条目");
  }

  const db = getDatabase();
  const existing = new Set(
    rowsFor("SELECT kanji, kana FROM words")
      .map((row) => `${String(row.kanji ?? "")}\u0000${String(row.kana ?? "")}`)
  );
  const insertedIds: number[] = [];
  db.run("BEGIN TRANSACTION");
  try {
    content.entries.forEach((entry) => {
      const key = `${entry.surface}\u0000${entry.kana}`;
      if (existing.has(key)) return;
      db.run(`
        INSERT INTO words (
          meaning, kana, kanji, pos, verb_type, importance,
          shuffle_rank, example_jp, example_meaning, example_furigana, example_tokens, example_lemmas, jlpt_level
        )
        VALUES (?, ?, ?, ?, NULL, ?, ABS(RANDOM()) / 9223372036854775807.0, '', '', '', '', '', ?)
      `, [entry.meaning, entry.kana, entry.surface, "固定搭配", 3, entry.level]);
      const newId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
      if (newId > 0) insertedIds.push(newId);
      existing.add(key);
    });
    insertedIds.forEach((wordId) => db.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [wordId]));
    setState("jlpt_collocation_content_version", JLPT_COLLOCATION_CONTENT_VERSION);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistContentSoon();
};

const ensureDictionarySupplementSeed = async () => {
  const installedVersion = getState("dictionary_supplement_version", "");
  const installedCount = firstValue<number>(
    "SELECT COUNT(*) FROM dictionary_entries WHERE entry_key LIKE 'builtin:%'",
    [],
    0
  );
  if (installedVersion === DICTIONARY_SUPPLEMENT_VERSION && installedCount === 21) return;

  const seed = await loadDictionarySupplementSeed();
  if (seed.version !== DICTIONARY_SUPPLEMENT_VERSION) {
    throw new Error(`补充词典版本不一致: ${seed.version} != ${DICTIONARY_SUPPLEMENT_VERSION}`);
  }
  if (seed.entries.length !== 21) {
    throw new Error(`补充词典条数异常: ${seed.entries.length} != 21`);
  }

  const db = getDatabase();
  db.run("BEGIN TRANSACTION");
  try {
    // 只替换应用内置行，保留未来可能由用户导入的非 builtin 条目。
    db.run("DELETE FROM dictionary_entries WHERE entry_key LIKE 'builtin:%'");
    seed.entries.forEach((entry) => {
      db.run(`
        INSERT INTO dictionary_entries (
          entry_key, headword, kana, meaning, pos, verb_type, category,
          usage_note, example_jp, example_meaning, priority,
          source_name, source_url, license, seed_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        entry.entryKey,
        entry.headword,
        entry.kana,
        entry.meaning,
        entry.pos,
        entry.verbType,
        entry.category,
        entry.usageNote,
        entry.exampleJp,
        entry.exampleMeaning,
        entry.priority,
        seed.source.name,
        seed.source.url,
        seed.source.license,
        seed.version
      ]);
    });
    setState("dictionary_supplement_version", seed.version);
    db.run("COMMIT");
    persistContentSoon();
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
};

export const isFavorite = (type: FavoriteType, id: string | number) => {
  ensureUserTables();
  return Boolean(firstValue<number>(
    "SELECT 1 FROM content_favorites WHERE item_type = ? AND item_id = ? LIMIT 1",
    [type, String(id)],
    0
  ));
};

const GRAMMAR_PROGRESS_TABLES = ["grammar_progress", "grammar_reviews", "grammar_mistakes"] as const;
// 迁移期间把旧 grammar_id 挪出正常取值范围,避免新旧 id 数值重叠时串数据。
const GRAMMAR_ID_OFFSET = 1_000_000;
/**
 * 升版本时按 pattern 迁移进度，改过标题的条目要在这里登记旧名 → 新名，
 * 否则用户在它上面的进度会被当成「新版本里已经不存在的语法点」删掉。
 *
 * 2026-09-18 把「A／B」两个写法拆成两条（见 scripts/grammar-variant-splits.json）：
 * 旧进度归第一个写法，第二个写法作为新条目从零开始 —— 拆的理由正是
 * 「看到 A 就点了认识，B 其实不会」，所以 B 不该继承 A 的 FSRS 状态。
 */
const GRAMMAR_PATTERN_RENAMES: Record<string, string> = {
  "誰／どなた／どの方": "誰",
  "どう／いかが": "どう",
  "なぜ／どうして／なんで": "なぜ",
  "かな／かしら": "かな",
  "～たち／がた": "～たち",
  "～だろう／でしょう": "～だろう",
  "あげる／さしあげる": "あげる",
  "～てあげる／てさしあげる": "～てあげる",
  "もらう／いただく": "もらう",
  "～てもらう／ていただく": "～てもらう",
  "くれる／くださる": "くれる",
  "～てくれる／てくださる": "～てくれる",
  "～うちは／ないうちに": "～うちは",
  "～てしかた（が）ない／てしようがない": "～てしかた（が）ない",
  "～てもしかた（が）ない／てもしようがない": "～てもしかた（が）ない",
  "～というのは／とは": "～というのは",
  "～なんか／なんて": "～なんか",
  "～ていらっしゃる／ておいでになる": "～ていらっしゃる",
  "～かねる／かねない": "～かねる",
  "～次第／次第だ／次第で（は）": "～次第",
  "～だけあって／だけに／だけのことはある": "～だけあって",
  "～はもちろん／はもとより": "～はもちろん",
  // N3 那条「～とは」（下定义）排在前面，N1 这条（吃惊）拿到重名后缀
  "～とは／なんて": "～とは（N1-2）",
  "～とはいうものの／とは言い条": "～とはいうものの",
  "～にたえる／にたえない": "～にたえる",
  "～や／や否や": "～や"
};

const ensureGrammarSeed = async () => {
  const db = getDatabase();
  const grammarVersion = firstValue<string>("SELECT value FROM grammar_state WHERE key = ?", ["dataset_version"], "");
  // 版本戳对上还不够,内容也得真在(见 GRAMMAR_SEED_ROW_COUNT)。COUNT 很便宜,
  // 而且这样是自愈的 —— 不需要一次性的修复代码,以后再被写坏也能自己爬回来。
  if (grammarVersion === GRAMMAR_SEED_VERSION
    && firstValue<number>("SELECT COUNT(*) FROM grammar_points", [], 0) === GRAMMAR_SEED_ROW_COUNT) return;

  const grammarSeed = await loadGrammarSeed();
  // ⚠️ 这条只挡「常量落后于 JSON」这一种情况(库版本 == JSON 版本 != 常量)。
  // 不带后半个条件的话,上面那条按条数的自愈判据永远走不到重建 —— 版本三者相等、
  // 条数少了 10 条的库,会在这里原地 return 并打一句误导的「常量落后」。
  if (grammarSeed.version === grammarVersion && grammarVersion !== GRAMMAR_SEED_VERSION) {
    console.warn(`GRAMMAR_SEED_VERSION 常量(${GRAMMAR_SEED_VERSION})落后于 grammar_seed.json(${grammarSeed.version}),请更新常量。`);
    return;
  }

  db.run("BEGIN TRANSACTION");
  try {
    const oldIdByPattern = new Map<string, number>();
    rowsFor("SELECT id, pattern FROM grammar_points").forEach((row) => {
      oldIdByPattern.set(String(row.pattern ?? ""), Number(row.id));
    });

    if (oldIdByPattern.size > 0) {
      db.run(`
        INSERT INTO grammar_points_archive (
          dataset_version, id, pattern, meaning, prompt, formation,
          example_jp, example_meaning, notes, confusions, level,
          importance, example_furigana, example_tokens, example_lemmas, sort_order
        )
        SELECT ?, id, pattern, meaning, prompt, formation, example_jp,
          example_meaning, notes, confusions, level, importance, example_furigana, example_tokens, example_lemmas, sort_order
        FROM grammar_points
      `, [grammarVersion || "legacy-before-pdf-n4"]);
    }

    db.run("DELETE FROM grammar_points");
    // ⚠️ AUTOINCREMENT 在 DELETE 之后接着上次的最大值往下编，不重置的话重建出来的 id
    // 是 742..、1483..（实测一台设备重建九次后 id 落在 6600+），和新装用户的 1..N
    // 永远对不上 —— 而 grammar_progress 正是按数字 grammar_id 跨设备同步的。
    // 重置之后 id = 种子行号 = 出厂库的 id（build-furigana.mjs 用同一个顺序编号）。
    db.run("DELETE FROM sqlite_sequence WHERE name = 'grammar_points'");
    const newIdByPattern = new Map<string, number>();
    grammarSeed.rows.forEach((row, index) => {
      // pattern 带 UNIQUE 约束;种子数据里同一 pattern 出现多次时保留第一条,
      // 否则整个初始化事务回滚,全新安装直接起不来。
      if (newIdByPattern.has(row[0])) {
        console.warn(`grammar_seed 存在重复 pattern,已跳过后出现的一条: ${row[0]}`);
        return;
      }
      db.run(`
        INSERT INTO grammar_points (
          pattern, meaning, prompt, formation, example_jp, example_meaning,
          notes, confusions, level, importance, example_furigana, example_tokens, example_lemmas, sort_order
        )
        -- ⚠️ 14 个列名就要 14 个占位符。这里曾经只有 13 个,而种子行是 13 个字段
        -- 加上 sort_order 正好 14 个值 —— 少一个 ? 就是 "13 values for 14 columns",
        -- 而且这段只在**语法种子升版本**时才跑,所以从写下来到 2026-08-23 一次都没执行过。
        -- 真升一次版本的话,每个已安装用户启动时都会崩在 initDatabase(界面显示
        -- 「本地词库读取失败」),等于一次内容更新把所有人的 App 变砖。
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [...row, index + 1]);
      newIdByPattern.set(row[0], firstValue<number>("SELECT last_insert_rowid()", [], 0));
    });

    // 按 pattern 把用户的语法进度/复习记录/错题迁移到新 id;只清掉新版本里
    // 已经不存在的语法点,而不是整体清空。
    GRAMMAR_PROGRESS_TABLES.forEach((table) => {
      db.run(`UPDATE ${table} SET grammar_id = grammar_id + ${GRAMMAR_ID_OFFSET}`);
    });
    oldIdByPattern.forEach((oldId, pattern) => {
      const newId = newIdByPattern.get(GRAMMAR_PATTERN_RENAMES[pattern] ?? pattern);
      if (!newId) return;
      GRAMMAR_PROGRESS_TABLES.forEach((table) => {
        db.run(`UPDATE ${table} SET grammar_id = ? WHERE grammar_id = ?`, [newId, oldId + GRAMMAR_ID_OFFSET]);
      });
    });
    GRAMMAR_PROGRESS_TABLES.forEach((table) => {
      db.run(`DELETE FROM ${table} WHERE grammar_id >= ${GRAMMAR_ID_OFFSET}`);
    });

    db.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)", ["queue", "[]"]);
    // 考题的撤销栈和当天重刷队列里存的是旧 id：重建后按旧 id 撤销会删掉一条已经迁走的流水，
    // 而计数一个都退不回去。清掉比留着强 —— 它们本来就只管当天。
    db.run("DELETE FROM grammar_state WHERE key LIKE 'quiz_undo:%'");
    setState("review_queue_grammar", "[]");
    db.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)", ["dataset_version", grammarSeed.version]);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistContentSoon();
};

// 注音是内容元数据，不应触发语法点重排或迁移学习进度。老用户只需在
// 现有 grammar_points 上按「pattern + 例句」补这一列；新装库则由 grammar_seed
// 的同一列直接带入。版本单独存放，避免把 furigana 当成语法数据版本。
const ensureFuriganaAnnotations = async () => {
  if (getState("furigana_version", "") === FURIGANA_VERSION) return;
  const grammarSeed = await loadGrammarSeed();
  const db = getDatabase();
  db.run("BEGIN TRANSACTION");
  try {
    grammarSeed.rows.forEach((row) => {
      const [pattern, , , , exampleJp, , , , , , exampleFurigana, exampleTokens, exampleLemmas] = row;
      db.run(`
        UPDATE grammar_points
        SET example_furigana = ?, example_tokens = ?, example_lemmas = ?
        WHERE pattern = ?
          AND example_jp = ?
      `, [exampleFurigana ?? "", exampleTokens ?? "", exampleLemmas ?? "", pattern, exampleJp]);
    });
    setState("furigana_version", FURIGANA_VERSION);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistContentSoon();
};

const nounSuruCorrections: [string, string][] = [
  ["運動", "うんどう"],
  ["計画", "けいかく"],
  ["研究", "けんきゅう"],
  ["故障", "こしょう"],
  ["授業", "じゅぎょう"],
  ["生活", "せいかつ"],
  ["選択", "せんたく"],
  ["卒業", "そつぎょう"],
  ["留学", "りゅうがく"],
  ["旅行", "りょこう"],
  ["練習", "れんしゅう"],
  ["連絡", "れんらく"],
  ["遅刻", "ちこく"],
  ["出発", "しゅっぱつ"],
  ["到着", "とうちゃく"],
  ["見学", "けんがく"],
  ["復習", "ふくしゅう"],
  ["予習", "よしゅう"],
  ["予約", "よやく"],
  ["翻訳", "ほんやく"],
  ["信号", "しんごう"],
  ["洗濯", "せんたく"],
  ["勉強", "べんきょう"],
  ["活動", "かつどう"],
  ["帰国", "きこく"],
  ["挨拶", "あいさつ"],
  ["営業", "えいぎょう"],
  ["希望", "きぼう"],
  ["成功", "せいこう"],
  ["入学", "にゅうがく"],
  ["約束", "やくそく"],
  ["利用", "りよう"],
  ["急行", "きゅうこう"],
  ["協力", "きょうりょく"],
  ["教育", "きょういく"],
  ["緊張", "きんちょう"],
  ["行動", "こうどう"],
  ["信用", "しんよう"],
  ["努力", "どりょく"],
  ["輸出", "ゆしゅつ"],
  ["輸入", "ゆにゅう"],
  ["冷蔵", "れいぞう"],
  ["朝寝坊", "あさねぼう"],
  ["誕生", "たんじょう"],
  ["飲食", "いんしょく"],
  ["出張", "しゅっちょう"],
  ["ごちそう", "ごちそう"],
  ["影響", "えいきょう"],
  ["遠足", "えんそく"],
  ["学習", "がくしゅう"],
  ["観光", "かんこう"],
  ["競争", "きょうそう"],
  ["見物", "けんぶつ"],
  ["合格", "ごうかく"],
  ["集合", "しゅうごう"],
  ["体操", "たいそう"],
  ["暖房", "だんぼう"],
  ["報告", "ほうこく"],
  ["放送", "ほうそう"],
  ["提出", "ていしゅつ"],
  ["転職", "てんしょく"],
  ["優勝", "ゆうしょう"],
  ["外出", "がいしゅつ"],
  ["研修", "けんしゅう"],
  ["広告", "こうこく"],
  ["残業", "ざんぎょう"],
  ["就職", "しゅうしょく"],
  ["彫刻", "ちょうこく"],
  ["流行", "りゅうこう"],
  ["担当", "たんとう"],
  ["企画", "きかく"],
  ["泥棒", "どろぼう"],
  ["看病", "かんびょう"]
];

const syncJlptWordMetadata = (
  jlptWordSeed: JlptWordSeedRow[],
  meaningOverrides: JlptMeaningOverride[] = [],
  exampleOverrides: JlptExampleOverride[] = []
) => {
  const db = getDatabase();
  const syncedKeys = new Set<string>();
  const meaningByKey = new Map(
    meaningOverrides.map(({ kanji, kana, meaning }) => [`${kanji}\u0000${kana}`, meaning])
  );
  jlptWordSeed.forEach(([, kana, kanji, pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel, exampleFurigana, exampleTokens, exampleLemmas]) => {
    const key = `${kanji}\u0000${kana}`;
    if (syncedKeys.has(key)) return;
    syncedKeys.add(key);
    db.run(`
      UPDATE words
      SET meaning = COALESCE(?, meaning),
          pos = ?,
          verb_type = ?,
          importance = MAX(importance, ?),
          example_jp = ?,
          example_meaning = ?,
          example_furigana = COALESCE(NULLIF(?, ''), example_furigana),
          example_tokens = COALESCE(NULLIF(?, ''), example_tokens),
          example_lemmas = COALESCE(NULLIF(?, ''), example_lemmas),
          jlpt_level = COALESCE(jlpt_level, ?)
      WHERE kanji = ? AND kana = ?
    `, [meaningByKey.get(key) ?? null, pos, verbType, importance, exampleJp, exampleMeaning, exampleFurigana ?? "", exampleTokens ?? "", exampleLemmas ?? "", jlptLevel, kanji, kana]);
  });
  // 覆盖表还包含不在 JLPT seed 行里的词形（例如异体字），单独回写避免
  // 老用户迁移时只同步 seed 而漏掉这些释义。
  meaningByKey.forEach((meaning, key) => {
    const separator = key.indexOf("\u0000");
    const kanji = key.slice(0, separator);
    const kana = key.slice(separator + 1);
    db.run("UPDATE words SET meaning = ? WHERE kanji = ? AND kana = ?", [meaning, kanji, kana]);
  });
  // 只补空缺,绝不覆盖已有例句。
  exampleOverrides.forEach(({ kanji, kana, exampleJp, exampleMeaning, exampleFurigana, exampleTokens, exampleLemmas }) => {
    const furigana = typeof exampleFurigana === "string"
      ? exampleFurigana
      : JSON.stringify(exampleFurigana ?? []);
    db.run(`
      UPDATE words
      SET example_jp = ?, example_meaning = ?,
          example_furigana = COALESCE(NULLIF(?, ''), example_furigana),
          example_tokens = COALESCE(NULLIF(?, ''), example_tokens),
          example_lemmas = COALESCE(NULLIF(?, ''), example_lemmas)
      WHERE kanji = ? AND kana = ?
        AND (example_jp IS NULL OR example_jp = '')
    `, [exampleJp, exampleMeaning, furigana, typeof exampleTokens === "string" ? exampleTokens : "", typeof exampleLemmas === "string" ? exampleLemmas : "", kanji, kana]);
  });
  db.run(`
    UPDATE words
    SET pos = '名词',
        verb_type = NULL
    WHERE pos = '名词・する动词'
      AND (
        (kanji = '戦争' AND kana = 'せんそう') OR
        (kanji = 'チェック' AND kana = 'チェック') OR
        (kanji = 'コピー' AND kana = 'コピー')
      )
  `);
  nounSuruCorrections.forEach(([kanji, kana]) => {
    db.run(`
      UPDATE words
      SET pos = '名词・する动词',
          verb_type = 'suru'
      WHERE kanji = ?
        AND kana = ?
        AND pos = '动词'
        AND verb_type = 'godan'
    `, [kanji, kana]);
  });
  setState("jlpt_word_metadata_version", JLPT_WORD_METADATA_VERSION);
};

/**
 * 片假名词读音修正(2026-07-31)。
 *
 * 词库里有 199 条外来语/片假名词的读音被写成了平假名(エスカレーター 的读音写成
 * えすかれーたー、瑞西(スイス)写成 すいす),卡片上显示的写法是错的。
 *
 * 出厂词库已经改好,但**老用户的本地库是安装时拷过去的,不会跟着变** —— 必须靠这个
 * 迁移逐条更新。按「表记 + 旧读音」定位而不是 word_id:本地库可能来自导入或合并,
 * id 不一定对得上。
 *
 * 读音是音频文件名和音高表的索引键的一部分,所以这一步跑完读音才能对上新音频。
 */
const KANA_READING_FIX_VERSION = "2026-07-31-katakana-readings";

const ensureKatakanaReadings = async () => {
  if (getState("kana_reading_fix_version", "") === KANA_READING_FIX_VERSION) return;
  const payload = await import("../data/kana_reading_fixes.json");
  const fixes = ((payload.default as { fixes: string[][] }).fixes ?? []) as string[][];
  const db = getDatabase();
  db.run("BEGIN TRANSACTION");
  try {
    fixes.forEach(([kanji, from, to]) => {
      if (kanji && from && to) db.run("UPDATE words SET kana = ? WHERE kanji = ? AND kana = ?", [to, kanji, from]);
    });
    setState("kana_reading_fix_version", KANA_READING_FIX_VERSION);
    db.run("COMMIT");
    persistContentSoon(); // 不落盘的话版本号也不会留下,下次启动又跑一遍
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
};

const ensureJlptWordMetadata = async () => {
  if (getState("jlpt_word_metadata_version", "") === JLPT_WORD_METADATA_VERSION) return;
  const jlptWordSeed = await loadJlptWordSeed();
  const meaningOverrides = await loadJlptMeaningOverrides();
  const exampleOverrides = await loadJlptExampleOverrides();
  const senseKeys = await loadWordSenseKeys();
  const db = getDatabase();
  db.run("BEGIN TRANSACTION");
  try {
    syncJlptWordMetadata(jlptWordSeed, meaningOverrides, exampleOverrides);
    applyWordSenseKeys(senseKeys);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistContentSoon();
};

const ensureJlptLevelOverrides = async () => {
  if (getState("jlpt_level_override_version", "") === JLPT_LEVEL_OVERRIDE_VERSION) return;

  const seed = await loadJlptLevelOverrides();
  if (seed.version !== JLPT_LEVEL_OVERRIDE_VERSION) {
    throw new Error(`JLPT 词级别覆盖版本不一致: ${seed.version} != ${JLPT_LEVEL_OVERRIDE_VERSION}`);
  }
  if (seed.rows.length !== 320) {
    throw new Error(`JLPT 词级别覆盖条数异常: ${seed.rows.length} != 320`);
  }

  const db = getDatabase();
  db.run("BEGIN TRANSACTION");
  try {
    seed.rows.forEach(({ kanji, kana, jlptLevel }) => {
      // 只补空缺,不覆盖用户库里已经存在的级别。
      db.run(`
        UPDATE words
        SET jlpt_level = ?
        WHERE kanji = ?
          AND kana = ?
          AND (jlpt_level IS NULL OR jlpt_level NOT IN ('N1', 'N2', 'N3', 'N4', 'N5'))
      `, [jlptLevel, kanji, kana]);
    });
    setState("jlpt_level_override_version", JLPT_LEVEL_OVERRIDE_VERSION);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistContentSoon();
};

const ensureJlptWordSeed = async () => {
  await ensureKatakanaReadings();
  if (getState("jlpt_seed_version", "") === JLPT_SEED_VERSION) {
    await ensureJlptWordMetadata();
    return;
  }
  const total = firstValue<number>("SELECT COUNT(*) FROM words", [], 0);
  const hasEnoughLevels = firstValue<number>(
    "SELECT COUNT(*) FROM words WHERE jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')",
    [],
    0
  ) >= 10000;
  if (total >= 10000 && hasEnoughLevels) {
    await ensureJlptWordMetadata();
    setState("jlpt_seed_version", JLPT_SEED_VERSION);
    persistContentSoon();
    return;
  }

  const jlptWordSeed = await loadJlptWordSeed();
  const meaningOverrides = await loadJlptMeaningOverrides();
  const exampleOverrides = await loadJlptExampleOverrides();
  const senseKeys = await loadWordSenseKeys();
  const db = getDatabase();
  const existing = new Map<string, number>();
  rowsFor("SELECT id, kanji, kana FROM words").forEach((row) => {
    existing.set(`${String(row.kanji ?? "")}\u0000${String(row.kana ?? "")}`, Number(row.id));
  });

  db.run("BEGIN TRANSACTION");
  try {
    jlptWordSeed.forEach(([meaning, kana, kanji, pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel, exampleFurigana, exampleTokens, exampleLemmas]) => {
      const key = `${kanji}\u0000${kana}`;
      const existingId = existing.get(key);
      if (existingId) {
        db.run(`
          UPDATE words
          SET jlpt_level = COALESCE(jlpt_level, ?),
              importance = MAX(importance, ?)
          WHERE id = ?
        `, [jlptLevel, importance, existingId]);
        return;
      }
      db.run(`
        INSERT INTO words (
          meaning, kana, kanji, pos, verb_type, importance,
          shuffle_rank, example_jp, example_meaning, example_furigana, example_tokens, example_lemmas, jlpt_level
        )
        VALUES (?, ?, ?, ?, ?, ?, ABS(RANDOM()) / 9223372036854775807.0, ?, ?, ?, ?, ?, ?)
      `, [meaning, kana, kanji, pos, verbType, importance, exampleJp, exampleMeaning, exampleFurigana ?? "", exampleTokens ?? "", exampleLemmas ?? "", jlptLevel]);
      const newId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
      existing.set(key, newId);
    });
    db.run("INSERT OR IGNORE INTO progress (word_id) SELECT id FROM words");
    syncJlptWordMetadata(jlptWordSeed, meaningOverrides, exampleOverrides);
    applyWordSenseKeys(senseKeys);
    setState("jlpt_seed_version", JLPT_SEED_VERSION);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistContentSoon();
};

export const randomBetween = (min: number, max: number) => {
  return min + Math.floor(Math.random() * (max - min + 1));
};

/**
 * 会话内计数器的增减量 —— **不是**记忆强度。
 *
 * 长期调度已完全交给 FSRS(stability/difficulty/due)。这张表只剩一个用途:
 * stage2 反向阶段和汉字阶段的 temp_score(「这一轮答到 10 分算过」),
 * 用来决定当前这一轮里还要不要再考一次,当天结束即失效。
 */
export const sessionScoreDelta: Record<WordAnswer, number> = {
  forgot: -10,
  fuzzy: -2,
  know: 10,
  known_forever: 10
};

export const answerLabel: Record<StudyAnswer, string> = {
  forgot: "忘记",
  fuzzy: "模糊",
  know: "认识",
  known_forever: "熟知"
};
