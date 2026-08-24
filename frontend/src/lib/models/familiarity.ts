import { rowsFor } from "../database/db-utils";

/**
 * 「这个词值不值得拿来当易混词」。
 *
 * 易混词的用处是提醒「看到这个题面，你可能会写出那个词」。**没学过的词写不出来。**
 * 实测用户真在学的那些卡，音形相近候选里 74% 是他从没学过的词、58% 既没学过又比
 * 这张卡难 —— 安心(N4) 旁边挂个 暗然(N1)，纯属噪音，还把真正会混的候选挤出了前三名。
 *
 * 判据两条，满足一条就留：
 *  1. 学过（progress 里有行）—— 学过就写得出来，级别再高也算数；
 *  2. 不比当前这张难 —— 新用户 progress 是空的，这条保证他照样有易混词看。
 *
 * 「无级」按中间算：那不是生僻词，是用户自己导进来的词表（实测 454 个里学了 419 个）。
 */
const JLPT_RANK: Record<string, number> = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };
const UNLEVELED_RANK = 2.5;

export const jlptRank = (level: string): number => JLPT_RANK[level] ?? UNLEVELED_RANK;

let studiedCache: Set<number> | null = null;

export const resetFamiliarityCache = (): void => {
  studiedCache = null;
};

/**
 * 学过的词。一个会话里只查一次 —— 今天刚见第一面的词本来也算不上「会混」，
 * 等下次开会话再算进来正合适。
 */
export const studiedWordIds = (): Set<number> => {
  if (studiedCache) return studiedCache;
  try {
    studiedCache = new Set(
      rowsFor("SELECT word_id FROM progress WHERE fsrs_last_review IS NOT NULL OR fsrs_due IS NOT NULL")
        .map((row) => Number(row.word_id ?? 0))
        .filter((id) => id > 0)
    );
  } catch {
    // 种子库/测试库里可能根本没有 progress 表 —— 那就只按级别判
    studiedCache = new Set();
  }
  return studiedCache;
};

export const worthComparing = (myLevel: string, theirLevel: string, theirId: number): boolean =>
  jlptRank(theirLevel) <= jlptRank(myLevel) || studiedWordIds().has(theirId);
