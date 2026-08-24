import { getDatabase } from "./database";
import { duplicateMergeTargets, resetConfusionGroups } from "./confusion-groups";
import { firstValue, persistSoon, rowsFor } from "./database/db-utils";
import { mergeWordInto, remapSessionStateWordIds } from "./legacy-word-migrations";
import { notifyProgressUpdated } from "./progress-events";
import { resetWordLibraryCaches } from "./word-library";
import { resetQuestionMeaningIndex } from "./models/question-meaning-index";
import { resetUserQuestionMeanings } from "./models/user-question-meanings";

/**
 * 合并老库里同一个词录了两遍的行。
 *
 * 去重当年**刻意没做数据迁移**：直接删行会把挂在那行上的学习记录一起删掉，
 * 所以一直只在辨析那几条路上「显示时挡住」。代价是这些行还躺在词库和新词池里 ——
 * 用户已经学到 25 次的 一昨日 旁边，还有一行从没出现过的 おととい 显示「未学」，
 * 而且迟早会被当成新词教一遍（实测用户库里 37 组两行都学过了）。
 *
 * 这里把记录**先搬走再删行**：`mergeWordInto` 逐表把流水、便签、收藏、三个方向的
 * 记忆和当天任务挂到存活的那行上，然后删掉重复的词条行。删除走同步触发器写墓碑，
 * 另一台设备不会把它复活。
 *
 * 判据用的还是 `duplicateMergeTargets()` —— 和辨析同一份，不另起一套。
 */

export interface DuplicateMergePair {
  /** 要被合并掉的那行 */
  fromId: number;
  /** 合并到哪一行 */
  intoId: number;
  fromLabel: string;
  intoLabel: string;
  /** 这行上压着多少条作答 */
  reviews: number;
  /** 两行都学过 = 同一个词学了两遍 */
  bothStudied: boolean;
}

export interface DuplicateMergePlan {
  pairs: DuplicateMergePair[];
  /** 会被搬走的作答条数 */
  reviews: number;
  /** 两边都学过的组数 */
  bothStudied: number;
}

const label = (row: { kanji?: unknown; kana?: unknown }): string => {
  const kanji = String(row.kanji ?? "");
  const kana = String(row.kana ?? "");
  return kanji && kanji !== kana ? `${kanji}/${kana}` : kana || kanji;
};

/** 先看看会发生什么。不写任何数据。 */
export function duplicateMergePlan(): DuplicateMergePlan {
  const targets = duplicateMergeTargets();
  if (!targets.size) return { pairs: [], reviews: 0, bothStudied: 0 };

  const rows = rowsFor(`
    SELECT w.id, w.kanji, w.kana, COALESCE(p.seen_count, 0) AS seen_count,
           (SELECT COUNT(*) FROM reviews r WHERE r.word_id = w.id) AS reviews
    FROM words w
    LEFT JOIN progress p ON p.word_id = w.id
  `);
  const byId = new Map(rows.map((row) => [Number(row.id), row]));

  const pairs: DuplicateMergePair[] = [];
  targets.forEach((intoId, fromId) => {
    const from = byId.get(fromId);
    const into = byId.get(intoId);
    // 词表导入过的库里可能已经没有这行了，跳过而不是炸掉整轮合并
    if (!from || !into) return;
    pairs.push({
      fromId,
      intoId,
      fromLabel: label(from),
      intoLabel: label(into),
      reviews: Number(from.reviews ?? 0),
      bothStudied: Number(from.seen_count ?? 0) > 0 && Number(into.seen_count ?? 0) > 0
    });
  });

  return {
    pairs,
    reviews: pairs.reduce((sum, pair) => sum + pair.reviews, 0),
    bothStudied: pairs.filter((pair) => pair.bothStudied).length
  };
}

export interface DuplicateMergeReport {
  merged: number;
  movedReviews: number;
  /** 合并前后的作答总数 —— 必须相等，一条都不能丢 */
  reviewsBefore: number;
  reviewsAfter: number;
}

/**
 * 真正执行合并。整轮一个事务，中途出错全部回滚。
 * 调用方（UI）负责先存恢复点 —— 这一步不可逆。
 */
export function mergeDuplicateWords(): DuplicateMergeReport {
  const plan = duplicateMergePlan();
  const db = getDatabase();
  const reviewsBefore = firstValue<number>("SELECT COUNT(*) FROM reviews", [], 0);
  if (!plan.pairs.length) {
    return { merged: 0, movedReviews: 0, reviewsBefore, reviewsAfter: reviewsBefore };
  }

  // 会话状态里的 word_id 一次性改写：合并完那些 id 就不存在了
  const remap = new Map(plan.pairs.map((pair) => [pair.fromId, pair.intoId]));
  let movedReviews = 0;

  db.run("BEGIN TRANSACTION");
  try {
    plan.pairs.forEach((pair) => {
      movedReviews += mergeWordInto(db, pair.fromId, pair.intoId);
    });
    remapSessionStateWordIds((wordId) => remap.get(wordId) ?? wordId);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  // 词条行没了，两个按词形建的索引必须重建，否则还按老表判重
  resetConfusionGroups();
  resetWordLibraryCaches();
  // 合并会把被删那行上的手改题面搬到存活的行(mergeWordInto 里那条 replaceSingleRow),
  // 缓存不清的话题面还挂在已经不存在的 word_id 上。
  resetUserQuestionMeanings();
  resetQuestionMeaningIndex();
  persistSoon();
  notifyProgressUpdated();

  return {
    merged: plan.pairs.length,
    movedReviews,
    reviewsBefore,
    reviewsAfter: firstValue<number>("SELECT COUNT(*) FROM reviews", [], 0)
  };
}
