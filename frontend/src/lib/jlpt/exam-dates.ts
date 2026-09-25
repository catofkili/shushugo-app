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

export const EXAM_TYPES = [
  { kind: "jlpt", label: "JLPT" },
  { kind: "eju", label: "EJU 留考" },
  { kind: "kaoyan", label: "考研日语" },
  { kind: "university", label: "大学日语四/六级" },
  { kind: "major", label: "日语专四/专八" },
  { kind: "jtest", label: "J.TEST" },
  { kind: "nat", label: "NAT-TEST" },
  { kind: "bjt", label: "BJT 商务日语" },
  { kind: "gaokao", label: "高考日语" },
  { kind: "other", label: "其他考试" }
] as const;
export type ExamKind = typeof EXAM_TYPES[number]["kind"];
export const isExamKind = (value: unknown): value is ExamKind => EXAM_TYPES.some((item) => item.kind === value);
export const examLabel = (kind: ExamKind): string => EXAM_TYPES.find((item) => item.kind === kind)?.label ?? "其他考试";

/** 只列当前已公布的国内场次；地区场次和其他年份由用户按准考信息选择。 */
const ANNOUNCED: Partial<Record<ExamKind, string[]>> = {
  eju: ["2026-11-08"],
  jtest: ["2026-11-01"]
};
export const announcedExamDates = (kind: ExamKind, from = new Date()): Date[] =>
  (ANNOUNCED[kind] ?? []).map((value) => parseExamDate(value)!).filter((date) => date >= new Date(from.getFullYear(), from.getMonth(), from.getDate()));

export const suggestedExamDate = (kind: ExamKind, from = new Date()): Date | null => {
  if (kind === "gaokao") return nextGaokaoDate(from);
  if (kind === "jlpt") return nextExamDate(from);
  return announcedExamDates(kind, from)[0] ?? null;
};

/** 高考日语先以 6 月 8 日作默认占位；实际日期按准考证调整。 */
export const nextGaokaoDate = (from: Date = new Date()): Date => {
  const date = new Date(from.getFullYear(), 5, 8);
  return from >= examEndAt("gaokao", date)
    ? new Date(from.getFullYear() + 1, 5, 8) : date;
};

export const defaultExamDate = (kind: ExamKind, from: Date = new Date()): Date =>
  suggestedExamDate(kind, from) ?? new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);

export const examEndAt = (kind: ExamKind, date: Date): Date =>
  kind === "gaokao" ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 17)
    : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

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

/** 滚轮中显示接下来的四场；未公布的考期只是按首个周日估算。 */
export const upcomingExamDates = (from: Date = new Date()): Date[] => {
  const next = nextExamDate(from);
  const year = next.getFullYear();
  return [
    ...examDatesOfYear(year),
    ...examDatesOfYear(year + 1),
    ...examDatesOfYear(year + 2)
  ].filter((date) => date >= next).slice(0, 4);
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
