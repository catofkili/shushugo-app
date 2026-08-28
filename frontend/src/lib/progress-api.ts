import { firstRow, rowsFor, studyDayEnd } from "./study-core";
import { ensureGrammarProgressInitialized } from "./grammar-api";
import { ensureProgressInitialized } from "./word-api";
import { MASTERED_SQL } from "./fsrs-store";
import type { ProgressOverview } from "./study-types";

export function getProgressOverview(): ProgressOverview {
  ensureProgressInitialized();
  ensureGrammarProgressInitialized();
  // 「薄弱」= FSRS 认为本学习日内该复习的,和首页的今日任务量同一把尺子
  const dayEnd = studyDayEnd().toISOString();
  const wordRow = firstRow(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN p.seen_count > 0 OR p.known_forever = 1 THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN p.known_forever = 1 OR ${MASTERED_SQL} THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count = 0 THEN 1 ELSE 0 END) AS unseen
    FROM words w
    JOIN progress p ON p.word_id = w.id
  `, [dayEnd]);
  const wordsByLevel = rowsFor(`
    SELECT
      COALESCE(w.jlpt_level, '未分级') AS level,
      COUNT(*) AS total,
      SUM(CASE WHEN p.seen_count > 0 OR p.known_forever = 1 THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN p.known_forever = 1 OR ${MASTERED_SQL} THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count = 0 THEN 1 ELSE 0 END) AS unseen
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE w.jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')
    GROUP BY w.jlpt_level
    ORDER BY CASE w.jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END
  `, [dayEnd]).map((row) => ({
    level: String(row.level ?? ""),
    total: Number(row.total ?? 0),
    seen: Number(row.seen ?? 0),
    completed: Number(row.completed ?? 0),
    low: Number(row.low ?? 0),
    unseen: Number(row.unseen ?? 0)
  }));
  const grammar = rowsFor(`
    SELECT
      g.level,
      COUNT(*) AS total,
      SUM(CASE WHEN p.seen_count > 0 OR p.known_forever = 1 THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN p.known_forever = 1 OR ${MASTERED_SQL} THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count = 0 THEN 1 ELSE 0 END) AS unseen
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    GROUP BY g.level
    ORDER BY CASE g.level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END
  `, [dayEnd]).map((row) => ({
    level: String(row.level ?? ""),
    total: Number(row.total ?? 0),
    seen: Number(row.seen ?? 0),
    completed: Number(row.completed ?? 0),
    low: Number(row.low ?? 0),
    unseen: Number(row.unseen ?? 0)
  }));

  return {
    words: {
      total: Number(wordRow?.total ?? 0),
      seen: Number(wordRow?.seen ?? 0),
      completed: Number(wordRow?.completed ?? 0),
      low: Number(wordRow?.low ?? 0),
      unseen: Number(wordRow?.unseen ?? 0)
    },
    wordsByLevel,
    grammar
  };
}
