import { rowsFor, studyDate } from "../study-core";
import { STUBBORN_DAILY_MISTAKES } from "../fsrs-scheduler";

/**
 * 「累计忘过几次」的门槛。
 *
 * ⚠️ **这里用的是 `progress.forgot_count`，不是 `fsrs_lapses`。** 两者听起来是一回事，
 * 实际差一个数量级：`fsrs_lapses` 只在**复习态**的卡答错时 +1，当天重学阶段再错多少次都不加，
 * 而且顽固词每天最多放 `LEECH_DAILY_INTAKE`(10) 个进计划 —— 于是「lapses>8 且今天错≥3」
 * 在用户真实库上**一天 0~2 个**（2026-08-26~09-01 实测：0,1,1,2,1,0,1），
 * 完成页那张表几乎永远是空的，他当天就发现「快速复习当天顽固没出来」。
 *
 * `forgot_count` 才是字面意义上的「你一共点过多少次忘记」，不受状态和闸门影响。
 * 换成它之后同期是 6,9,11,14,23,16,15 —— 平均 13 个，正好是一张能扫一眼的表。
 */
const STUBBORN_TOTAL_FORGOTS = 8;

export interface StubbornWordToday {
  id: number;
  kanji: string;
  kana: string;
  meaning: string;
  /** 历史累计点过多少次「忘记」。 */
  lapses: number;
  /** 今天答「忘记/模糊」的次数。 */
  wrongToday: number;
  isFavorite: boolean;
}

/**
 * 今天碰过、且顽固的正向卡。
 *
 * 判据是**两条都要满足**（2026-09-01 收紧，原来是 OR）：
 *   - 累计点过 > `STUBBORN_TOTAL_FORGOTS`(8) 次「忘记」（见上面为什么不是 fsrs_lapses）；
 *   - **今天**答错 ≥ `STUBBORN_DAILY_MISTAKES`(3) 次。
 *
 * ⚠️ **单看累计不行。** 顽固词是历史账，一个 lapses=20 的词今天一次就答对了，
 * 它今天并不顽固 —— 按 OR 算的话，只要它今天露过面就上榜，这张表就成了
 * 「今天出现过的所有 leech」，而不是「今天跟我打了一架的词」。
 * 反过来只看当天也不行：新词第一天磕三次是正常的学习过程，不是顽固。
 *
 * 只看 direction='forward'：完成页说的是经典模式这一场，和「每日学习量」同一把尺子
 * （见 CLAUDE.md「只数正向」那条）。
 */
export const getStubbornWordsToday = (day: string = studyDate()): StubbornWordToday[] =>
  rowsFor(`
    SELECT * FROM (
      SELECT
        w.id AS id, w.kanji AS kanji, w.kana AS kana, w.meaning AS meaning,
        COALESCE(p.forgot_count, 0) AS lapses,
        (SELECT COUNT(*) FROM reviews r
          WHERE r.word_id = w.id AND r.reviewed_on = ? AND r.direction = 'forward'
            AND r.answer IN ('forgot','fuzzy')) AS wrong_today,
        EXISTS(SELECT 1 FROM content_favorites cf
          WHERE cf.item_type = 'word' AND cf.item_id = CAST(w.id AS TEXT)) AS favorited
      FROM words w
      JOIN progress p ON p.word_id = w.id
      WHERE w.id IN (
        SELECT DISTINCT word_id FROM reviews WHERE reviewed_on = ? AND direction = 'forward'
      )
    )
    WHERE lapses > ? AND wrong_today >= ?
    ORDER BY wrong_today DESC, lapses DESC, id ASC
  `, [day, day, STUBBORN_TOTAL_FORGOTS, STUBBORN_DAILY_MISTAKES]).map((row) => ({
    id: Number(row.id ?? 0),
    kanji: String(row.kanji ?? ""),
    kana: String(row.kana ?? ""),
    meaning: String(row.meaning ?? ""),
    lapses: Number(row.lapses ?? 0),
    wrongToday: Number(row.wrong_today ?? 0),
    isFavorite: Number(row.favorited ?? 0) === 1
  }));

export interface StubbornGrammarToday {
  id: number;
  pattern: string;
  meaning: string;
  level: string;
  lapses: number;
  wrongToday: number;
}

/**
 * 今天碰过、且顽固的语法条目。**判据和单词一模一样**（累计忘 > 8 次 且 今天错 ≥ 3 次），
 * 只是换了三张表 —— 混合模式里语法和单词是同一场，完成页只列单词等于说了一半。
 *
 * 实测用户库（2026-09-06，当天答了 290 条语法）按这条判据出 8 行，和单词那张表一个量级。
 *
 * 不按等级过滤：今天答过的就是今天这场答的，用户在哪一级考的表自己会说。
 * ⚠️ **没有收藏按钮**：语法收藏存的是 grammar.ts 的字符串 id，而这里只有
 * grammar_points 的数字 id，桥接要按 pattern 去匹配那份 1.2MB 的语法数据
 * （见 CLAUDE.md「语法有两份进度」）。为一颗星把它拉进完成页不划算，
 * 要收藏去语法列表页点。
 */
export const getStubbornGrammarToday = (day: string = studyDate()): StubbornGrammarToday[] =>
  rowsFor(`
    SELECT * FROM (
      SELECT
        g.id AS id, g.pattern AS pattern, g.meaning AS meaning, g.level AS level,
        COALESCE(p.forgot_count, 0) AS lapses,
        (SELECT COUNT(*) FROM grammar_reviews r
          WHERE r.grammar_id = g.id AND r.reviewed_on = ?
            AND r.answer IN ('forgot','fuzzy')) AS wrong_today
      FROM grammar_points g
      JOIN grammar_progress p ON p.grammar_id = g.id
      WHERE g.id IN (
        SELECT DISTINCT grammar_id FROM grammar_reviews WHERE reviewed_on = ?
      )
    )
    WHERE lapses > ? AND wrong_today >= ?
    ORDER BY wrong_today DESC, lapses DESC, id ASC
  `, [day, day, STUBBORN_TOTAL_FORGOTS, STUBBORN_DAILY_MISTAKES]).map((row) => ({
    id: Number(row.id ?? 0),
    pattern: String(row.pattern ?? ""),
    meaning: String(row.meaning ?? ""),
    level: String(row.level ?? ""),
    lapses: Number(row.lapses ?? 0),
    wrongToday: Number(row.wrong_today ?? 0)
  }));

export interface StubbornDay {
  /** 学习日（凌晨四点切日，和 studyDate() 同一把尺子）。 */
  date: string;
  words: number;
  grammar: number;
}

/**
 * 今天**之前**每天的顽固清单有多少条 —— 「回看过去某天跟我打过架的词」那份日历。
 *
 * ⚠️ **判据里的「累计忘过几次」用的是 `progress.forgot_count` 的当前值，不是那天的值。**
 * 也就是说这份历史是「以今天的眼光回看那天」：一个词上个月只忘过 3 次、这个月忘到 12 次，
 * 它会补进上个月那天的名单里。要按「当天的累计」算就得对每个 (天, 词) 去数一遍截止那天的
 * 流水，而这条判据在今天那张表上本来就是拿 forgot_count 说话的 —— 两处口径分家比这点偏差贵。
 * （顺带：forgot_count 不分方向，而当天那次错必须是 forward，这条和今天那张表一致。）
 *
 * 不在 SQL 里 LIMIT：单词和语法各查一次再取并集，先截断会让两边的日子对不上。
 */
export const getStubbornHistoryDays = (limit = 60): StubbornDay[] => {
  const today = studyDate();
  const countsFor = (sql: string): Map<string, number> => new Map(
    rowsFor(sql, [today, STUBBORN_DAILY_MISTAKES, STUBBORN_TOTAL_FORGOTS])
      .map((row) => [String(row.day ?? ""), Number(row.n ?? 0)] as const)
  );
  const words = countsFor(`
    SELECT day, COUNT(*) AS n FROM (
      SELECT r.reviewed_on AS day, r.word_id AS wid, COUNT(*) AS wrong
      FROM reviews r
      WHERE r.direction = 'forward' AND r.answer IN ('forgot','fuzzy') AND r.reviewed_on < ?
      GROUP BY r.reviewed_on, r.word_id
    ) x
    JOIN progress p ON p.word_id = x.wid
    WHERE x.wrong >= ? AND COALESCE(p.forgot_count, 0) > ?
    GROUP BY day
  `);
  const grammar = countsFor(`
    SELECT day, COUNT(*) AS n FROM (
      SELECT r.reviewed_on AS day, r.grammar_id AS gid, COUNT(*) AS wrong
      FROM grammar_reviews r
      WHERE r.answer IN ('forgot','fuzzy') AND r.reviewed_on < ?
      GROUP BY r.reviewed_on, r.grammar_id
    ) x
    JOIN grammar_progress p ON p.grammar_id = x.gid
    WHERE x.wrong >= ? AND COALESCE(p.forgot_count, 0) > ?
    GROUP BY day
  `);
  return [...new Set([...words.keys(), ...grammar.keys()])]
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, limit)
    .map((date) => ({ date, words: words.get(date) ?? 0, grammar: grammar.get(date) ?? 0 }));
};
