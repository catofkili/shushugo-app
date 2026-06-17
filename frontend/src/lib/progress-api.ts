import { getDatabase } from "./database";
import { DbRow, firstRow, getState, persistSoon, rowsFor, setState, today } from "./study-core";
import { ensureGrammarProgressInitialized, getGrammarQueue, setGrammarQueue } from "./grammar-api";
import { ensureProgressInitialized, getReviewQueue, setReviewQueue } from "./word-api";
import type { ProgressOverview } from "./study-types";

export function getProgressOverview(): ProgressOverview {
  ensureProgressInitialized();
  ensureGrammarProgressInitialized();
  const wordRow = firstRow(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN p.known_forever = 1 THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND p.score <= 6 THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count = 0 THEN 1 ELSE 0 END) AS unseen
    FROM words w
    JOIN progress p ON p.word_id = w.id
  `);
  const wordsByLevel = rowsFor(`
    SELECT
      COALESCE(w.jlpt_level, '未分级') AS level,
      COUNT(*) AS total,
      SUM(CASE WHEN p.known_forever = 1 THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND p.score <= 6 THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count = 0 THEN 1 ELSE 0 END) AS unseen
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE w.jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')
    GROUP BY w.jlpt_level
    ORDER BY CASE w.jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END
  `).map((row) => ({
    level: String(row.level ?? ""),
    total: Number(row.total ?? 0),
    completed: Number(row.completed ?? 0),
    low: Number(row.low ?? 0),
    unseen: Number(row.unseen ?? 0)
  }));
  const grammar = rowsFor(`
    SELECT
      g.level,
      COUNT(*) AS total,
      SUM(CASE WHEN p.known_forever = 1 THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND p.score <= 6 THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count = 0 THEN 1 ELSE 0 END) AS unseen
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    GROUP BY g.level
    ORDER BY CASE g.level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END
  `).map((row) => ({
    level: String(row.level ?? ""),
    total: Number(row.total ?? 0),
    completed: Number(row.completed ?? 0),
    low: Number(row.low ?? 0),
    unseen: Number(row.unseen ?? 0)
  }));

  return {
    words: {
      total: Number(wordRow?.total ?? 0),
      completed: Number(wordRow?.completed ?? 0),
      low: Number(wordRow?.low ?? 0),
      unseen: Number(wordRow?.unseen ?? 0)
    },
    wordsByLevel,
    grammar
  };
}

type FillSnapshot = {
  id: number;
  knownForever: number;
  score: number;
  seenCount: number;
  lastSeenOn: string | null;
  masteredOn: string | null;
};

type ManualFillState = {
  words: FillSnapshot[];
  grammar: FillSnapshot[];
};

const MANUAL_FILL_STATE_KEY = "manual_fill_state_v1";

const readManualFillState = (): ManualFillState => {
  try {
    const parsed = JSON.parse(getState(MANUAL_FILL_STATE_KEY, "{\"words\":[],\"grammar\":[]}")) as Partial<ManualFillState>;
    return {
      words: Array.isArray(parsed.words) ? parsed.words : [],
      grammar: Array.isArray(parsed.grammar) ? parsed.grammar : []
    };
  } catch {
    return { words: [], grammar: [] };
  }
};

const writeManualFillState = (state: ManualFillState) => {
  setState(MANUAL_FILL_STATE_KEY, JSON.stringify(state));
};

const snapshotFromRow = (row: DbRow): FillSnapshot => ({
  id: Number(row.id ?? 0),
  knownForever: Number(row.known_forever ?? 0),
  score: Number(row.score ?? 0),
  seenCount: Number(row.seen_count ?? 0),
  lastSeenOn: row.last_seen_on == null ? null : String(row.last_seen_on),
  masteredOn: row.mastered_on == null ? null : String(row.mastered_on)
});

export function markContentComplete(options: { grammarLevels: string[]; wordLevels?: string[]; allWords?: boolean }): ProgressOverview {
  ensureProgressInitialized();
  ensureGrammarProgressInitialized();
  const db = getDatabase();
  const day = today();
  const allLevels = ["N5", "N4", "N3", "N2", "N1"];
  const allLevelPlaceholders = allLevels.map(() => "?").join(",");

  const previous = readManualFillState();
  previous.words.forEach((item) => {
    db.run(`
      UPDATE progress
      SET known_forever = ?,
          score = ?,
          seen_count = ?,
          last_seen_on = ?,
          mastered_on = ?
      WHERE word_id = ?
        AND known_forever = 1
        AND score >= 10
    `, [item.knownForever, item.score, item.seenCount, item.lastSeenOn, item.masteredOn, item.id]);
  });
  previous.grammar.forEach((item) => {
    db.run(`
      UPDATE grammar_progress
      SET known_forever = ?,
          score = ?,
          seen_count = ?,
          last_seen_on = ?,
          mastered_on = ?
      WHERE grammar_id = ?
        AND known_forever = 1
        AND score >= 10
    `, [item.knownForever, item.score, item.seenCount, item.lastSeenOn, item.masteredOn, item.id]);
  });

  const nextState: ManualFillState = { words: [], grammar: [] };

  if (options.allWords) {
    nextState.words = rowsFor(`
      SELECT p.word_id AS id, p.known_forever, p.score, p.seen_count, p.last_seen_on, p.mastered_on
      FROM progress p
      JOIN words w ON w.id = p.word_id
      WHERE w.jlpt_level IN (${allLevelPlaceholders})
    `, allLevels).map(snapshotFromRow);
    db.run(`
      UPDATE progress
      SET known_forever = 1,
          score = MAX(score, 10),
          mastered_on = COALESCE(mastered_on, ?),
          last_seen_on = COALESCE(last_seen_on, ?)
      WHERE word_id IN (
        SELECT id FROM words WHERE jlpt_level IN (${allLevelPlaceholders})
      )
    `, [day, day, ...allLevels]);
  }

  const wordLevels = Array.from(new Set((options.wordLevels ?? []).filter((level) => allLevels.includes(level))));
  if (!options.allWords && wordLevels.length) {
    const placeholders = wordLevels.map(() => "?").join(",");
    nextState.words = rowsFor(`
      SELECT p.word_id AS id, p.known_forever, p.score, p.seen_count, p.last_seen_on, p.mastered_on
      FROM progress p
      JOIN words w ON w.id = p.word_id
      WHERE w.jlpt_level IN (${placeholders})
    `, wordLevels).map(snapshotFromRow);
    db.run(`
      UPDATE progress
      SET known_forever = 1,
          score = MAX(score, 10),
          mastered_on = COALESCE(mastered_on, ?),
          last_seen_on = COALESCE(last_seen_on, ?)
      WHERE word_id IN (
        SELECT id FROM words WHERE jlpt_level IN (${placeholders})
      )
    `, [day, day, ...wordLevels]);
  }

  const levels = Array.from(new Set(options.grammarLevels.filter((level) => allLevels.includes(level))));
  if (levels.length) {
    const placeholders = levels.map(() => "?").join(",");
    nextState.grammar = rowsFor(`
      SELECT p.grammar_id AS id, p.known_forever, p.score, p.seen_count, p.last_seen_on, p.mastered_on
      FROM grammar_progress p
      JOIN grammar_points g ON g.id = p.grammar_id
      WHERE g.level IN (${placeholders})
    `, levels).map(snapshotFromRow);
    db.run(`
      UPDATE grammar_progress
      SET known_forever = 1,
          score = MAX(score, 10),
          mastered_on = COALESCE(mastered_on, ?),
          last_seen_on = COALESCE(last_seen_on, ?)
      WHERE grammar_id IN (
        SELECT id FROM grammar_points WHERE level IN (${placeholders})
      )
    `, [day, day, ...levels]);
  }

  const completedWordIds = new Set(nextState.words.map((item) => item.id));
  if (completedWordIds.size) {
    const ids = Array.from(completedWordIds);
    const placeholders = ids.map(() => "?").join(",");
    db.run(`DELETE FROM stage1_tasks WHERE word_id IN (${placeholders})`, ids);
    db.run(`DELETE FROM stage2_progress WHERE word_id IN (${placeholders})`, ids);
    db.run(`DELETE FROM kanji_progress WHERE word_id IN (${placeholders})`, ids);
    setReviewQueue(getReviewQueue().filter((item) => !completedWordIds.has(item.word_id)));
  }

  const completedGrammarIds = new Set(nextState.grammar.map((item) => item.id));
  if (completedGrammarIds.size) {
    setGrammarQueue(getGrammarQueue().filter((item) => !completedGrammarIds.has(item.grammar_id)));
  }

  writeManualFillState(nextState);

  persistSoon();
  return getProgressOverview();
}
