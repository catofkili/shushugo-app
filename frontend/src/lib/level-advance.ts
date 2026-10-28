import { firstValue } from "./database/db-utils";
import { JLPT_TARGETS, type JlptTarget } from "./jlpt/plan";
import { currentFirstPlanLevelIndex } from "./plan-level-order";
import { kanaGatePending, LEVEL_ADVANCE_PAUSE_MS, levelAdvanceTarget, levelUnseenContent, readLevelAdvance, writeLevelAdvance, type LevelAdvanceKind } from "./studyPreferences";

/**
 * 单词 / 语法各自在前沿级别学到 95% 时问：往上、回补紧邻一级、或先不加。
 *
 * - 单词沿用「答过 / 熟知」的队列口径；语法只认真实流水或熟知，先验的 seen_count 不算真实作答。
 * - 前沿 = max(备考目标, 该类 upTo)；起点先验盖住的级别不问，N1 没有更高级不问。
 * - 单词往上是扩排序范围，语法往上还必须扩过滤范围；只改 jlptTarget 会误动考期和推荐量。
 * - 「先不加」= 先把这一级学到 100% 再停（studyPreferences 覆盖层只封顶该类每日量），
 *   停满一周后同一级再问一次，由 answer 决定续暂停还是继续。一周从学到 100% 起算，那一刻在下面的 levelAdvancePrompt 里记。
 */
export const LEVEL_ADVANCE_THRESHOLD = 0.95;

export interface LevelAdvancePrompt {
  kind: LevelAdvanceKind;
  level: JlptTarget;
  next: JlptTarget;
  backfill: JlptTarget | null;
  percent: number;
  /** 暂停期满后的第二次询问 */
  again: boolean;
}

const levelProgress = (kind: LevelAdvanceKind, level: string): { covered: number; total: number } => ({
  total: firstValue<number>(kind === "words"
    ? "SELECT COUNT(*) FROM words WHERE jlpt_level = ?"
    : "SELECT COUNT(*) FROM grammar_points WHERE level = ?", [level], 0),
  covered: firstValue<number>(kind === "words" ? `
      SELECT COUNT(*) FROM words w JOIN progress p ON p.word_id = w.id
      WHERE w.jlpt_level = ? AND (p.seen_count > 0 OR p.known_forever = 1)
    ` : `
      SELECT COUNT(*) FROM grammar_points g LEFT JOIN grammar_progress p ON p.grammar_id = g.id
      WHERE g.level = ? AND (p.known_forever = 1 OR EXISTS (
        SELECT 1 FROM grammar_reviews r WHERE r.grammar_id = g.id
      ))
    `, [level], 0)
});

const promptForKind = (kind: LevelAdvanceKind, now: Date): LevelAdvancePrompt | null => {
  const target = levelAdvanceTarget(kind);
  const index = JLPT_TARGETS.indexOf(target);
  const all = readLevelAdvance();
  let state = all[kind];
  if (state.pausedAt > 0 && state.pausedLevel !== target) {
    state = { ...state, pausedAt: 0, stoppedAt: 0, pausedLevel: "" };
    writeLevelAdvance({ ...all, [kind]: state });
  }
  if (index >= JLPT_TARGETS.length - 1 || index < currentFirstPlanLevelIndex(kind)) return null;
  const back = JLPT_TARGETS[index - 1];
  const backfill = back && levelUnseenContent(kind, back) > 0 ? back : null;
  if (state.pausedAt > 0) {
    if (state.stoppedAt <= 0) {
      // 还在把这一级学完；学完的那一刻开始停，一周从这里算
      if (levelUnseenContent(kind, target) === 0) writeLevelAdvance({ ...all, [kind]: { ...state, stoppedAt: now.getTime() } });
      return null;
    }
    if (now.getTime() - state.stoppedAt < LEVEL_ADVANCE_PAUSE_MS) return null;
    const { covered, total } = levelProgress(kind, target);
    return { kind, level: target, next: JLPT_TARGETS[index + 1], backfill, percent: total ? Math.floor(covered / total * 100) : 100, again: true };
  }
  if (state.answered.includes(target)) return null;
  const { covered, total } = levelProgress(kind, target);
  if (total > 0 && covered / total >= LEVEL_ADVANCE_THRESHOLD) {
    return { kind, level: target, next: JLPT_TARGETS[index + 1], backfill, percent: Math.floor(covered / total * 100), again: false };
  }
  return null;
};

export const levelAdvancePrompt = (now = new Date()): LevelAdvancePrompt | null => {
  if (kanaGatePending()) return null;
  // 两类都处理暂停起算；展示只取一张，单词优先。
  const words = promptForKind("words", now);
  const grammar = promptForKind("grammar", now);
  return words ?? grammar;
};

/** 回答只改该类状态；暂停等本级收尾后才起算一周。 */
export const answerLevelAdvance = (kind: LevelAdvanceKind, level: string, choice: "up" | "back" | "pause", now = new Date()) => {
  const index = JLPT_TARGETS.indexOf(level as JlptTarget);
  if (index < 0 || index >= JLPT_TARGETS.length - 1) return;
  const backfill = JLPT_TARGETS[index - 1];
  if (choice === "back" && (!backfill || levelUnseenContent(kind, backfill) === 0)) return;
  const all = readLevelAdvance();
  const state = all[kind];
  writeLevelAdvance({ ...all, [kind]: choice === "pause"
    ? { ...state, pausedAt: now.getTime(), stoppedAt: 0, pausedLevel: level }
    : {
      ...state,
      answered: [...new Set([...state.answered, level])],
      upTo: choice === "up" ? JLPT_TARGETS[index + 1] : state.upTo,
      backfill: choice === "back" ? backfill : state.backfill,
      pausedAt: 0, stoppedAt: 0, pausedLevel: ""
    }
  });
};
