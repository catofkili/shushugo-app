import { getDatabase } from "./database";
import type { WordAnswer } from "../types/vocabulary";
import type { FavoriteType, StudyAnswer } from "./study-types";
import { ensureLocalSchema } from "./database/schema";
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
  jlptLevel: string
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
  importance: number
];

export const CRITICAL_SCORE = -20;
export const DAILY_DECAY_FLOOR = -9;

const JLPT_SEED_VERSION = "2026-06-15-jlpt10k";
// Keep this aligned with the metadata already baked into public/nihongo.db so
// a fresh install does not replay all 11k metadata updates on first launch.
const JLPT_WORD_METADATA_VERSION = "2026-06-24-noun-suru-pos-fix";
// 与 src/data/grammar_seed.json 的 version 字段保持一致。种子 JSON 只在版本
// 不匹配需要迁移时才动态加载,避免打进主 bundle。
const GRAMMAR_SEED_VERSION = "2026-06-25-pdf-n1-n5-connection-fix";

const loadJlptWordSeed = async (): Promise<JlptWordSeedRow[]> => {
  const payload = await import("../data/jlpt_words_seed.json");
  return payload.default as unknown as JlptWordSeedRow[];
};

const loadGrammarSeed = async (): Promise<{ version: string; rows: GrammarSeedRow[] }> => {
  const payload = await import("../data/grammar_seed.json");
  return payload.default as unknown as { version: string; rows: GrammarSeedRow[] };
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
  db.run("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)");
  db.run("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)");
  schemaReadyDbs.add(db);
};

// 启动时(App 渲染前)调用一次,完成建表与所有种子数据迁移。
// 之后同步路径里的 ensureUserTables 只做廉价的建表/索引检查。
export const ensureSeedData = async () => {
  ensureUserTables();
  await ensureGrammarSeed();
  await ensureJlptWordSeed();
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
          importance, sort_order
        )
        SELECT ?, id, pattern, meaning, prompt, formation, example_jp,
          example_meaning, notes, confusions, level, importance, sort_order
        FROM grammar_points
      `, [grammarVersion || "legacy-before-pdf-n4"]);
    }

    db.run("DELETE FROM grammar_points");
    const newIdByPattern = new Map<string, number>();
    grammarSeed.rows.forEach((row, index) => {
      db.run(`
        INSERT INTO grammar_points (
          pattern, meaning, prompt, formation, example_jp, example_meaning,
          notes, confusions, level, importance, sort_order
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

const syncJlptWordMetadata = (jlptWordSeed: JlptWordSeedRow[]) => {
  const db = getDatabase();
  jlptWordSeed.forEach(([, kana, kanji, pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel]) => {
    db.run(`
      UPDATE words
      SET pos = ?,
          verb_type = ?,
          importance = MAX(importance, ?),
          example_jp = COALESCE(NULLIF(example_jp, ''), ?),
          example_meaning = COALESCE(NULLIF(example_meaning, ''), ?),
          jlpt_level = COALESCE(jlpt_level, ?)
      WHERE kanji = ? AND kana = ?
    `, [pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel, kanji, kana]);
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

const ensureJlptWordMetadata = async () => {
  if (getState("jlpt_word_metadata_version", "") === JLPT_WORD_METADATA_VERSION) return;
  const jlptWordSeed = await loadJlptWordSeed();
  const db = getDatabase();
  db.run("BEGIN TRANSACTION");
  try {
    syncJlptWordMetadata(jlptWordSeed);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistSoon();
};

const ensureJlptWordSeed = async () => {
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
  const db = getDatabase();
  const existing = new Map<string, number>();
  rowsFor("SELECT id, kanji, kana FROM words").forEach((row) => {
    existing.set(`${String(row.kanji ?? "")}\u0000${String(row.kana ?? "")}`, Number(row.id));
  });

  db.run("BEGIN TRANSACTION");
  try {
    jlptWordSeed.forEach(([meaning, kana, kanji, pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel]) => {
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
          shuffle_rank, example_jp, example_meaning, jlpt_level
        )
        VALUES (?, ?, ?, ?, ?, ?, ABS(RANDOM()) / 9223372036854775807.0, ?, ?, ?)
      `, [meaning, kana, kanji, pos, verbType, importance, exampleJp, exampleMeaning, jlptLevel]);
      const newId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
      existing.set(key, newId);
    });
    db.run("INSERT OR IGNORE INTO progress (word_id) SELECT id FROM words");
    syncJlptWordMetadata(jlptWordSeed);
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

export const answerScore: Record<WordAnswer, number> = {
  forgot: -10,
  fuzzy: -5,
  know: 10,
  known_forever: 10
};

export const answerLabel: Record<StudyAnswer, string> = {
  forgot: "忘记",
  fuzzy: "模糊",
  know: "认识",
  known_forever: "熟知"
};
