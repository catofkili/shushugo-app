import type { SqlValue } from "../study-core";
import type { WordSessionOptions } from "../study-types";

/**
 * 「筛选学习」的 WHERE 片段:等级 + 词性/收藏 + 学习重点。
 * 出题和统计都要按同一套条件过滤,抽出来共用,免得两边口径漂移。
 */

export const MISTAKE_MIN_REVIEWS = 6;
export const MISTAKE_MIN_LAPSES = 4;
/**
 * 光看 lapses 的绝对值不够:复习了 20 次的词攒下 2 次遗忘是正常表现,
 * 复习 6 次就错 4 次才是真有问题。所以再要求「遗忘占复习的比例」达标。
 */
export const MISTAKE_MIN_LAPSE_RATE = 0.2;
export const MISTAKE_MIN_DIFFICULTY = 8.5;
export const MISTAKE_MIN_WRONG_ANSWERS = 3;
export const MISTAKE_MIN_ERROR_RATE = 0.5;
/** 记忆已经这么牢了(天)就不该再算错题:曾经错过是历史,不是现在的问题 */
export const MISTAKE_MAX_STABILITY = 60;

/**
 * 「长期不会」= **现在还在拖后腿**,不是历史上错过。
 *
 * 判据必须同时满足两个前置:复习够多次了(不然是新词的正常磕绊)、
 * 且当前记忆强度还不牢(stability < MISTAKE_MAX_STABILITY);
 * 在此基础上命中三条信号之一:
 *   1. 遗忘次数多**且占比高**;2. 多次复习后难度仍接近满档;
 *   3. 忘记/模糊的加权占比过半。
 *
 * 为什么不用「最近 N 次作答」这种窗口判据:下面那个 TS 版在排片热路径上,
 * 拿不到 reviews 表(见注释),两版判据必须完全一致,所以只用 progress 的列。
 * 用比例代替窗口能达到同样的目的——只增不减的终身计数器会让错题本越攒越大,
 * 而比例会随着答对次数增加自动降下来。
 */
export const mistakeCandidateSql = (progressAlias = "p") => `(
  ${progressAlias}.seen_count >= ${MISTAKE_MIN_REVIEWS}
  AND (
    ${progressAlias}.fsrs_stability IS NULL
    OR ${progressAlias}.fsrs_stability < ${MISTAKE_MAX_STABILITY}
  )
  AND (
    (
      COALESCE(${progressAlias}.fsrs_lapses, 0) >= ${MISTAKE_MIN_LAPSES}
      AND COALESCE(${progressAlias}.fsrs_lapses, 0) * 1.0
          / MAX(COALESCE(${progressAlias}.fsrs_reps, 0), 1) >= ${MISTAKE_MIN_LAPSE_RATE}
    )
    OR (
      COALESCE(${progressAlias}.fsrs_reps, 0) >= ${MISTAKE_MIN_REVIEWS}
      AND COALESCE(${progressAlias}.fsrs_difficulty, 0) >= ${MISTAKE_MIN_DIFFICULTY}
    )
    OR (
      COALESCE(${progressAlias}.forgot_count, 0) + COALESCE(${progressAlias}.fuzzy_count, 0) >= ${MISTAKE_MIN_WRONG_ANSWERS}
      AND (
        COALESCE(${progressAlias}.forgot_count, 0) * 2.0 + COALESCE(${progressAlias}.fuzzy_count, 0)
      ) / MAX(
        COALESCE(${progressAlias}.right_count, 0) + COALESCE(${progressAlias}.forgot_count, 0) * 2.0 + COALESCE(${progressAlias}.fuzzy_count, 0),
        1
      ) >= ${MISTAKE_MIN_ERROR_RATE}
    )
  )
)`;

/**
 * 上面那段 SQL 的 TS 版:同一套阈值,给拿得到 progress 行的调用方用
 * (排片器判断「毕业判定要不要拉远」时在热路径上,不适合再查一次库)。
 * 改口径时**两个都要改**——错题本挑的词和排片认定的长期低分词必须是同一批。
 * filters.parity.test.ts 拿真库把两版跑在同一批行上逐行比对,漂了就红。
 */
export const isLongTermWeak = (row: Record<string, unknown>): boolean => {
  const num = (key: string) => Number(row[key] ?? 0) || 0;
  if (num("seen_count") < MISTAKE_MIN_REVIEWS) return false;
  // stability 为空 = 还没进过调度,按「不牢」处理,和 SQL 的 IS NULL 分支一致
  const stability = row.fsrs_stability == null ? null : num("fsrs_stability");
  if (stability !== null && stability >= MISTAKE_MAX_STABILITY) return false;

  const lapses = num("fsrs_lapses");
  const reps = num("fsrs_reps");
  if (lapses >= MISTAKE_MIN_LAPSES && lapses / Math.max(reps, 1) >= MISTAKE_MIN_LAPSE_RATE) return true;
  if (reps >= MISTAKE_MIN_REVIEWS && num("fsrs_difficulty") >= MISTAKE_MIN_DIFFICULTY) return true;

  const forgot = num("forgot_count");
  const fuzzy = num("fuzzy_count");
  const weightedWrong = forgot * 2 + fuzzy;
  if (forgot + fuzzy < MISTAKE_MIN_WRONG_ANSWERS) return false;
  return weightedWrong / Math.max(num("right_count") + weightedWrong, 1) >= MISTAKE_MIN_ERROR_RATE;
};

/**
 * 新词投放的等级闸门:N3 及以下算同一档,N2、N1 依次排到后面。
 *
 * 挡住 N1/N2 的理由——未学的词里 N1+N2 占八成(N1 还剩 3988、N2 3125,
 * N3 只剩 1445),按 shuffle_rank 随机抽的话每日新词额度会被它们整个吃光。
 *
 * N5/N4/N3 之间**不分先后**:同档内随机,各级别出现的比例就等于各自的剩余量,
 * N3 剩得最多(1445 / 248 / 176),自然占大头。不按 N5→N4→N3 顺推的道理:
 * 用户在别处学过,低级别词大多本来就会,排在前面等于逼他把会的重刷一遍——
 * 真不会的碰到了按「忘记」就进复习池,靠答题分辨比靠级别猜准。
 *
 * 用排序而不是 WHERE 硬过滤:N3 及以下全学完之后还能自然接上 N2/N1,不会断供。
 * 三处新词入口(当日任务表、加餐补位、无任务时的兜底出题)必须用同一份口径。
 */
export const newWordLevelRankSql = (alias = "w") => `CASE ${alias}.jlpt_level
    WHEN 'N2' THEN 2
    WHEN 'N1' THEN 3
    ELSE 1
  END`;

/**
 * 新词入口共用的 ORDER BY。
 *
 * 同档内用 ABS(RANDOM()) 而不是 shuffle_rank:shuffle_rank 是建库时一次性摇的固定值,
 * 之前一直按它 DESC 取词,高位的早被学完了——剩下的 N5 最高只到 0.495、N4 到 0.626,
 * 而 N3 还有 0.992,再按它排的话 N5/N4 会被整体压到 N3 后面,同档随机就名存实亡。
 * 每日任务表只在配额没填满时生成一次(见 stage1NewTaskCount),所以用 RANDOM() 不会来回抖。
 */
export const newWordOrderSql = (alias = "w") =>
  `${newWordLevelRankSql(alias)} ASC, ${alias}.importance DESC, ABS(RANDOM()) ASC`;

export const wordFilterSql = (options: WordSessionOptions = {}, alias = "w", progressAlias = "p") => {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  const level = options.level ?? "All";
  const type = options.type ?? "all";

  if (options.focus === "mistakes") {
    clauses.push(mistakeCandidateSql(progressAlias));
  }

  if (level !== "All") {
    if (level === "Unleveled") {
      clauses.push(`(${alias}.jlpt_level IS NULL OR ${alias}.jlpt_level = '')`);
    } else {
      clauses.push(`${alias}.jlpt_level = ?`);
      params.push(level);
    }
  }

  if (type === "favorite") {
    clauses.push(`EXISTS (
      SELECT 1 FROM content_favorites cf
      WHERE cf.item_type = 'word' AND cf.item_id = CAST(${alias}.id AS TEXT)
    )`);
  } else if (type === "noun") {
    clauses.push(`(${alias}.pos LIKE '%名%' OR ${alias}.pos LIKE '%名词%')`);
  } else if (type === "verb") {
    clauses.push(`(
      ${alias}.pos LIKE '%動%' OR
      ${alias}.pos LIKE '%动词%' OR
      ${alias}.pos LIKE '%自动%' OR
      ${alias}.pos LIKE '%他动%' OR
      ${alias}.pos LIKE '%自動%' OR
      ${alias}.pos LIKE '%他動%'
    )`);
  } else if (type === "adjective") {
    clauses.push(`(${alias}.pos LIKE '%形%' OR ${alias}.pos LIKE '%形容词%')`);
  } else if (type === "adverb") {
    clauses.push(`(${alias}.pos LIKE '%副%' OR ${alias}.pos LIKE '%副词%')`);
  }

  return {
    clause: clauses.length ? ` AND ${clauses.join(" AND ")} ` : "",
    params
  };
};

export const hasWordFilter = (options: WordSessionOptions = {}) => (
  (options.level ?? "All") !== "All"
  || (options.type ?? "all") !== "all"
  || options.focus === "mistakes"
);
