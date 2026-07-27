/**
 * 打卡日期的小工具 —— 主页问候条与温泉页共用。
 *
 * 打卡日期一律是 study-core 的「学习日」字符串(YYYY-MM-DD),不是自然日,
 * 所以这里只做纯字符串/UTC 运算,绝不碰本地时区,免得跨零点时多算或少算一天。
 */

const DAY = 86400000;

const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * 是不是一个能算的日期串。
 * 词库还没加载好时调用方拿到的是空串,直接丢给 Date 会抛 RangeError 把整页炸掉,
 * 所以这里统一拦一道,调用方只会拿到「0 天 / 空周」这种安全的空结果。
 */
const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(toUtc(day));

/** day 往前/往后偏移若干天,返回同样的 YYYY-MM-DD;day 非法时原样返回 */
export const shiftDay = (day: string, delta: number) =>
  isDay(day) ? fromUtc(toUtc(day) + delta * DAY) : day;

/**
 * 连续打卡天数。
 * 今天还没打卡时不算断签 —— 从昨天往前数,这样白天打开 app 看到的仍是昨天攒下的连击,
 * 而不是先被清零再涨回去(和「断签不惩罚」的设计一致)。
 */
export const computeStreak = (checkins: string[], today: string): number => {
  if (!isDay(today)) return 0;
  const set = new Set(checkins);
  let cursor = set.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
};

/** 含 today 的这一周(周一起算)的 7 个日期;today 非法时返回空数组 */
export const weekDays = (today: string): string[] => {
  if (!isDay(today)) return [];
  const weekday = new Date(toUtc(today)).getUTCDay(); // 0=周日
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  const monday = shiftDay(today, -backToMonday);
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
};
