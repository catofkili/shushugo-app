import { firstValue, rowsFor, type DbRow } from "../database/db-utils";

/**
 * 成就判据要用到的全部统计量，一次取齐。
 *
 * 全部从数据库的真实历史算，不另攒计数器 —— 这样成就系统上线后，**以前发生过的事
 * 也追认**：你六月连着点过 14 次「忘记」，装上这版就能立刻拿到「先冷静」。
 * 另攒计数器还会重蹈 userProfile 那个覆辙（见 study-totals.ts）。
 *
 * 时区：reviews.reviewed_on 写的是学习日（本地日期），按天统计一律用它；
 * created_at 存的是 UTC，要看「几点钟」必须自己补偏移，不能用 SQLite 的 localtime
 * —— sql.js 跑在 WASM 里，那个修饰符拿到的时区不可信。
 */
export interface AchievementStats {
  totalReviews: number;
  totalKnow: number;
  knownForeverTotal: number;
  distinctWords: number;
  longestKnowStreak: number;
  longestForgotStreak: number;
  studyDays: number;
  longestDayStreak: number;
  longestComebackGap: number;
  nightReviews: number;
  earlyReviews: number;
  maxReviewsInDay: number;
  maxMinutesInDay: number;
  minutesTotal: number;
  shortestStudyDayMinutes: number;
  bestDailyAccuracy: number;
  worstDailyFuzzyShare: number;
  maxKnownForeverInDay: number;
  masteredWords: number;
  leeches: number;
  relapsedForever: number;
  thriceForgotSameDay: number;
  dueBacklog: number;
  notes: number;
  confusionMastered: number;
  favorites: number;
  reverseReviews: number;
  kanjiWords: number;
  grammarPoints: number;
  daysSinceFirst: number;
  studiedOnNewYear: number;
  studiedOnLeapDay: number;
  sameSecondBurst: number;
  dayAndNight: number;
}

const safeRows = (sql: string): DbRow[] => {
  try {
    return rowsFor(sql);
  } catch {
    return [];
  }
};

const num = (sql: string, params: (string | number)[] = []): number => {
  try {
    return Number(firstValue<number>(sql, params, 0) ?? 0);
  } catch {
    // 老库里可能压根没有某张表（word_notes、content_favorites 都是后来加的）。
    // 少一张表只该让对应的成就拿不到，不该把整个结算炸掉。
    return 0;
  }
};

/** 本地时区相对 UTC 的偏移，写成 SQLite 的 '+8 hours' 这种修饰符 */
const localOffsetModifier = (): string => {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  return `${sign}${Math.abs(minutes)} minutes`;
};

/** 最长连续同一种作答（按作答顺序，不分词）—— 「先冷静」这类判据的本体 */
const longestAnswerStreak = (answer: string): number => num(`
  WITH ordered AS (SELECT answer, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM reviews),
  grouped AS (
    SELECT answer, rn - ROW_NUMBER() OVER (PARTITION BY answer ORDER BY rn) AS island
    FROM ordered
  )
  SELECT COALESCE(MAX(runs.streak), 0) FROM (
    SELECT COUNT(*) AS streak FROM grouped WHERE answer = ? GROUP BY island
  ) AS runs
`, [answer]);

/** 连续学习天数里最长的一段，以及「断了最久又回来」的那个空档 */
const dayStreaks = (): { longest: number; longestGap: number } => {
  const days = safeRows(`
    SELECT day FROM (
      SELECT DISTINCT reviewed_on AS day FROM reviews
      UNION
      SELECT studied_on AS day FROM word_study_time WHERE seconds > 0
    ) WHERE day IS NOT NULL AND day <> '' ORDER BY day
  `).map((row) => String(row.day));

  let longest = days.length ? 1 : 0;
  let current = days.length ? 1 : 0;
  let longestGap = 0;
  for (let index = 1; index < days.length; index += 1) {
    const previous = Date.parse(`${days[index - 1]}T00:00:00Z`);
    const gap = Math.round((Date.parse(`${days[index]}T00:00:00Z`) - previous) / 86400000);
    if (gap === 1) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
      // 空档 = 中间断掉的天数；后面还有学习日才算「回来了」
      longestGap = Math.max(longestGap, gap - 1);
    }
  }
  return { longest, longestGap };
};

/**
 * 每个字段都懒算并记住结果。
 *
 * 结算成就时只会碰到「还没解锁的那些」用到的字段 —— 两条 window function 的连击
 * 查询、几趟全表扫描加起来 281ms，全算一遍挂在学习页每分钟跑一次就是肉眼可见的卡顿。
 * 拿到「先冷静」和「再冷静一点」之后，连击那两条查询这辈子都不用再跑了。
 * 成就页要铺满整张表，那里才会把字段全碰一遍。
 */
const lazyStats = (spec: { [K in keyof AchievementStats]: () => number }): AchievementStats => {
  const cache = new Map<string, number>();
  const out = {} as AchievementStats;
  (Object.keys(spec) as (keyof AchievementStats)[]).forEach((key) => {
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => {
        if (!cache.has(key as string)) cache.set(key as string, spec[key]());
        return cache.get(key as string) as number;
      }
    });
  });
  return out;
};

export const achievementStats = (): AchievementStats => {
  const offset = localOffsetModifier();
  const hourExpr = `CAST(strftime('%H', datetime(created_at, '${offset}')) AS INTEGER)`;
  let streakCache: { longest: number; longestGap: number } | null = null;
  const streaks = () => (streakCache ??= dayStreaks());

  return lazyStats({
    totalReviews: () => num("SELECT COUNT(*) FROM reviews"),
    totalKnow: () => num("SELECT COUNT(*) FROM reviews WHERE answer IN ('know','known_forever')"),
    knownForeverTotal: () => num("SELECT COUNT(*) FROM reviews WHERE answer = 'known_forever'"),
    distinctWords: () => num("SELECT COUNT(DISTINCT word_id) FROM reviews"),
    longestKnowStreak: () => longestAnswerStreak("know"),
    longestForgotStreak: () => longestAnswerStreak("forgot"),
    studyDays: () => num(`
      SELECT COUNT(*) FROM (
        SELECT reviewed_on AS day FROM reviews
        UNION
        SELECT studied_on FROM word_study_time WHERE seconds > 0
      )
    `),
    longestDayStreak: () => streaks().longest,
    longestComebackGap: () => streaks().longestGap,
    nightReviews: () => num(`SELECT COUNT(*) FROM reviews WHERE ${hourExpr} BETWEEN 0 AND 3`),
    earlyReviews: () => num(`SELECT COUNT(*) FROM reviews WHERE ${hourExpr} BETWEEN 5 AND 7`),
    maxReviewsInDay: () => num("SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) AS n FROM reviews GROUP BY reviewed_on)"),
    maxMinutesInDay: () => num("SELECT COALESCE(MAX(seconds),0)/60 FROM word_study_time"),
    minutesTotal: () => num("SELECT COALESCE(SUM(seconds),0)/60 FROM word_study_time"),
    shortestStudyDayMinutes: () => num(`
      SELECT COALESCE(MIN(seconds), 0)/60 FROM word_study_time WHERE seconds > 0
    `),
    // 当天答满 100 次才算数,不然三题全对就是 100%
    bestDailyAccuracy: () => num(`
      SELECT COALESCE(MAX(rate), 0) FROM (
        SELECT SUM(CASE WHEN answer IN ('know','known_forever') THEN 1.0 ELSE 0 END) / COUNT(*) AS rate
        FROM reviews GROUP BY reviewed_on HAVING COUNT(*) >= 100
      )
    `),
    worstDailyFuzzyShare: () => num(`
      SELECT COALESCE(MAX(share), 0) FROM (
        SELECT SUM(CASE WHEN answer = 'fuzzy' THEN 1.0 ELSE 0 END) / COUNT(*) AS share
        FROM reviews GROUP BY reviewed_on HAVING COUNT(*) >= 50
      )
    `),
    maxKnownForeverInDay: () => num(`
      SELECT COALESCE(MAX(n), 0) FROM (
        SELECT COUNT(*) AS n FROM reviews WHERE answer = 'known_forever' GROUP BY reviewed_on
      )
    `),
    masteredWords: () => num(`
      SELECT COUNT(*) FROM progress
      WHERE fsrs_due IS NOT NULL AND fsrs_last_review IS NOT NULL
        AND julianday(fsrs_due) - julianday(fsrs_last_review) >= 180
    `),
    leeches: () => num("SELECT COUNT(*) FROM progress WHERE COALESCE(fsrs_lapses, 0) >= 8"),
    // 点过「熟知」（本以为一辈子不用再见）之后又忘了的词
    relapsedForever: () => num(`
      SELECT COUNT(*) FROM (
        SELECT word_id FROM reviews WHERE answer = 'known_forever'
        INTERSECT
        SELECT word_id FROM reviews WHERE answer = 'forgot'
          AND id > (SELECT MIN(id) FROM reviews r2 WHERE r2.word_id = reviews.word_id AND r2.answer = 'known_forever')
      )
    `),
    thriceForgotSameDay: () => num(`
      SELECT COUNT(*) FROM (
        SELECT word_id FROM reviews WHERE answer = 'forgot'
        GROUP BY word_id, reviewed_on HAVING COUNT(*) >= 3
      )
    `),
    dueBacklog: () => num("SELECT COUNT(*) FROM progress WHERE fsrs_due IS NOT NULL AND date(fsrs_due) <= date('now','localtime')"),
    notes: () => num("SELECT COUNT(*) FROM word_notes WHERE TRIM(note) <> ''"),
    confusionMastered: () => num("SELECT COUNT(*) FROM confusion_mastered"),
    favorites: () => num("SELECT COUNT(*) FROM content_favorites"),
    reverseReviews: () => num("SELECT COUNT(*) FROM reviews WHERE direction <> 'forward'"),
    kanjiWords: () => num("SELECT COUNT(*) FROM kanji_reading_memory WHERE seen_count > 0"),
    grammarPoints: () => num("SELECT COUNT(*) FROM grammar_progress"),
    daysSinceFirst: () => num(`
      SELECT COALESCE(CAST(julianday('now','localtime') - julianday(MIN(reviewed_on)) AS INTEGER), 0) FROM reviews
    `),
    studiedOnNewYear: () => num("SELECT COUNT(*) FROM reviews WHERE strftime('%m-%d', reviewed_on) = '01-01'"),
    studiedOnLeapDay: () => num("SELECT COUNT(*) FROM reviews WHERE strftime('%m-%d', reviewed_on) = '02-29'"),
    sameSecondBurst: () => num(`
      SELECT COALESCE(MAX(n), 0) FROM (
        SELECT COUNT(*) AS n FROM reviews GROUP BY created_at
      )
    `),
    // 同一天里既在凌晨三点答过题,也在早上七点答过题
    dayAndNight: () => num(`
      SELECT COUNT(*) FROM (
        SELECT reviewed_on FROM reviews
        GROUP BY reviewed_on
        HAVING SUM(CASE WHEN ${hourExpr} = 3 THEN 1 ELSE 0 END) > 0
           AND SUM(CASE WHEN ${hourExpr} = 7 THEN 1 ELSE 0 END) > 0
      )
    `)
  });
};
