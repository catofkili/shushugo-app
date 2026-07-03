import { getDatabase } from "./database";
import jlptWordSeedPayload from "../data/jlpt_words_seed.json";
import grammarSeedPayload from "../data/grammar_seed.json";
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

export const ensureUserTables = () => {
  const db = getDatabase();
  ensureLocalSchema();
  const wordColumns = rowsFor("PRAGMA table_info(words)").map((row) => String(row.name ?? ""));
  if (!wordColumns.includes("jlpt_level")) {
    db.run("ALTER TABLE words ADD COLUMN jlpt_level TEXT");
  }
  db.run("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)");
  db.run("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)");
  ensureGrammarSeed();
};

export const isFavorite = (type: FavoriteType, id: string | number) => {
  ensureUserTables();
  return Boolean(firstValue<number>(
    "SELECT 1 FROM content_favorites WHERE item_type = ? AND item_id = ? LIMIT 1",
    [type, String(id)],
    0
  ));
};

const JLPT_SEED_VERSION = "2026-06-15-jlpt10k";
// Keep this aligned with the metadata already baked into public/nihongo.db so
// a fresh install does not replay all 11k metadata updates on first launch.
const JLPT_WORD_METADATA_VERSION = "2026-06-24-noun-suru-pos-fix";
const jlptWordSeed = jlptWordSeedPayload as unknown as JlptWordSeedRow[];
const grammarSeed = grammarSeedPayload as { version: string; rows: GrammarSeedRow[] };

const ensureGrammarSeed = () => {
  const db = getDatabase();
  const grammarVersion = firstValue<string>("SELECT value FROM grammar_state WHERE key = ?", ["dataset_version"], "");
  if (grammarVersion === grammarSeed.version) return;

  const existingGrammarCount = firstValue<number>("SELECT COUNT(*) FROM grammar_points", [], 0);
  if (existingGrammarCount > 0) {
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

  db.run("DELETE FROM grammar_mistakes");
  db.run("DELETE FROM grammar_reviews");
  db.run("DELETE FROM grammar_progress");
  db.run("DELETE FROM grammar_points");
  grammarSeed.rows.forEach((row, index) => {
    db.run(`
      INSERT INTO grammar_points (
        pattern, meaning, prompt, formation, example_jp, example_meaning,
        notes, confusions, level, importance, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [...row, index + 1]);
  });
  db.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)", ["queue", "[]"]);
  db.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)", ["dataset_version", grammarSeed.version]);
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

const syncJlptWordMetadata = () => {
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

const ensureJlptWordMetadata = () => {
  if (getState("jlpt_word_metadata_version", "") === JLPT_WORD_METADATA_VERSION) return;
  const db = getDatabase();
  db.run("BEGIN TRANSACTION");
  try {
    syncJlptWordMetadata();
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistSoon();
};

export const ensureJlptWordSeed = () => {
  ensureUserTables();
  if (getState("jlpt_seed_version", "") === JLPT_SEED_VERSION) {
    ensureJlptWordMetadata();
    return;
  }
  const total = firstValue<number>("SELECT COUNT(*) FROM words", [], 0);
  const hasEnoughLevels = firstValue<number>(
    "SELECT COUNT(*) FROM words WHERE jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')",
    [],
    0
  ) >= 10000;
  if (total >= 10000 && hasEnoughLevels) {
    ensureJlptWordMetadata();
    setState("jlpt_seed_version", JLPT_SEED_VERSION);
    return;
  }

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
    syncJlptWordMetadata();
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
