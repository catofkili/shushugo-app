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
export const getStubbornWordsToday = (): StubbornWordToday[] => {
  const day = studyDate();
  return rowsFor(`
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
};
