/**
 * JLPT 考期。纯函数,不读偏好也不读时钟(时间一律从参数传进来)。
 *
 * JLPT 每年两场,固定在 **7 月和 12 月的第一个周日**。
 * 这个规律很稳,但毕竟是外部安排,所以设置页允许手填日期覆盖(见 studyPreferences.jlptExamDate),
 * 这里只负责「没填的时候自动算下一场」。
 */

/** 某年某月的第一个周日。month 用 1-12,不是 Date 的 0-11。 */
export const firstSundayOf = (year: number, month: number): Date => {
  const first = new Date(year, month - 1, 1);
  // getDay(): 0 = 周日。往后推到本月第一个周日。
  const offset = (7 - first.getDay()) % 7;
  return new Date(year, month - 1, 1 + offset);
};

/** 一年里的两场:7 月、12 月 */
export const examDatesOfYear = (year: number): Date[] => [
  firstSundayOf(year, 7),
  firstSundayOf(year, 12)
];

/**
 * 下一场考试。
 *
 * 考试当天仍然算「下一场」(还没考完),所以比较用的是当天零点。
 * 12 月那场过了就跳到明年 7 月。
 */
export const nextExamDate = (from: Date = new Date()): Date => {
  const startOfToday = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const candidates = [
    ...examDatesOfYear(from.getFullYear()),
    ...examDatesOfYear(from.getFullYear() + 1)
  ];
  return candidates.find((date) => date.getTime() >= startOfToday.getTime()) ?? candidates[0];
};

/** "2026-12-06" → Date;格式不对返回 null,调用方回落到 nextExamDate */
export const parseExamDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return date;
};

export const formatExamDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** 给人看的短写法:12 月 6 日 */
export const formatExamDateHuman = (date: Date): string =>
  `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
