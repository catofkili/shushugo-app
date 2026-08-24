import { firstValue } from "./database/db-utils";

/**
 * 「一共学了多久 / 一共学了几天」—— 以数据库为准。
 *
 * 在这之前这两个数是 userProfile 在 Capacitor Preferences 里自己攒的一份计数器，
 * 有三个问题：
 *  1. **它根本没在涨**。攒它的 addStudyTime 收到的是秒，每 15 秒 flush 一次，
 *     `Math.floor(15 / 60)` 恒为 0，于是一次都没写进去 —— 个人信息页常年
 *     「累计 0 小时 0 分钟 / 已坚持 0 天」，「坚持者」「大师」两个成就也永远解锁不了。
 *  2. 它不跟着同步走。学习时长真正的账本是 word_study_time（还有按设备分行的
 *     word_study_time_by_device 负责多端合并），换台设备那份计数器从零开始。
 *  3. 它和统计页各算各的，两处能对不上。
 *
 * 所以不再另攒一份，直接问数据库要 —— 和统计页同一个口径。
 */
export interface StudyTotals {
  /** 累计学习分钟数 */
  minutes: number;
  /** 有学习记录的天数 */
  days: number;
}

export const studyTotals = (): StudyTotals => {
  const seconds = firstValue<number>("SELECT SUM(seconds) FROM word_study_time", [], 0) ?? 0;
  // 「学过的天」= 记过时长的天 ∪ 有复习记录的天。只看其中一样都会漏：
  // 计时是 2026-06 之后才有的，而更早的复习记录一直都在。
  const days = firstValue<number>(`
    SELECT COUNT(*) FROM (
      SELECT studied_on AS day FROM word_study_time WHERE seconds > 0
      UNION
      SELECT reviewed_on AS day FROM reviews
    )
  `, [], 0) ?? 0;
  return { minutes: Math.floor(seconds / 60), days };
};
