import { getDatabase } from "./database";
import jlptWordSeedPayload from "../data/jlpt_words_seed.json";
import type { WordAnswer } from "../types/vocabulary";
import type { FavoriteType, StudyAnswer } from "./study-types";

export type SqlValue = string | number | null;
export type DbRow = Record<string, SqlValue>;

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

export const CRITICAL_SCORE = -20;

export const studyDate = () => {
  const now = new Date();
  if (now.getHours() < 4) {
    now.setDate(now.getDate() - 1);
  }
  return now.toISOString().slice(0, 10);
};

export const today = studyDate;

export const firstValue = <T = SqlValue>(query: string, params: SqlValue[] = [], fallback: T): T => {
  const result = getDatabase().exec(query, params);
  if (!result.length || !result[0].values.length) return fallback;
  return result[0].values[0][0] as T;
};

export const rowsFor = (query: string, params: SqlValue[] = []): DbRow[] => {
  const result = getDatabase().exec(query, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((valueRow) => {
    const row: DbRow = {};
    columns.forEach((column, index) => {
      row[column] = valueRow[index] as SqlValue;
    });
    return row;
  });
};

export const firstRow = (query: string, params: SqlValue[] = []): DbRow | null => rowsFor(query, params)[0] ?? null;

export const ensureUserTables = () => {
  const db = getDatabase();
  const wordColumns = rowsFor("PRAGMA table_info(words)").map((row) => String(row.name ?? ""));
  if (!wordColumns.includes("jlpt_level")) {
    db.run("ALTER TABLE words ADD COLUMN jlpt_level TEXT");
  }
  db.run("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)");
  db.run("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)");
  db.run(`
    CREATE TABLE IF NOT EXISTS content_favorites (
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (item_type, item_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS grammar_mistakes (
      grammar_id INTEGER PRIMARY KEY,
      answer TEXT NOT NULL,
      score_after REAL NOT NULL DEFAULT 0,
      mistake_count INTEGER NOT NULL DEFAULT 1,
      first_seen_on TEXT NOT NULL,
      last_seen_on TEXT NOT NULL,
      resolved_on TEXT,
      FOREIGN KEY(grammar_id) REFERENCES grammar_points(id)
    )
  `);
};

export const persistSoon = () => {
  import("./storage").then(({ scheduleSave }) => scheduleSave());
};

export const isFavorite = (type: FavoriteType, id: string | number) => {
  ensureUserTables();
  return Boolean(firstValue<number>(
    "SELECT 1 FROM content_favorites WHERE item_type = ? AND item_id = ? LIMIT 1",
    [type, String(id)],
    0
  ));
};

export const getState = (key: string, fallback: string) => firstValue<string>(
  "SELECT value FROM app_state WHERE key = ?",
  [key],
  fallback
);

export const setState = (key: string, value: string) => {
  getDatabase().run("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", [key, value]);
};

const JLPT_SEED_VERSION = "2026-06-15-jlpt10k";
const jlptWordSeed = jlptWordSeedPayload as unknown as JlptWordSeedRow[];

export const ensureJlptWordSeed = () => {
  ensureUserTables();
  if (getState("jlpt_seed_version", "") === JLPT_SEED_VERSION) return;
  const total = firstValue<number>("SELECT COUNT(*) FROM words", [], 0);
  const hasEnoughLevels = firstValue<number>(
    "SELECT COUNT(*) FROM words WHERE jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')",
    [],
    0
  ) >= 10000;
  if (total >= 10000 && hasEnoughLevels) {
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

export const daysSince = (dateText: SqlValue) => {
  if (!dateText) return 0;
  const parsed = new Date(`${String(dateText)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 0;
  const now = new Date(`${today()}T00:00:00`);
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86400000));
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
