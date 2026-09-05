import { getDatabase } from "./database";
import { parseFurigana } from "./furigana-data";
import { ensureGrammarProgressInitialized } from "./grammar-api";
import { firstValue, rowsFor, studyDayEnd, today } from "./study-core";
import { dailyReviewCap } from "./review-budget";
import { getDailyWordGoal, getReviewCapPreference } from "./studyPreferences";
import {
  ensureFsrsColumns,
  fsrsDueWordIds,
  readFsrsState,
  recordFsrsReview,
  restoreFsrsState,
  GRAMMAR_FSRS,
  type FsrsEntity
} from "./fsrs-store";
import {
  isGraduatedForDay,
  recordReview,
  STUBBORN_DAILY_MISTAKES,
  type FsrsState
} from "./fsrs-scheduler";
import { allowsBackToBack, STUBBORN_MISTAKE_STREAK } from "./scheduler/requeue";
import { shouldPickStage1NewWord } from "./scheduler/priority";
import {
  advanceReviewQueue,
  getReviewQueue,
  lastAnsweredWord,
  scheduleDelayedReview,
  setLastAnsweredWord,
  setReviewQueue
} from "./word-api/session-state";
import { patternAttachment } from "./grammar-formation";
import type { FuriganaAnnotation } from "../types/furigana";
import type { WordAnswer } from "../types/vocabulary";

/**
 * 语法考题：题面是日语句型，答案是它的接续 + 中文意。
 *
 * **调度和单词是同一套：FSRS。** 早先这里是「一轮把该等级洗一遍牌走完」，理由是
 * 一个等级只有一百来条、间隔重复没意义。那个理由只在「过一遍」的时候成立 ——
 * 过完第二天呢？洗牌洗的是顺序，不是「哪些今天该复习」，于是每一轮都得把已经记牢的
 * 一百多条重新点一遍，真正忘掉的那几条淹在里面。条数少不改变遗忘曲线的形状。
 *
 * 所以现在语法就是第四个走同一条流水线的阶段（正向 / 反向 / 汉字读音 / 语法）：
 *   FSRS 到期集 → 当日复习上限 → 新语法配额 → 学习步骤（没毕业就当天隔几张重刷）
 *   → 往 grammar_reviews 记流水
 * 一字不差地对齐 `word-api/direction-answer.ts`，包括当日首答奖励（首次就点认识
 * 按 Easy）和顽固卡的三步重学。评分因此变成四档 —— 「模糊」以前没有是因为没有
 * 调度器接 Hard 档，现在有了。
 *
 * 数据仍然全部落在 `grammar_progress`（数字 grammar_id，和 grammar_points 同一套 id），
 * 加上 `grammar_reviews` 的流水。两张表都已经接了云同步。
 *
 * **刻意没有新建当日任务表。** 单词那边的 stage1_tasks 是给八千词的计划做物化的，
 * 而语法一个等级一百来条，「今天该做什么」现算一次就是几毫秒的事；
 * 「今天做过什么」由 grammar_reviews 说了算 —— 和 jlpt/status.ts 已有的口径一致。
 *
 * ⚠️ 这和语法**列表页**的「熟悉/没记住」不是同一份数据：那一套在
 * `hooks/useStudyStore` 的 localStorage 里，按 grammar.ts 的字符串 id 存，而且不同步。
 * 两份要不要合并是另一件事，别顺手混用。
 */
export type GrammarQuizAnswer = WordAnswer;

/** 会话状态（重刷队列、刚答过的那张）和三个单词方向共用一份实现，键名带 grammar。 */
const QUEUE_KEY = "grammar" as const;

export interface GrammarQuizCard {
  id: number;
  /** 题面：句型本身 */
  pattern: string;
  /** 答案上半：接续 */
  formation: string;
  /**
   * 接续里「往 `～` 里填的那一段」，翻面后标在题面 `～` 的头上。
   * 判不准就是 null（见 grammar-formation.ts），此时只有下面那行完整接续。
   */
  attachment: string | null;
  /** 答案下半：中文意 */
  meaning: string;
  /** 和语法辞典共用的例句。 */
  exampleJp: string;
  exampleMeaning: string;
  exampleFurigana?: FuriganaAnnotation[];
  exampleTokens: string;
  exampleLemmas: string;
  level: string;
  forgotCount: number;
  rightCount: number;
  /** 这条今天是不是第一次露面（新语法），界面上给个标记 */
  isNew: boolean;
}

export interface GrammarQuizSession {
  card: GrammarQuizCard | null;
  level: string;
  /** 今天这个等级已经过关几条 */
  done: number;
  /** 今天这个等级总共要过几条（已过关 + 还欠着的） */
  total: number;
  /** 今天这个等级还剩几条没过关 */
  remaining: number;
  /** 今天新学了几条 */
  newDone: number;
  /** 今天的新语法配额 */
  newQuota: number;
  /** 当前等级、今天是否真的有一笔作答可以回退。 */
  canUndo: boolean;
}

const LEVEL_PATTERN = /^N[1-5]$/;

/**
 * 把 FSRS 的到期集限定到一个等级。
 *
 * 直接拼字符串是因为 `fsrsDueWordIds` 的绑定参数是固定的，而「谁最该复习」的
 * 排序规则（刚栽过跟头的优先、其余 due 升序、顽固卡限流）只该有一份 ——
 * 为了传一个等级另写一遍 ORDER BY，就是在制造第二份口径。等级先过白名单。
 */
const levelEntity = (level: string): FsrsEntity => {
  if (!LEVEL_PATTERN.test(level)) return GRAMMAR_FSRS;
  return {
    ...GRAMMAR_FSRS,
    eligible: `${GRAMMAR_FSRS.eligible}
      AND grammar_id IN (SELECT id FROM grammar_points WHERE level = '${level}')`
  };
};

const levelPointCount = (level: string) => firstValue<number>(
  "SELECT COUNT(*) FROM grammar_points WHERE level = ?",
  [level],
  0
);

/** 今天这个等级答过的条数（不含标熟知那次——那不是一次复习） */
const answeredTodayCount = (level: string, day: string) => firstValue<number>(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  WHERE r.reviewed_on = ? AND g.level = ?
`, [day, level], 0);

/** 今天新学的条数：今天答过、而且以前从没答过 */
const newDoneTodayCount = (level: string, day: string) => firstValue<number>(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  WHERE r.reviewed_on = ? AND g.level = ?
    AND NOT EXISTS (
      SELECT 1 FROM grammar_reviews earlier
      WHERE earlier.grammar_id = r.grammar_id AND earlier.reviewed_on < ?
    )
`, [day, level, day], 0);

/** 今天这个等级已经过关的条数：毕业（下次到期越过本学习日）或手动熟知 */
const graduatedTodayCount = (level: string, day: string) => firstValue<number>(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  JOIN grammar_progress p ON p.grammar_id = r.grammar_id
  WHERE r.reviewed_on = ? AND g.level = ?
    AND (p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?))
`, [day, level, studyDayEnd().toISOString()], 0);

/**
 * 加餐名额。**每个等级一行、日期存在值里**，不把日期写进 key ——
 * grammar_state 是按 key 同步的 lww 表，key 带日期就成了只进不出的日志。
 */
const encoreKey = (level: string) => `quiz_encore:${level}`;

const readEncore = (level: string): { day: string; count: number } => {
  try {
    const parsed = JSON.parse(firstValue<string>(
      "SELECT value FROM grammar_state WHERE key = ?",
      [encoreKey(level)],
      ""
    ) || "null");
    if (!parsed || typeof parsed !== "object") return { day: "", count: 0 };
    return { day: String(parsed.day ?? ""), count: Math.max(Number(parsed.count ?? 0) || 0, 0) };
  } catch {
    return { day: "", count: 0 };
  }
};

/** 用户今天主动加餐加出来的额外名额（隔天自然作废） */
const encoreQuota = (level: string, day: string) => {
  const stored = readEncore(level);
  return stored.day === day ? stored.count : 0;
};

/**
 * 今天这个等级的新语法名额（还剩几条能学）。
 *
 * 和反向 / 汉字读音一样，各按同一个「每日新词目标」排自己那一份，互不挤占 ——
 * 语法条数本来就少，配额通常一天就吃满，剩下的全是复习。
 */
export const grammarNewQuota = (level: string, day = today()) =>
  Math.max(getDailyWordGoal() + encoreQuota(level, day) - newDoneTodayCount(level, day), 0);

/**
 * 「一轮洗一遍牌」时代留下的 `quiz_round:<等级>` 键。grammar_state 是同步表，
 * 留着就是五行永远不会被读的 JSON 在每次快照里来回搬。清一次就够。
 */
let roundKeysCleared = false;
const dropLegacyRoundState = () => {
  if (roundKeysCleared) return;
  roundKeysCleared = true;
  getDatabase().run("DELETE FROM grammar_state WHERE key LIKE 'quiz_round:%'");
};

/** 今天还该做的：到期的（受复习上限约束）+ 配额之内的新条目，顺序即优先级 */
const planIds = (level: string, day: string): { reviewIds: number[]; newIds: number[] } => {
  ensureGrammarProgressInitialized();
  ensureFsrsColumns(GRAMMAR_FSRS);
  dropLegacyRoundState();
  // 一个等级最多一百来条，复习上限（面向八千词设的）在这里几乎不会咬到，
  // 但仍然按它来 —— 那是用户对「一天最多复习多少」的唯一旋钮。
  const reviewLimit = Math.min(
    dailyReviewCap(getReviewCapPreference(), day),
    levelPointCount(level)
  );
  const reviewIds = fsrsDueWordIds(reviewLimit, studyDayEnd(), levelEntity(level));
  const newQuota = grammarNewQuota(level, day);
  const newIds = newQuota <= 0 ? [] : rowsFor(`
    SELECT g.id
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.level = ?
      AND p.seen_count = 0
      AND p.known_forever = 0
    ORDER BY g.sort_order ASC
    LIMIT ?
  `, [level, newQuota]).map((row) => Number(row.id));
  return { reviewIds, newIds };
};

const CARD_COLUMNS = `
  g.id, g.pattern, g.formation, g.meaning, g.level,
  g.example_jp, g.example_meaning, g.example_furigana, g.example_tokens, g.example_lemmas,
  COALESCE(p.forgot_count, 0) AS forgot_count,
  COALESCE(p.right_count, 0) AS right_count,
  COALESCE(p.seen_count, 0) AS seen_count,
  COALESCE(p.mistake_streak, 0) AS mistake_streak,
  COALESCE(p.known_forever, 0) AS known_forever
`;

const rowToCard = (row: Record<string, unknown>): GrammarQuizCard => {
  const pattern = String(row.pattern ?? "");
  const formation = String(row.formation ?? "");
  return {
    id: Number(row.id),
    pattern,
    formation,
    attachment: patternAttachment(pattern, formation),
    meaning: String(row.meaning ?? ""),
    exampleJp: String(row.example_jp ?? ""),
    exampleMeaning: String(row.example_meaning ?? ""),
    exampleFurigana: parseFurigana(row.example_furigana),
    exampleTokens: String(row.example_tokens ?? ""),
    exampleLemmas: String(row.example_lemmas ?? ""),
    level: String(row.level ?? ""),
    forgotCount: Number(row.forgot_count ?? 0),
    rightCount: Number(row.right_count ?? 0),
    isNew: Number(row.seen_count ?? 0) === 0
  };
};

const rowsByIds = (ids: number[]): Record<string, unknown>[] => {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = rowsFor(`
    SELECT ${CARD_COLUMNS}
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.id IN (${placeholders}) AND COALESCE(p.known_forever, 0) = 0
  `, ids);
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  // 按传进来的顺序还原 —— 那个顺序就是「谁最该复习」
  return ids.map((id) => byId.get(id)).filter(Boolean) as Record<string, unknown>[];
};

/**
 * 挑下一条。规则和单词那边同源：
 *  - 顽固卡（连着错到阈值）当场接着刷，不隔开；
 *  - 「隔几张再出」是硬闸门，排队中的一律让位给已到位的；
 *  - 刚答过的那条默认不连出（收尾阶段和顽固卡例外）；
 *  - 新条目按 `shouldPickStage1NewWord` 穿插（至少每 8 张一条），别让复习积压把它饿死。
 *
 * 没有排片器：干扰隔离靠的是「同混淆组」，而语法点没有那份数据。
 */
const pickCard = (level: string, day: string): GrammarQuizCard | null => {
  const { reviewIds, newIds } = planIds(level, day);
  const queueById = new Map(getReviewQueue(QUEUE_KEY).map((item) => [item.word_id, item.due_after]));
  const reviewRows = rowsByIds(reviewIds);
  const newRows = rowsByIds(newIds);
  const all = [...reviewRows, ...newRows];
  if (!all.length) return null;

  const lastId = lastAnsweredWord(QUEUE_KEY);
  const lastRow = all.find((row) => Number(row.id) === lastId);
  if (
    lastRow
    && Number(lastRow.mistake_streak ?? 0) >= STUBBORN_MISTAKE_STREAK
    && (queueById.get(lastId) ?? 0) <= 0
  ) {
    return rowToCard(lastRow);
  }

  const repeatAllowed = allowsBackToBack({
    mistakeStreak: Number(lastRow?.mistake_streak ?? 0),
    remaining: all.length,
    total: all.length + graduatedTodayCount(level, day)
  });
  const usable = all.length > 1 && !repeatAllowed
    ? all.filter((row) => Number(row.id) !== lastId)
    : all;
  const usableReviews = usable.filter((row) => Number(row.seen_count ?? 0) > 0);
  const usableNew = usable.filter((row) => Number(row.seen_count ?? 0) === 0);
  const preferred = shouldPickStage1NewWord(
    usableReviews.length,
    usableNew.length,
    answeredTodayCount(level, day)
  ) ? usableNew : usableReviews.length ? usableReviews : usableNew;
  const pool = preferred.length ? preferred : usable;
  if (!pool.length) return null;

  const ready = pool.filter((row) => (queueById.get(Number(row.id)) ?? 0) <= 0);
  if (ready.length) return rowToCard(ready[0]);
  // 全都还没轮到（今天剩的条目比间隔还少）→ 退化成轮转：等得最久的先出。
  const sorted = [...pool].sort(
    (left, right) => (queueById.get(Number(left.id)) ?? 0) - (queueById.get(Number(right.id)) ?? 0)
  );
  return rowToCard(sorted[0]);
};

interface GrammarUndoSnapshot {
  grammarId: number;
  reviewedOn: string;
  reviewId: number;
  seenCount: number;
  knownForever: number;
  lastSeenOn: string | null;
  rightCount: number;
  fuzzyCount: number;
  forgotCount: number;
  mistakeStreak: number;
  fsrs: FsrsState | null;
  queue: { word_id: number; due_after: number }[];
  lastAnswered: number;
}

const UNDO_LIMIT = 2;
const undoKey = (level: string) => `quiz_undo:${level}`;

const readUndoStack = (level: string): GrammarUndoSnapshot[] => {
  try {
    const raw = firstValue<string>(
      "SELECT value FROM grammar_state WHERE key = ?",
      [undoKey(level)],
      ""
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 昨天那条不能撤：回滚昨天的 FSRS 状态、删掉昨天的流水，只会是净损失。
    return parsed.filter((item) => item?.reviewedOn === today()) as GrammarUndoSnapshot[];
  } catch {
    return [];
  }
};

const writeUndoStack = (level: string, stack: GrammarUndoSnapshot[]) => {
  getDatabase().run(
    "INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",
    [undoKey(level), JSON.stringify(stack.slice(-UNDO_LIMIT))]
  );
};

const sessionFor = (level: string, card: GrammarQuizCard | null): GrammarQuizSession => {
  const day = today();
  const { reviewIds, newIds } = planIds(level, day);
  const done = graduatedTodayCount(level, day);
  const remaining = reviewIds.length + newIds.length;
  return {
    card,
    level,
    done,
    total: done + remaining,
    remaining,
    newDone: newDoneTodayCount(level, day),
    // 分母是「今天总共能学几条新的」= 每日目标 + 加餐，所以由「已学 + 还能学」倒推，
    // 直接写 getDailyWordGoal() 的话加餐之后会出现 12 / 10。
    newQuota: newDoneTodayCount(level, day) + grammarNewQuota(level, day),
    canUndo: readUndoStack(level).length > 0
  };
};

/**
 * 今天这个等级还欠几条（到期的 + 配额之内的新条目）。
 *
 * 给首页的混合模式角标用：那个数得是「单词 + 语法」的合计，否则混合和经典写着
 * 同一个数，多出来的那部分工作量在主页上根本不存在。**不走 getGrammarQuizSession** ——
 * 那还会顺手抽一张卡（rowsByIds + 队列），而这里只要一个数。
 */
export const grammarPlanRemaining = (level: string, day = today()) => {
  const { reviewIds, newIds } = planIds(level, day);
  return reviewIds.length + newIds.length;
};

/** 取当前这一条。今天的都过关了就返回 card=null，由界面问要不要加餐。 */
export const getGrammarQuizSession = (level: string): GrammarQuizSession => {
  const day = today();
  return sessionFor(level, pickCard(level, day));
};

/* ------------------------------------------------------------------ *
 * 作答
 * ------------------------------------------------------------------ */

/**
 * 记一次作答：写 FSRS、写计数、记流水，没毕业就排回今天的队列里再刷一次。
 *
 * 和 `applyDirectionAnswer` 是同一套：当天首答点「认识」按 Easy（跳过学习步骤直接
 * 毕业），当天已经错够 3 次的按顽固卡走三步重学，其余走常规两步。
 */
export const submitGrammarQuizAnswer = (
  level: string,
  grammarId: number,
  answer: GrammarQuizAnswer
): GrammarQuizSession => {
  ensureGrammarProgressInitialized();
  ensureFsrsColumns(GRAMMAR_FSRS);
  const db = getDatabase();
  const day = today();
  const progress = rowsFor(`
    SELECT seen_count, known_forever, last_seen_on, right_count, fuzzy_count, forgot_count, mistake_streak
    FROM grammar_progress
    WHERE grammar_id = ?
  `, [grammarId])[0];

  const snapshot: GrammarUndoSnapshot = {
    grammarId,
    reviewedOn: day,
    reviewId: 0,
    seenCount: Number(progress?.seen_count ?? 0),
    knownForever: Number(progress?.known_forever ?? 0) === 1 ? 1 : 0,
    lastSeenOn: progress?.last_seen_on == null ? null : String(progress.last_seen_on),
    rightCount: Number(progress?.right_count ?? 0),
    fuzzyCount: Number(progress?.fuzzy_count ?? 0),
    forgotCount: Number(progress?.forgot_count ?? 0),
    mistakeStreak: Number(progress?.mistake_streak ?? 0),
    fsrs: readFsrsState(grammarId, GRAMMAR_FSRS),
    queue: getReviewQueue(QUEUE_KEY),
    lastAnswered: lastAnsweredWord(QUEUE_KEY)
  };

  advanceReviewQueue(grammarId, QUEUE_KEY);

  const knownForever = answer === "known_forever";
  const mistakeStreak = knownForever || answer === "know"
    ? 0
    : snapshot.mistakeStreak + 1;

  // 顽固判定用「今天累计答错几次」而不是「连错几次」：后者答对一次就清零，
  // 那样刚答对的瞬间这条就不算顽固了，加码等于没加。
  const wrongToday = firstValue<number>(`
    SELECT COUNT(*) FROM grammar_reviews
    WHERE grammar_id = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')
  `, [grammarId, day], 0) + (answer === "forgot" || answer === "fuzzy" ? 1 : 0);
  const stubbornCard = wrongToday >= STUBBORN_DAILY_MISTAKES;
  const firstSeenToday = firstValue<number>(
    "SELECT COUNT(*) FROM grammar_reviews WHERE grammar_id = ? AND reviewed_on = ?",
    [grammarId, day],
    0
  ) === 0;
  const stepMode = firstSeenToday && answer === "know"
    ? "known"
    : stubbornCard ? "stubborn" : "normal";

  let graduated = false;
  let graduationTest = false;
  let stepMinutes = 0;
  if (!knownForever) {
    try {
      const next = recordFsrsReview(grammarId, answer, new Date(), { mode: stepMode }, GRAMMAR_FSRS);
      graduated = isGraduatedForDay(next, studyDayEnd());
      stepMinutes = Math.max((new Date(next.due).getTime() - Date.now()) / 60_000, 0);
      graduationTest = !graduated && isGraduatedForDay(
        recordReview(next, "know", new Date(), { mode: stubbornCard ? "stubborn" : "normal" }),
        studyDayEnd()
      );
    } catch (err) {
      console.warn("[fsrs] 语法记录跳过:", err);
      graduated = answer === "know";
    }
  }

  if (!graduated && !knownForever) {
    scheduleDelayedReview(
      grammarId,
      stepMinutes,
      mistakeStreak >= STUBBORN_MISTAKE_STREAK,
      graduationTest,
      QUEUE_KEY
    );
  }
  setLastAnsweredWord(grammarId, QUEUE_KEY);

  db.run(`
    UPDATE grammar_progress
    SET seen_count = COALESCE(seen_count, 0) + 1,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?,
        known_forever = ?
    WHERE grammar_id = ?
  `, [
    day,
    snapshot.rightCount + (answer === "know" ? 1 : 0),
    snapshot.fuzzyCount + (answer === "fuzzy" ? 1 : 0),
    snapshot.forgotCount + (answer === "forgot" ? 1 : 0),
    mistakeStreak,
    knownForever ? 1 : 0,
    grammarId
  ]);

  db.run(`
    INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on)
    VALUES (?, ?, 0, ?)
  `, [grammarId, answer, day]);
  snapshot.reviewId = firstValue<number>("SELECT last_insert_rowid()", [], 0);

  writeUndoStack(level, [...readUndoStack(level), snapshot]);
  void import("./storage").then(({ scheduleSave }) => scheduleSave());
  return getGrammarQuizSession(level);
};

/**
 * 回退今天的最近一次作答，并把那条卡交回来。
 *
 * FSRS 状态、计数、流水、重刷队列一起回滚 —— 只回滚一半的话，撤销反而是在造假数据。
 * 没有历史时原样停在当前卡，绝不重新抽题。
 */
export const undoLastGrammarQuizAnswer = (level: string): GrammarQuizSession => {
  ensureGrammarProgressInitialized();
  const stack = readUndoStack(level);
  if (!stack.length) return getGrammarQuizSession(level);

  const snapshot = stack.pop() as GrammarUndoSnapshot;
  const db = getDatabase();
  db.run(`
    UPDATE grammar_progress
    SET seen_count = ?, known_forever = ?, last_seen_on = ?, right_count = ?,
        fuzzy_count = ?, forgot_count = ?, mistake_streak = ?
    WHERE grammar_id = ?
  `, [
    snapshot.seenCount,
    snapshot.knownForever,
    snapshot.lastSeenOn,
    snapshot.rightCount,
    snapshot.fuzzyCount ?? 0,
    snapshot.forgotCount,
    snapshot.mistakeStreak,
    snapshot.grammarId
  ]);
  if (snapshot.reviewId) db.run("DELETE FROM grammar_reviews WHERE id = ?", [snapshot.reviewId]);
  restoreFsrsState(snapshot.grammarId, snapshot.fsrs ?? null, GRAMMAR_FSRS);
  setReviewQueue(snapshot.queue ?? [], QUEUE_KEY);
  setLastAnsweredWord(snapshot.lastAnswered ?? 0, QUEUE_KEY);
  writeUndoStack(level, stack);
  void import("./storage").then(({ scheduleSave }) => scheduleSave());

  const row = rowsFor(`
    SELECT ${CARD_COLUMNS}
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.id = ?
  `, [snapshot.grammarId])[0];
  return sessionFor(level, row ? rowToCard(row) : null);
};

/* ------------------------------------------------------------------ *
 * 加餐 / 排行
 * ------------------------------------------------------------------ */

/** 一次加餐塞多少条新语法 */
export const GRAMMAR_ENCORE_SIZE = 10;

/**
 * 今天的都过关了还想学：越过当日新语法配额，再放几条进来。
 *
 * 做法是把配额本身往上抬（记在 grammar_state 里，按天），而不是硬插一张 ——
 * 配额是「今天要学这么多新的」，用户主动要求加餐时改的就是这个数。
 */
export const extendGrammarQuizPlan = (
  level: string,
  count = GRAMMAR_ENCORE_SIZE
): GrammarQuizSession => {
  const day = today();
  const remaining = firstValue<number>(`
    SELECT COUNT(*)
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.level = ? AND p.seen_count = 0 AND p.known_forever = 0
  `, [level], 0);
  if (remaining > 0) {
    getDatabase().run(
      "INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",
      [encoreKey(level), JSON.stringify({ day, count: encoreQuota(level, day) + Math.max(count, 0) })]
    );
  }
  void import("./storage").then(({ scheduleSave }) => scheduleSave());
  return getGrammarQuizSession(level);
};

export interface GrammarQuizRankRow extends GrammarQuizCard {
  seenCount: number;
  knownForever: boolean;
  lapses: number;
}

/**
 * 「错得最多」那份列表：按累计答错次数倒序，没答过的排最后。
 * 现在它旁边还有 FSRS 自己的 lapses（复习态答错），两个数一起看才知道是不是顽固条目。
 */
export const grammarQuizRanking = (level: string): GrammarQuizRankRow[] => {
  ensureGrammarProgressInitialized();
  ensureFsrsColumns(GRAMMAR_FSRS);
  return rowsFor(`
    SELECT ${CARD_COLUMNS}, COALESCE(p.fsrs_lapses, 0) AS lapses
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.level = ?
    ORDER BY COALESCE(p.forgot_count, 0) DESC,
             COALESCE(p.seen_count, 0) ASC,
             g.sort_order ASC
  `, [level]).map((row) => ({
    ...rowToCard(row),
    seenCount: Number(row.seen_count ?? 0),
    knownForever: Number(row.known_forever ?? 0) === 1,
    lapses: Number(row.lapses ?? 0)
  }));
};
