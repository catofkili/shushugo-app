import { getDatabase } from "./database";
import type { WordAnswer } from "../types/vocabulary";
import type { FavoriteType, StudyAnswer } from "./study-types";
import { ensureLocalSchema } from "./database/schema";
import { ensureLegacyBiruMigration } from "./legacy-word-migrations";
import { ensureSyncSchema } from "./sync/schema";
import {
  firstValue,
  getState,
  persistSoon,
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


const JLPT_SEED_VERSION = "2026-06-15-jlpt10k";
// Keep this aligned with the metadata already baked into public/nihongo.db so
// a fresh install does not replay all 11k metadata updates on first launch.
// 与 scripts/build-furigana.mjs、scripts/bake-seed-db.mjs 保持一致。
export const FURIGANA_VERSION = "2026-08-15-kuromoji-ipadic-v5-bunsetsu-morph-v1";
const JLPT_WORD_METADATA_VERSION = `2026-08-11-manual-meanings-5163-polish-1130-corrections-35-examples-121-${FURIGANA_VERSION}`;
// 与 src/data/grammar_seed.json 的 version 字段保持一致。种子 JSON 只在版本
// 不匹配需要迁移时才动态加载,避免打进主 bundle。
export const GRAMMAR_SEED_VERSION = "2026-08-15-grammar-rewrite-v2";
export const DICTIONARY_SUPPLEMENT_VERSION = "2026-08-16-handwritten-v1";

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

const loadGrammarSeed = async (): Promise<{ version: string; rows: GrammarSeedRow[] }> => {
  const payload = await import("../data/grammar_seed.json");
  return payload.default as unknown as { version: string; rows: GrammarSeedRow[] };
};

const loadDictionarySupplementSeed = async (): Promise<DictionarySupplementSeed> => {
  const payload = await import("../data/dictionary_supplement_seed.json");
  return payload.default as DictionarySupplementSeed;
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
  const reviewColumns = rowsFor("PRAGMA table_info(reviews)").map((row) => String(row.name ?? ""));
  if (!reviewColumns.includes("direction")) {
    db.run("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'");
  }
  db.run("CREATE INDEX IF NOT EXISTS idx_reviews_day_direction ON reviews(reviewed_on, direction)");
  db.run("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)");
  db.run("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)");
  schemaReadyDbs.add(db);
};

// 启动时(App 渲染前)调用一次,完成建表与所有种子数据迁移。
// 之后同步路径里的 ensureUserTables 只做廉价的建表/索引检查。
export const ensureSeedData = async () => {
  ensureUserTables();
  // 先建同步触发器：旧 id 的删除必须留下墓碑，否则另一台设备会把重复词复活。
  ensureSyncSchema();
  await ensureLegacyBiruMigration();
  await ensureDictionarySupplementSeed();
  await ensureGrammarSeed();
  await ensureJlptWordSeed();
  await ensureFuriganaAnnotations();
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
    persistSoon();
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

const ensureGrammarSeed = async () => {
  const db = getDatabase();
  const grammarVersion = firstValue<string>("SELECT value FROM grammar_state WHERE key = ?", ["dataset_version"], "");
  if (grammarVersion === GRAMMAR_SEED_VERSION) return;

  const grammarSeed = await loadGrammarSeed();
  if (grammarSeed.version === grammarVersion) {
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [...row, index + 1]);
      newIdByPattern.set(row[0], firstValue<number>("SELECT last_insert_rowid()", [], 0));
    });

    // 按 pattern 把用户的语法进度/复习记录/错题迁移到新 id;只清掉新版本里
    // 已经不存在的语法点,而不是整体清空。
    GRAMMAR_PROGRESS_TABLES.forEach((table) => {
      db.run(`UPDATE ${table} SET grammar_id = grammar_id + ${GRAMMAR_ID_OFFSET}`);
    });
    oldIdByPattern.forEach((oldId, pattern) => {
      const newId = newIdByPattern.get(pattern);
      if (!newId) return;
      GRAMMAR_PROGRESS_TABLES.forEach((table) => {
        db.run(`UPDATE ${table} SET grammar_id = ? WHERE grammar_id = ?`, [newId, oldId + GRAMMAR_ID_OFFSET]);
      });
    });
    GRAMMAR_PROGRESS_TABLES.forEach((table) => {
      db.run(`DELETE FROM ${table} WHERE grammar_id >= ${GRAMMAR_ID_OFFSET}`);
    });

    db.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)", ["queue", "[]"]);
    db.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)", ["dataset_version", grammarSeed.version]);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistSoon();
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
  persistSoon();
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
    persistSoon(); // 不落盘的话版本号也不会留下,下次启动又跑一遍
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
  const db = getDatabase();
  db.run("BEGIN TRANSACTION");
  try {
    syncJlptWordMetadata(jlptWordSeed, meaningOverrides, exampleOverrides);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistSoon();
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
    persistSoon();
    return;
  }

  const jlptWordSeed = await loadJlptWordSeed();
  const meaningOverrides = await loadJlptMeaningOverrides();
  const exampleOverrides = await loadJlptExampleOverrides();
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
    setState("jlpt_seed_version", JLPT_SEED_VERSION);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistSoon();
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
