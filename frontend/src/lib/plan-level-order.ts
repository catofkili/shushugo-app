import { firstValue, getState } from "./database/db-utils";
import { JLPT_TARGETS, type JlptTarget } from "./jlpt/plan";
import { getStudyPreferences } from "./studyPreferences";

export type PlanKind = "words" | "grammar" | "kanji" | "confusion";

/**
 * 新内容按级别顺推：计划范围（起点上一级 → 目标）里一级学完再进下一级，超出目标的排到最后。
 * 返回值按 JLPT_TARGETS 下标给每一级一个排序档（越小越先）。
 *
 * ⚠️ 2026-10-28 修：之前单词把 N5/N4/N3 当一档随机、语法只出目标那一级，起点选 N5、考 N3 的人
 * 头 40 个新词里 30 个是 N3，N4 语法一条都不出。起点先验把起点及以下写成「学过」，新内容就必须
 * 从先验没盖到的那一级接着往上走，否则先验和投放各说各话。
 *
 * - 起点那一级的熟悉度为 0 时先验不写它（stabilityFor(0) = 0），所以起点那一级也算新内容 ——
 *   和 daily-plan.ts 的 remainingPlanWords 同一条判据。
 * - 起点以下的级别排第 0 档：先验都写成了学过，剩下的没见过的只会是基础漏网的，先补。
 * - 不懂五十音 / 会五十音 / 专业进阶 / 没设过起点：从 N5 顺推。
 */
export const firstPlanLevelIndex = (startingLevel: string | null | undefined, familiarity: number | undefined): number => {
  const start = JLPT_TARGETS.indexOf(startingLevel as JlptTarget);
  return start < 0 ? 0 : start + (familiarity === 0 ? 0 : 1);
};

export const planLevelRanks = (startingLevel: string | null | undefined, familiarity: number | undefined, target: JlptTarget): number[] => {
  const first = firstPlanLevelIndex(startingLevel, familiarity);
  const last = JLPT_TARGETS.indexOf(target);
  return JLPT_TARGETS.map((_, index) => (index < first ? 0 : index <= last ? index - first : 100 + index));
};

/**
 * 读**先验实际落库时**的起点和熟悉度（level-plan 的 priorSignature 写在 level_prior_applied），
 * 不读自报设置：两周后起点会按真实首答上下调一级再重写先验，投放要跟着落库的那份走。
 * 不直接 import level-plan：它引着 word-api / 汉字 / 辨析，这几处反过来要用本文件，会成环。
 */
const appliedPrior = (): { level: string; familiarity: Partial<Record<PlanKind, number>> } => {
  try {
    const parsed = JSON.parse(getState("level_prior_applied", "") || "null");
    if (parsed && typeof parsed.level === "string") return { level: parsed.level, familiarity: parsed.familiarity ?? {} };
  } catch { /* 坏值按没设过起点处理 */ }
  return { level: "", familiarity: {} };
};

export const currentPlanLevelRanks = (kind: PlanKind): number[] => {
  const prior = appliedPrior();
  return planLevelRanks(prior.level, prior.familiarity[kind], getStudyPreferences().jlptTarget);
};

/** 新内容实际从哪一级开始（JLPT_TARGETS 下标）；它以下的级别是先验写出来的，不算「学完」。 */
export const currentFirstPlanLevelIndex = (kind: PlanKind): number => {
  const prior = appliedPrior();
  return firstPlanLevelIndex(prior.level, prior.familiarity[kind]);
};

/** SQL 版：`column` 是存 'N5'…'N1' 的列；无级别的（基础词、自定义词）排第 0 档。 */
export const planLevelRankSql = (column: string, kind: PlanKind) => {
  const ranks = currentPlanLevelRanks(kind);
  return `CASE ${column} ${JLPT_TARGETS.map((level, index) => `WHEN '${level}' THEN ${ranks[index]}`).join(" ")} ELSE 0 END`;
};

/**
 * 先验写过基线的卡（level_prior_baselines）：它的第一次真实作答是在**验证先验**，不是新学。
 * 「今天新学了几个」按「以前没答过」算的地方都要再排除这一条 ——
 * ⚠️ 2026-10-28 查出：语法的新条目名额按「今天答过、以前没答过」扣，起点 N5 的人复习 5 条先验里的
 * N5 语法就把当天 5 条新语法名额扣光，一条 N4 都出不来；备考页的「新词已做」也被先验复习灌水。
 * 基线在真实作答后仍然保留（汉字 / 辨析重放要用），所以答过之后也认得出来。
 */
export const priorBaselineSql = (kind: PlanKind, keyExpr: string) => (
  // 没建表的库（只建了部分表的旧库 / 测试库）当作没有先验，同 card-log 的 resetToStartingPoint。
  firstValue<number>("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'level_prior_baselines'", [], 0) > 0
    ? `EXISTS (SELECT 1 FROM level_prior_baselines lpb WHERE lpb.entity = '${kind}' AND lpb.entity_key = CAST(${keyExpr} AS TEXT))`
    : "0"
);
