import { expect } from "vitest";
import { dailyPlanView, remainingPlanWords, SECONDS_PER_CARD } from "../daily-plan";
import { firstValue, rowsFor, studyDayEnd, today } from "../database/db-utils";
import { grammarReviewEntity, PLAN_GRAMMAR_LEVEL, scopeLevels } from "../grammar-quiz";
import { getJlptPlanStatus } from "../jlpt/status";
import { WORD_FSRS } from "../fsrs-store";
import { forecastPriorReleases, pendingPriorSql, PRIOR_ENTITIES } from "../prior-pacing";
import { allocateDay, BUDGET_HEADROOM, DEFAULT_MAX_SCALE, inferBudgetMinutes, type BudgetInput } from "../plan/budget-allocator";
import { getEffectiveStudyPreferences, getStudyPreferences, kanaGatePending, levelAdvanceNewCap,
  levelAdvanceTarget, PLAN_REVIEW_DISABLED, saveStudyPreferences, type StudyPreferences } from "../studyPreferences";
import { byKind, DAY_MS, KINDS, type Daily } from "./model";

const TODAY_BUDGET_SHARE = 0.6; // 晨间单次清单留四成给当天重学，未来预测仍使用完整B。
export type Policy = "current" | "budget";
export const freshKeys = { words: "dailyGoal", grammar: "grammarDailyGoal", kanji: "kanjiDailyGoal", confusion: "confusionDailyGoal" } as const;
export const reviewKeys = { words: "reviewCap", grammar: "grammarReviewCap", kanji: "kanjiReviewCap", confusion: "confusionReviewCap" } as const;
export type Locks = BudgetInput["locked"];

export const budgetOrder = (planned: Record<typeof KINDS[number], number>, done: typeof planned) =>
  [...KINDS].sort((a, b) => done[a] / Math.max(1, planned[a]) - done[b] / Math.max(1, planned[b]));

/** 参数只有应用能观察到的计划、锁定状态和过往完成情况，不能接收 Persona 或 Calibration。 */
export const applyBudgetMorning = (input: { locked: Locks; days: Pick<Daily, "date" | "completed" | "budget">[]; baseline: StudyPreferences }): NonNullable<Daily["budget"]> => {
  const saved = getStudyPreferences(), effective = getEffectiveStudyPreferences();
  const reviewPrefs = { ...effective };
  for (const k of KINDS) if (input.locked[k]?.review === undefined) reviewPrefs[reviewKeys[k]] = input.baseline[reviewKeys[k]];
  // 先按准备恢复的 cap 估 M0；先用昨日低 cap 求解、再恢复自动档，会把低估后的清单突然放大。
  const view = dailyPlanView(reviewPrefs), segments = byKind(k => view.segments.find(s => s.kind === k)!);
  const end = studyDayEnd();
  const ends = Array.from({ length: 29 }, (_, i) => new Date(end.getTime() + i * DAY_MS));
  const eligible = byKind(k => k === "words" ? WORD_FSRS.eligible : k === "grammar" ? grammarReviewEntity(PLAN_GRAMMAR_LEVEL).eligible : "known_forever=0 AND seen_count>0");
  const prior = byKind(k => forecastPriorReleases(k, ends, eligible[k]));
  const contentLeft = byKind(k => {
    if (k === "words") return remainingPlanWords("kana", levelAdvanceTarget(k), undefined, saved.includeOptionalExpressions);
    if (k === "grammar") return firstValue<number>(`SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id=p.grammar_id
      WHERE p.known_forever=0 AND p.seen_count=0 AND g.level IN (${scopeLevels(PLAN_GRAMMAR_LEVEL).map(l => `'${l}'`).join(",")})`, [], 0);
    return segments[k].pool.unseen;
  });
  const intake = getJlptPlanStatus().plan.intakeDaysLeft;
  const paused = byKind(k => (k === "words" || k === "grammar") && levelAdvanceNewCap(k) !== null);
  const need = byKind(k => {
    if (!contentLeft[k] || paused[k] || k === "words" && kanaGatePending()) return 0;
    if (!effective.jlptPlanEnabled) return input.baseline[freshKeys[k]];
    // 原圆环绑定考级；95%选了往上后，额外开放级别也必须摊进同一个剩余进新窗口。
    return intake > 0 ? Math.max(segments[k].suggest.fresh, Math.ceil(contentLeft[k] / intake)) : 0;
  });
  // 第二轮：五十音也是在学的时间（模拟器按单词秒数扣时）。第一轮漏了它，zero 前两周天天学满可用时间，B 仍只有 2.5 分钟。
  const history = rowsFor(`SELECT d, SUM(seconds)/60 AS minutes FROM (
    ${KINDS.map(k => `SELECT reviewed_on AS d, COUNT(*)*${SECONDS_PER_CARD[k]} AS seconds FROM ${PRIOR_ENTITIES[k].reviews}
      WHERE reviewed_on < ? GROUP BY reviewed_on`).join(" UNION ALL ")}
    UNION ALL SELECT reviewed_on AS d, COUNT(*)*${SECONDS_PER_CARD.words} AS seconds FROM kana_reviews WHERE reviewed_on < ? GROUP BY reviewed_on
    ) GROUP BY d HAVING SUM(seconds)>0 ORDER BY d DESC LIMIT 14`, [...KINDS.map(() => today()), today()]).reverse().map(row => {
    const observed = input.days.find(d => d.date === row.d);
    return { minutes: Number(row.minutes), completed: observed?.completed ?? false };
  });
  const mandatoryToday = byKind(k => segments[k].review);
  const uncappedToday = byKind(k => (view.priorExtras?.[k] ?? 0) + (k === "words" ? view.wordExtras : 0));
  const yesterday = input.days.slice(-1)[0]?.budget;
  const previous = yesterday?.appliedFresh;
  const day: Omit<BudgetInput, "budgetMinutes"> = { seconds: SECONDS_PER_CARD, mandatoryToday, uncappedToday,
    dueForecast: byKind(k => ends.slice(1).map((nextEnd, i) => {
      const e = PRIOR_ENTITIES[k];
      return firstValue<number>(`SELECT COUNT(*) FROM ${e.table} WHERE ${eligible[k]}
        AND fsrs_due>? AND fsrs_due<=? AND NOT ${pendingPriorSql(k, `${e.table}.${e.idColumn}`)}`,
      [ends[i].toISOString(), nextEnd.toISOString()], 0);
    })), priorForecast: byKind(k => prior[k].slice(1)), need, contentLeft, locked: input.locked, previousFresh: previous,
    maxFresh: { words: 50, grammar: 30, kanji: 50, confusion: 20 } };
  const fallbackMinutes = allocateDay({ ...day, budgetMinutes: 1e9, maxScale: 1, previousFresh: undefined }).peakMinutes;
  const B = inferBudgetMinutes({ history, fallbackMinutes,
    previous: yesterday && { B: yesterday.B, binding: !!input.days[input.days.length - 1]?.completed && yesterday.scale < DEFAULT_MAX_SCALE } });
  const budgetMinutes = B * BUDGET_HEADROOM;
  const allocation = allocateDay({ ...day, budgetMinutes, todayBudgetMinutes: budgetMinutes * TODAY_BUDGET_SHARE });
  const patch: Partial<StudyPreferences> = {};
  for (const k of KINDS) {
    if (input.locked[k]?.fresh === undefined) patch[freshKeys[k]] = allocation.fresh[k];
    if (input.locked[k]?.review !== undefined) continue;
    const limit = allocation.reviewLimit[k];
    // 单词的0是自动/-1是不限，现有生产入口最低只能给1；另三类用专用关闭哨兵。
    // 第二轮：不过载的日子把 cap 还原成起步时的值（通常是自动档）。第一轮只在过载日写、之后不恢复，
    // 上班族种子1第 11 天写下的单词 cap 9 一直用到第 90 天，到期积压涨到 219 张，清单反而越排越短。
    patch[reviewKeys[k]] = limit === null ? input.baseline[reviewKeys[k]]
      : k === "words" ? Math.max(1, limit) : limit || PLAN_REVIEW_DISABLED;
  }
  // 不走saveDailyPlan：0/0圆环段会写坏未分配的cap。逐字段验算整个偏好对象，含钉住字段。
  saveStudyPreferences({ ...saved, ...patch });
  const after = getStudyPreferences();
  for (const key of Object.keys(saved) as (keyof StudyPreferences)[]) {
    if (!(key in patch)) expect(after[key], `预算未分配字段 ${key} 必须原样保存`).toEqual(saved[key]);
  }
  for (const k of KINDS) {
    if (input.locked[k]?.fresh !== undefined) expect(after[freshKeys[k]]).toBe(saved[freshKeys[k]]);
    if (input.locked[k]?.review !== undefined) expect(after[reviewKeys[k]]).toBe(saved[reviewKeys[k]]);
  }
  return { B, M0: KINDS.reduce((s, k) => s + mandatoryToday[k] * SECONDS_PER_CARD[k] / 60, 0),
    scale: allocation.scale, overloaded: allocation.overloaded, peakMinutes: allocation.peakMinutes,
    fresh: allocation.fresh, appliedFresh: byKind(k => after[freshKeys[k]]), need, contentLeft, paused };
};
