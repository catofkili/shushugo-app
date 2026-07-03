import { getDatabase } from "./database";
import { notifyProgressUpdated } from "./progress-events";
import {
  answerLabel,
  answerScore,
  CRITICAL_SCORE,
  DAILY_DECAY_FLOOR,
  DbRow,
  ensureUserTables,
  firstRow,
  firstValue,
  isFavorite,
  persistSoon,
  randomBetween,
  rowsFor,
  SqlValue,
  today
} from "./study-core";
import type {
  GrammarMistakeItem,
  GrammarStudyCard,
  GrammarStudySession,
  GrammarStudyStats,
  StudyAnswer
} from "./study-types";

export function ensureGrammarProgressInitialized() {
  ensureUserTables();
  getDatabase().run(`
    INSERT OR IGNORE INTO grammar_progress (grammar_id)
    SELECT id FROM grammar_points
  `);
}

const grammarState = (key: string, fallback: string) => firstValue<string>(
  "SELECT value FROM grammar_state WHERE key = ?",
  [key],
  fallback
);

const setGrammarState = (key: string, value: string) => {
  getDatabase().run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)", [key, value]);
};

export const getGrammarQueue = (): { grammar_id: number; due_after: number }[] => {
  try {
    const queue = JSON.parse(grammarState("queue", "[]"));
    if (!Array.isArray(queue)) return [];
    return queue.flatMap((item) => {
      const grammarId = Number(item?.grammar_id);
      if (!Number.isFinite(grammarId)) return [];
      return [{ grammar_id: grammarId, due_after: Math.max(Number(item?.due_after ?? 0), 0) }];
    });
  } catch {
    return [];
  }
};

export const setGrammarQueue = (queue: { grammar_id: number; due_after: number }[]) => {
  setGrammarState("queue", JSON.stringify(queue));
};

const advanceGrammarQueue = (grammarId: number) => {
  setGrammarQueue(getGrammarQueue().flatMap((item) => {
    if (item.grammar_id === grammarId) return [];
    return [{ grammar_id: item.grammar_id, due_after: Math.max(item.due_after - 1, 0) }];
  }));
};

const scheduleGrammarReview = (grammarId: number) => {
  const queue = getGrammarQueue().filter((item) => item.grammar_id !== grammarId);
  queue.push({ grammar_id: grammarId, due_after: randomBetween(4, 8) });
  setGrammarQueue(queue);
};

const grammarMistakeScore = (row: DbRow) => {
  const wrongish = Number(row.forgot_count ?? 0) * 2 + Number(row.fuzzy_count ?? 0);
  const total = wrongish + Number(row.right_count ?? 0);
  if (total === 0) return 0;
  return Math.min(wrongish / total + Math.min(Number(row.mistake_streak ?? 0) * 0.08, 0.32), 1);
};

const grammarDecayTenths = (row: DbRow) => {
  let decay = 10 + Number(row.importance ?? 3) - 3 + Math.round(grammarMistakeScore(row) * 2);
  if (Number(row.right_count ?? 0) >= Number(row.forgot_count ?? 0) + Number(row.fuzzy_count ?? 0) + 3) {
    decay -= 1;
  }
  return Math.min(Math.max(decay, 8), 12);
};

export const applyGrammarDailyDecay = () => {
  const day = today();
  const lastDecay = grammarState("last_decay", "");
  if (!lastDecay) {
    setGrammarState("last_decay", day);
    return;
  }
  if (lastDecay === day) return;
  rowsFor(`
    SELECT g.importance, p.*
    FROM grammar_progress p
    JOIN grammar_points g ON g.id = p.grammar_id
    WHERE p.known_forever = 0 AND p.seen_count > 0
  `).forEach((row) => {
    const decay = grammarDecayTenths(row);
    getDatabase().run(`
      UPDATE grammar_progress
      SET score = MAX(score - ?, ?),
          mastered_on = NULL,
          last_decay_amount = ?
      WHERE grammar_id = ?
    `, [decay / 10, DAILY_DECAY_FLOOR, decay, Number(row.grammar_id)]);
  });
  setGrammarState("last_decay", day);
};

const grammarCard = (row: DbRow): GrammarStudyCard => ({
  id: Number(row.id ?? row.grammar_id ?? 0),
  key: String(row.pattern ?? row.grammar_id ?? ""),
  pattern: String(row.pattern ?? "").includes("_") ? String(row.prompt ?? "") : String(row.pattern ?? ""),
  meaning: String(row.meaning ?? ""),
  prompt: String(row.prompt ?? ""),
  formation: String(row.formation ?? ""),
  example: {
    jp: String(row.example_jp ?? ""),
    meaning: String(row.example_meaning ?? "")
  },
  notes: String(row.notes ?? "") === "[]" ? "" : String(row.notes ?? ""),
  confusions: String(row.confusions ?? "").split("；").map((item) => item.trim()).filter(Boolean),
  level: String(row.level ?? ""),
  score: Math.round(Number(row.score ?? 0) * 10) / 10,
  importance: Number(row.importance ?? 3),
  isFavorite: isFavorite("grammar", String(row.pattern ?? row.grammar_id ?? ""))
});

const grammarLevelClause = (level?: string) => {
  if (!level || level === "All") return { clause: "", params: [] as SqlValue[] };
  return { clause: " AND g.level = ? ", params: [level] as SqlValue[] };
};

const pickGrammarNext = (level?: string): GrammarStudyCard | null => {
  ensureGrammarProgressInitialized();
  applyGrammarDailyDecay();
  const day = today();
  const levelFilter = grammarLevelClause(level);
  const dueIds = getGrammarQueue().filter((item) => item.due_after <= 0).map((item) => item.grammar_id);
  if (dueIds.length) {
    const placeholders = dueIds.map(() => "?").join(",");
    const due = firstRow(`
      SELECT g.*, p.score, p.seen_count, p.forgot_count, p.fuzzy_count,
             p.right_count, p.mistake_streak
      FROM grammar_points g
      JOIN grammar_progress p ON p.grammar_id = g.id
      WHERE g.id IN (${placeholders})
        AND p.known_forever = 0
        AND (p.mastered_on IS NULL OR p.mastered_on != ?)
        ${levelFilter.clause}
      ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC
      LIMIT 1
    `, [...dueIds, day, ...levelFilter.params]);
    if (due) return grammarCard(due);
  }

  const critical = firstRow(`
    SELECT g.*, p.score, p.seen_count, p.forgot_count, p.fuzzy_count,
           p.right_count, p.mistake_streak
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND p.score <= ?
      AND (p.mastered_on IS NULL OR p.mastered_on != ?)
      ${levelFilter.clause}
    ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, g.importance DESC
    LIMIT 1
  `, [CRITICAL_SCORE, day, ...levelFilter.params]);
  if (critical) return grammarCard(critical);

  const low = firstRow(`
    SELECT g.*, p.score, p.seen_count, p.forgot_count, p.fuzzy_count,
           p.right_count, p.mistake_streak
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND p.score <= 6
      AND (p.mastered_on IS NULL OR p.mastered_on != ?)
      ${levelFilter.clause}
    ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, g.importance DESC
    LIMIT 1
  `, [day, ...levelFilter.params]);
  if (low) return grammarCard(low);

  const unseen = firstRow(`
    SELECT g.*, p.score, p.seen_count, p.forgot_count, p.fuzzy_count,
           p.right_count, p.mistake_streak
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE p.known_forever = 0
      AND p.seen_count = 0
      ${levelFilter.clause}
    ORDER BY CASE g.level
      WHEN 'N5' THEN 1
      WHEN 'N4' THEN 2
      WHEN 'N3' THEN 3
      WHEN 'N2' THEN 4
      WHEN 'N1' THEN 5
      ELSE 9
    END, g.sort_order ASC
    LIMIT 1
  `, levelFilter.params);
  return unseen ? grammarCard(unseen) : null;
};

export function getGrammarStats(): GrammarStudyStats {
  ensureGrammarProgressInitialized();
  applyGrammarDailyDecay();
  const day = today();
  const row = firstRow(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN p.known_forever = 1 THEN 1 ELSE 0 END) AS known_forever,
      SUM(CASE WHEN p.seen_count = 0 AND p.known_forever = 0 THEN 1 ELSE 0 END) AS unseen,
      SUM(CASE WHEN p.seen_count > 0 AND p.known_forever = 0 AND p.score <= 6 THEN 1 ELSE 0 END) AS low_count,
      SUM(CASE WHEN p.mastered_on = ? THEN 1 ELSE 0 END) AS mastered_today
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
  `, [day]);
  const total = Number(row?.total ?? 0);
  const knownForever = Number(row?.known_forever ?? 0);
  const unseen = Number(row?.unseen ?? 0);
  const lowCount = Number(row?.low_count ?? 0);
  const done = knownForever + (total - unseen - lowCount);
  return {
    total,
    knownForever,
    unseenCount: unseen,
    lowCount,
    masteredToday: Number(row?.mastered_today ?? 0),
    reviewedToday: firstValue<number>("SELECT COUNT(DISTINCT grammar_id) FROM grammar_reviews WHERE reviewed_on = ?", [day], 0),
    mistakeCount: firstValue<number>("SELECT COUNT(*) FROM grammar_mistakes WHERE resolved_on IS NULL", [], 0),
    progressDone: Math.min(Math.max(done, 0), Math.max(total, 1)),
    progressTotal: total,
    studyDate: day
  };
}

const recordGrammarMistakeState = (grammarId: number, answer: StudyAnswer, score: number) => {
  const db = getDatabase();
  const day = today();
  if (answer === "forgot" || answer === "fuzzy") {
    db.run(`
      INSERT INTO grammar_mistakes (
        grammar_id, answer, score_after, mistake_count,
        first_seen_on, last_seen_on, resolved_on
      )
      VALUES (?, ?, ?, 1, ?, ?, NULL)
      ON CONFLICT(grammar_id) DO UPDATE SET
        answer = excluded.answer,
        score_after = excluded.score_after,
        mistake_count = grammar_mistakes.mistake_count + 1,
        last_seen_on = excluded.last_seen_on,
        resolved_on = NULL
    `, [grammarId, answer, score, day, day]);
    return;
  }

  db.run(`
    UPDATE grammar_mistakes
    SET resolved_on = ?
    WHERE grammar_id = ?
      AND resolved_on IS NULL
  `, [day, grammarId]);
};

export function getGrammarSession(level?: string): GrammarStudySession {
  const card = pickGrammarNext(level);
  return {
    card,
    stats: getGrammarStats()
  };
}

export function submitGrammarAnswer(grammarId: number, answer: StudyAnswer, level?: string): GrammarStudySession {
  ensureGrammarProgressInitialized();
  applyGrammarDailyDecay();
  const db = getDatabase();
  const day = today();
  const progress = firstRow("SELECT * FROM grammar_progress WHERE grammar_id = ?", [grammarId]);
  if (!progress) return getGrammarSession(level);

  advanceGrammarQueue(grammarId);
  let score = Number(progress.score ?? 0);
  let knownForever = Number(progress.known_forever ?? 0);
  let rightCount = Number(progress.right_count ?? 0);
  let fuzzyCount = Number(progress.fuzzy_count ?? 0);
  let forgotCount = Number(progress.forgot_count ?? 0);
  let mistakeStreak = Number(progress.mistake_streak ?? 0);

  if (answer === "known_forever") {
    knownForever = 1;
    mistakeStreak = 0;
  } else {
    score = Math.max(score + answerScore[answer], -40);
    rightCount += answer === "know" ? 1 : 0;
    fuzzyCount += answer === "fuzzy" ? 1 : 0;
    forgotCount += answer === "forgot" ? 1 : 0;
    mistakeStreak = answer === "know" ? 0 : mistakeStreak + 1;
  }

  let lowHistory = Number(progress.low_history ?? 0);
  if (score <= CRITICAL_SCORE) lowHistory = 1;
  const masteredOn = score >= 10 && !knownForever ? day : null;
  if (score <= 6 && !knownForever) scheduleGrammarReview(grammarId);

  db.run(`
    UPDATE grammar_progress
    SET score = ?,
        seen_count = seen_count + 1,
        low_history = ?,
        known_forever = ?,
        mastered_on = ?,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?
    WHERE grammar_id = ?
  `, [score, lowHistory, knownForever, masteredOn, day, rightCount, fuzzyCount, forgotCount, mistakeStreak, grammarId]);
  db.run(
    "INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
    [grammarId, answer, score, day]
  );
  recordGrammarMistakeState(grammarId, answer, score);
  persistSoon();
  notifyProgressUpdated();
  return getGrammarSession(level);
}

export function getGrammarPointFavorite(pattern: string): boolean {
  return isFavorite("grammar", pattern);
}

export function getGrammarMistakes(limit = 50): GrammarMistakeItem[] {
  ensureUserTables();
  return rowsFor(`
    SELECT
      m.rowid AS id,
      m.grammar_id,
      m.answer,
      m.score_after,
      m.mistake_count,
      m.last_seen_on,
      g.pattern,
      g.prompt,
      g.meaning,
      g.level,
      g.example_jp,
      g.example_meaning
    FROM grammar_mistakes m
    JOIN grammar_points g ON g.id = m.grammar_id
    WHERE m.resolved_on IS NULL
    ORDER BY m.last_seen_on DESC, m.mistake_count DESC
    LIMIT ?
  `, [Math.max(1, Math.round(limit))]).map((row) => ({
    id: Number(row.id ?? 0),
    grammarId: Number(row.grammar_id ?? 0),
    key: String(row.pattern ?? ""),
    title: String(row.prompt || row.pattern || ""),
    meaning: String(row.meaning ?? ""),
    level: String(row.level ?? ""),
    answer: String(row.answer ?? "forgot") as StudyAnswer,
    answerLabel: answerLabel[String(row.answer ?? "forgot") as StudyAnswer] ?? String(row.answer ?? ""),
    scoreAfter: Math.round(Number(row.score_after ?? 0) * 10) / 10,
    mistakeCount: Number(row.mistake_count ?? 0),
    lastSeenOn: String(row.last_seen_on ?? ""),
    example: {
      jp: String(row.example_jp ?? ""),
      meaning: String(row.example_meaning ?? "")
    }
  }));
}

export function resolveGrammarMistake(grammarId: number): GrammarMistakeItem[] {
  ensureUserTables();
  getDatabase().run(`
    UPDATE grammar_mistakes
    SET resolved_on = ?
    WHERE grammar_id = ?
      AND resolved_on IS NULL
  `, [today(), grammarId]);
  persistSoon();
  return getGrammarMistakes();
}

export function prioritizeGrammarMistake(grammarId: number): GrammarStudySession {
  ensureGrammarProgressInitialized();
  const queue = getGrammarQueue().filter((item) => item.grammar_id !== grammarId);
  setGrammarQueue([{ grammar_id: grammarId, due_after: 0 }, ...queue]);
  persistSoon();
  return getGrammarSession();
}
