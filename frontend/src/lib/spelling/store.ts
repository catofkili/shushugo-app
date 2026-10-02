import type { WordAnswer } from "../../types/vocabulary";
import { createCardLog } from "../card-log";
import { getDatabase } from "../database";
import { oncePerDatabase, persistSoon } from "../database/db-utils";
import { firstValue, rowsFor, studyDayEnd, today } from "../study-core";
import {
  ensureFsrsColumns,
  readFsrsState,
  writeFsrsState,
  WORD_FSRS,
  type FsrsEntity
} from "../fsrs-store";
import { isGraduatedForDay, LEECH_LAPSE_THRESHOLD, type FsrsState } from "../fsrs-scheduler";
import { SEEDED_STABILITY_RATIO } from "../word-api/directions";

export const SPELLING_FSRS: FsrsEntity = {
  table: "spelling_memory",
  idColumn: "word_id",
  eligible: "known_forever = 0"
};

const TABLES = ["spelling_memory", "spelling_reviews", "spelling_tasks"] as const;
const REVIEW_EXTRA_COLUMNS: Array<[string, string]> = [
  ["override", "TEXT NOT NULL DEFAULT ''"],
  ["mode", "TEXT NOT NULL DEFAULT 'meaning'"],
  ["source", "TEXT NOT NULL DEFAULT 'page'"]
];

const log = createCardLog({
  entity: SPELLING_FSRS,
  reviewsTable: "spelling_reviews",
  tasksTable: "spelling_tasks",
  dayEnd: (day) => studyDayEnd(new Date(`${day}T12:00:00`)),
  startingState: (key) => {
    const raw = rowsFor("SELECT seed_fsrs_state FROM spelling_memory WHERE word_id = ?", [key])[0]?.seed_fsrs_state;
    if (!raw) return null;
    try {
      const state = JSON.parse(String(raw)) as FsrsState;
      return Number.isFinite(state.stability) && state.stability > 0 && !!state.due ? state : null;
    } catch {
      return null;
    }
  }
});

/** 三张表由 local-schema.sql 建；模块只补 memory 的 FSRS 列。 */
export const ensureSpellingTables = (): void => {
  oncePerDatabase("spelling-tables", () => {
    const missing = TABLES.filter((table) => firstValue<number>(
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table], 0
    ) === 0);
    if (missing.length) throw new Error(`Missing spelling tables: ${missing.join(", ")}`);
    // 表建在 local-schema.sql，但老库上它已经存在、CREATE IF NOT EXISTS 不会加列：缺的列在这里补
    const existing = new Set(rowsFor("PRAGMA table_info(spelling_reviews)").map((row) => String(row.name)));
    for (const [column, ddl] of REVIEW_EXTRA_COLUMNS) {
      if (!existing.has(column)) getDatabase().run(`ALTER TABLE spelling_reviews ADD COLUMN ${column} ${ddl}`);
    }
    log.ensure();
  });
};

/** 给已学过的正向卡播种一个保守的拼写起点；cloud:false 仍需本地增量保存它。 */
export const seedSpellingCards = (limit: number): number => {
  const count = Math.max(0, Math.floor(limit));
  if (!count) return 0;
  ensureSpellingTables();
  ensureFsrsColumns(WORD_FSRS);
  const candidates = rowsFor(`
    SELECT p.word_id
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.seen_count > 0
      AND p.known_forever = 0
      AND COALESCE(p.fsrs_lapses, 0) < ?
      AND p.fsrs_stability IS NOT NULL
      AND p.fsrs_due IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM spelling_memory m WHERE m.word_id = p.word_id)
    ORDER BY p.fsrs_due ASC, p.word_id ASC
    LIMIT ?
  `, [LEECH_LAPSE_THRESHOLD, count]);
  const now = new Date().toISOString();
  const db = getDatabase();
  let created = 0;
  db.run("SAVEPOINT seed_spelling_cards");
  try {
    for (const row of candidates) {
      const wordId = Number(row.word_id);
      const forward = readFsrsState(wordId, WORD_FSRS);
      if (!forward) continue;
      const seeded: FsrsState = {
        ...forward,
        stability: Math.max(forward.stability * SEEDED_STABILITY_RATIO, 0.1),
        due: now,
        lastReview: now,
        reps: 0,
        lapses: 0,
        steps: 0
      };
      db.run("INSERT OR IGNORE INTO spelling_memory (word_id, seen_count, seed_fsrs_state) VALUES (?, 0, ?)", [
        wordId, JSON.stringify(seeded)
      ]);
      writeFsrsState(wordId, seeded, SPELLING_FSRS);
      created += 1;
    }
    db.run("RELEASE seed_spelling_cards");
  } catch (error) {
    db.run("ROLLBACK TO seed_spelling_cards");
    db.run("RELEASE seed_spelling_cards");
    throw error;
  }
  return created;
};

export const createSpellingTasks = (quota: { fresh: number; review: number }, day = today()) => {
  ensureSpellingTables();
  return log.createTasks(quota, () => rowsFor(`
    SELECT m.word_id
    FROM spelling_memory m
    JOIN progress p ON p.word_id = m.word_id
    WHERE m.seen_count = 0 AND m.known_forever = 0
    ORDER BY p.fsrs_stability DESC, m.word_id ASC
  `).map((row) => String(row.word_id)), day);
};

export const pickSpellingNext = (day = today(), excluded = new Set<string>()): number | null => {
  ensureSpellingTables();
  const wordId = log.pickNext(day, excluded);
  return wordId === null ? null : Number(wordId);
};

export const spellingProgress = (day = today()) => {
  ensureSpellingTables();
  return log.progress(day);
};

export interface SpellingAnswerDetail {
  typed: string;
  form: string;
  hints: number;
  tries: number;
  ms: number;
  problem: string;
  /** 用户裁决：'' / 'correct' / 'wrong'（SpellingRound.override）。 */
  override?: string;
  /** 题面形式 SpellingMode，默认 'meaning'。 */
  mode?: string;
  /** 'page' 独立页面（默认）/ 'inline' 学习流程里插播。 */
  source?: string;
}

const withSpellingWrite = <T>(write: () => T): T => {
  ensureSpellingTables();
  const db = getDatabase();
  db.run("SAVEPOINT spelling_write");
  try {
    const result = write();
    db.run("RELEASE spelling_write");
    return result;
  } catch (error) {
    db.run("ROLLBACK TO spelling_write");
    db.run("RELEASE spelling_write");
    throw error;
  }
};

export const recordSpellingAnswer = (
  wordId: number,
  answer: WordAnswer,
  detail: SpellingAnswerDetail,
  now = new Date()
): void => {
  withSpellingWrite(() => log.record(String(wordId), answer, now, undefined, {
    typed: detail.typed,
    form: detail.form,
    hints: detail.hints,
    tries: detail.tries,
    ms: detail.ms,
    problem: detail.problem,
    override: detail.override ?? "",
    mode: detail.mode ?? "meaning",
    source: detail.source ?? "page"
  }));
  persistSoon();
};

export const undoLastSpelling = (): number | null => {
  const wordId = withSpellingWrite(() => log.undoLast());
  if (wordId === null) return null;
  persistSoon();
  return Number(wordId);
};

export const clearSpellingTasks = (day = today()): void => {
  ensureSpellingTables();
  log.clearTasks(day);
};

export const lastEncounterToday = (wordId: number, day = today()): boolean => {
  if (!firstValue<number>(
    "SELECT EXISTS(SELECT 1 FROM reviews WHERE word_id = ? AND reviewed_on = ? AND direction = 'forward')", [wordId, day], 0
  )) return false;
  return isGraduatedForDay(
    readFsrsState(wordId, WORD_FSRS),
    studyDayEnd(new Date(`${day}T12:00:00`))
  );
};
