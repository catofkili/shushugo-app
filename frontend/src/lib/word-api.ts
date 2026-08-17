import { getDatabase } from "./database";
import { WordAnswer, WordCard, WordSessionResponse, WordStats } from "../types/vocabulary";
import { getDailyWordGoal } from "./studyPreferences";
import { rowObjectToCard } from "./models/word-card";
import { notifyProgressUpdated } from "./progress-events";
import { STUBBORN_MISTAKE_STREAK } from "./scheduler/requeue";
import {
  firstRow,
  firstValue,
  getState,
  persistSoon,
  rowsFor,
  setState,
  studyDayEnd,
  today
} from "./study-core";
import type { WordSessionOptions } from "./study-types";
import { encoreChunkSize, recordEncore } from "./review-budget";
import { ensureSyncSchema } from "./sync/schema";
import { recordStudySeconds } from "./sync/study-time";
import {
  recordFsrsReview,
  readFsrsState,
  restoreFsrsState
} from "./fsrs-store";
import {
  isGraduatedForDay,
  recordReview,
  LEECH_LAPSE_THRESHOLD,
  STUBBORN_DAILY_MISTAKES,
  type FsrsState
} from "./fsrs-scheduler";
import {
  advanceReviewQueue,
  getReviewQueue,
  lastAnsweredWord,
  scheduleDelayedReview,
  setLastAnsweredWord,
  setReviewQueue
} from "./word-api/session-state";
import {
  canUndo as canUndoSnapshot,
  clearPinnedCard,
  pinCard,
  popUndoSnapshot,
  pushUndoSnapshot,
  readPinnedCard
} from "./word-api/undo-stack";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { getWordStats } from "./word-api/stats";
import { updateMemoryProfileIfNeeded } from "./adaptive";
import { hasWordFilter, isLongTermWeak, newWordOrderSql, wordFilterSql } from "./word-api/filters";
import { pickMistakeNext } from "./word-api/mistakes";
import { directionByPhase, KANJI, REVERSE, type StudyDirection } from "./word-api/directions";
import {
  directionCardById,
  directionProgressCounts,
  ensureDirectionTasks,
  pickDirectionNext
} from "./word-api/direction-plan";
import { applyDirectionAnswer, undoDirectionAnswer } from "./word-api/direction-answer";
import {
  createStage1Tasks,
  encoreRemainingCount,
  ensureStage1Tasks,
  pickStage1Next,
  stage1ProgressCounts
} from "./word-api/stage1";

// 排队接口是 progress-api 在用的公开 API,搬去 session-state 后原样再导出,调用方不用改
export { getReviewQueue, setReviewQueue } from "./word-api/session-state";
export { ensureProgressInitialized } from "./word-api/bootstrap";
export { getWordStats } from "./word-api/stats";
export {
  advanceDailyRelief,
  ensureDailyRelief,
  getDailyReliefNext,
  getDailyReliefProgress
} from "./word-api/daily-relief";
export {
  advanceDailyTail,
  ensureDailyTail,
  getDailyTailNext,
  getDailyTailProgress
} from "./word-api/daily-tail";
export {
  dailyReviewCandidateCount,
  hasDailyReviewTriggered,
  markDailyReviewTriggered,
  pickDailyReviewNext,
  shouldStartDailyReview
} from "./word-api/daily-review";
// 首页看过「比昨天少 N 个」之后回写标记,当天不再重放

// 导出分析统计功能
export { getStudyAnalytics } from "./analytics/stats";
export type {
  FavoriteItem,
  FavoriteType,
  LevelProgressItem,
  ProgressOverview,
  StudyAnswer,
  WordSessionOptions
} from "./study-types";
export { getGrammarPointFavorite } from "./grammar-api";
export { getFavoriteItems, toggleFavorite } from "./favorites-api";



const currentPhase = () => {
  const day = today();
  if (getState("phase_date", "") !== day) {
    setState("phase_date", day);
    setState("phase", "stage1");
  }
  const phase = getState("phase", "stage1");
  // 阶段做完就是 done,不再自动串到下一个阶段:反向/汉字是用户自己挑的模式,
  // 不是今日计划的续集(见 resolveNextCard 里同一条注释)。
  if (phase === "stage2" || phase === "kanji") {
    const counts = directionProgressCounts(directionByPhase(phase));
    if (counts.total > 0 && counts.completed >= counts.total) {
      setState("phase", "done");
      return "done";
    }
  }
  return phase;
};

const setPhase = (phase: string) => {
  setState("phase_date", today());
  setState("phase", phase);
};

const recordCheckin = () => {
  getDatabase().run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)", [today()]);
};



const pickFilteredWordNext = (options: WordSessionOptions): WordCard | null => {
  const filter = wordFilterSql(options, "w");
  const dueIds = getReviewQueue().filter((item) => item.due_after <= 0).map((item) => item.word_id);
  if (dueIds.length) {
    const placeholders = dueIds.map(() => "?").join(",");
    const due = firstRow(`
      SELECT w.*, p.seen_count, p.known_forever,
             p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
             p.mistake_streak, COALESCE(n.note, '') AS note
      FROM words w
      JOIN progress p ON p.word_id = w.id
      LEFT JOIN word_notes n ON n.word_id = w.id
      WHERE w.id IN (${placeholders})
        AND p.known_forever = 0
        ${filter.clause}
      ORDER BY p.fsrs_due ASC, p.fsrs_lapses DESC, w.importance DESC
      LIMIT 1
    `, [...dueIds, ...filter.params]);
    if (due) return rowObjectToCard(due);
  }

  const critical = firstRow(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND COALESCE(p.fsrs_lapses, 0) >= ?
      ${filter.clause}
    ORDER BY p.fsrs_lapses DESC, p.fsrs_due ASC, w.importance DESC
    LIMIT 1
  `, [LEECH_LAPSE_THRESHOLD, ...filter.params]);
  if (critical) return rowObjectToCard(critical);

  const low = firstRow(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
      ${filter.clause}
    ORDER BY p.fsrs_due ASC, p.fsrs_lapses DESC, w.importance DESC
    LIMIT 1
  `, [studyDayEnd().toISOString(), ...filter.params]);
  if (low) return rowObjectToCard(low);

  const unseen = firstRow(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count = 0
      ${filter.clause}
    ORDER BY ${newWordOrderSql("w")}
    LIMIT 1
  `, filter.params);
  if (unseen) return rowObjectToCard(unseen);

  const review = firstRow(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      ${filter.clause}
    ORDER BY p.fsrs_due ASC, p.last_seen_on ASC, w.importance DESC, w.shuffle_rank DESC
    LIMIT 1
  `, filter.params);
  return review ? rowObjectToCard(review) : null;
};

const setCurrentCard = (card: Pick<WordCard, "id"> | null): void => {
  setState("current_card", card && card.id != null ? String(card.id) : "0");
};

const wordCardById = (wordId: number): WordCard | null => {
  const row = firstRow(`
    SELECT
      w.*,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `, [wordId]);
  return row ? rowObjectToCard(row) : null;
};

// Claim the served card. Returns true if `wordId` is the card we are currently
// waiting on (and consumes it so it can only be scored once); false for a stale
// or duplicate submit. An empty value means nothing has been served yet -> allow.
// JavaScript is single-threaded, so this read-then-write needs no extra locking.
const claimCurrentCard = (wordId: number): boolean => {
  const expected = getState("current_card", "");
  if (expected === "") return true;
  if (expected === String(wordId)) {
    setState("current_card", "0");
    // 撤销钉住的那张已经被答掉了,钉子拔掉,不然下一张又把它交回来
    clearPinnedCard();
    return true;
  }
  return false;
};

/**
 * 「这是哪一场」——撤销快照要按它配对:错题本 / 筛选学习 / 正向 / 反向 / 汉字。
 * 换了场就当作没得撤销,免得在反向里点一下把正向刚答的那张拽过来。
 */
const sessionMode = (phase: string, options: WordSessionOptions = {}): string => (
  options.focus === "mistakes" ? "mistakes" : hasWordFilter(options) ? "filtered" : phase
);

const currentSessionMode = (options: WordSessionOptions = {}): string =>
  sessionMode(currentPhase(), options);

/** 撤销后钉住的那张:模式对得上就原样交回来,而不是重新抽 */
const pinnedCard = (options: WordSessionOptions = {}): { card: WordCard; phase: string } | null => {
  const mode = currentSessionMode(options);
  const wordId = readPinnedCard(mode);
  if (!wordId) return null;
  const card = mode === "stage2" || mode === "kanji"
    ? directionCardById(directionByPhase(mode), wordId)
    : wordCardById(wordId);
  if (!card) {
    clearPinnedCard();
    return null;
  }
  return { card, phase: mode === "filtered" ? "filtered" : mode };
};

const nextCard = (options: WordSessionOptions = {}): { card: WordCard | null; phase: string } => {
  const result = pinnedCard(options) ?? resolveNextCard(options);
  setCurrentCard(result.card);
  return result;
};

const resolveNextCard = (options: WordSessionOptions = {}): { card: WordCard | null; phase: string } => {
  if (options.focus === "mistakes") {
    return { card: pickMistakeNext(), phase: "mistakes" };
  }
  if (hasWordFilter(options)) {
    return { card: pickFilteredWordNext(options), phase: "filtered" };
  }
  const phase = currentPhase();
  if (phase === "done") return { card: null, phase: "done" };
  if (phase === "stage2" || phase === "kanji") {
    const card = pickDirectionNext(directionByPhase(phase));
    if (card) return { card, phase };
    setPhase("done");
    recordCheckin();
    return { card: null, phase: "done" };
  }

  const stage1Card = pickStage1Next();
  if (stage1Card) return { card: stage1Card, phase: "stage1" };

  // 今日计划出完就是出完了 —— **不再自动接反向/汉字**。
  //
  // 以前每答一个词就往反向队列插一条(recordStage2Word),所以做完 985 个词的那一刻,
  // 系统会紧接着把这 985 个词用日语→释义再问一遍,一天变两天的量。反向和汉字现在是
  // 用户自己选的模式(continueStage2Study / continueKanjiStudy),想练随时进,不再被塞。
  recordCheckin();
  setPhase("done");
  return { card: null, phase: "done" };
};

export function refreshTodayWordPlan(): WordStats {
  ensureProgressInitialized();
  const day = today();
  const phase = currentPhase();
  const stage1 = stage1ProgressCounts();
  if (phase === "stage1" && stage1.completed < stage1.total) {
    getDatabase().run("DELETE FROM stage1_tasks WHERE reviewed_on = ?", [day]);
    createStage1Tasks(day);
    // 重排完必须落盘:否则改完设置直接关掉 app,下次启动又读回旧计划
    persistSoon();
  }
  notifyProgressUpdated();
  return getWordStats(currentPhase());
}

export function completeTodayWordPlan(): { stats: WordStats; completedCount: number } {
  ensureProgressInitialized();
  const day = today();
  ensureStage1Tasks();
  const rows = rowsFor(`
    SELECT t.word_id
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `, [day, studyDayEnd().toISOString()]);
  const ids = rows.map((row) => Number(row.word_id)).filter((id) => Number.isFinite(id));

  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    // 一键完成 = 给每个词记一次「认识」,让 FSRS 正常排下一次到期,
    // 这样今日计划清空后不会留下一批没有 due 的词。
    const now = new Date();
    ids.forEach((wordId) => {
      try {
        recordFsrsReview(wordId, "know", now);
      } catch (err) {
        console.warn("[fsrs] 一键完成记录跳过:", err);
      }
    });
    getDatabase().run(`
      UPDATE progress
      SET seen_count = seen_count + 1,
          last_seen_on = ?,
          right_count = right_count + 1,
          mistake_streak = 0
      WHERE word_id IN (${placeholders})
        AND known_forever = 0
    `, [day, ...ids]);

    getDatabase().run(`
      INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction)
      SELECT t.word_id, 'know', 0, ?, 'forward'
      FROM stage1_tasks t
      WHERE t.reviewed_on = ?
        AND t.word_id IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM reviews r
          WHERE r.word_id = t.word_id
            AND r.reviewed_on = ?
        )
    `, [day, day, ...ids, day]);

    setReviewQueue(getReviewQueue().filter((item) => !ids.includes(item.word_id)));
  }

  // 「一键完成今日单词」只结掉**今日计划(正向)**。反向和汉字各有自己的当日计划,
  // 由正向的一个按钮顺手判它们过关,又是「某个模式特别」的老毛病。
  recordCheckin();
  setPhase("done");
  persistSoon();
  notifyProgressUpdated();
  return { stats: getWordStats("done"), completedCount: ids.length };
}

export function markTodayWordCheckin(): WordStats {
  ensureProgressInitialized();
  recordCheckin();
  persistSoon();
  notifyProgressUpdated();
  return getWordStats(currentPhase());
}

/**
 * 续杯：今日计划完成后，从积压里按遗忘风险再取一小批（递减批量）
 * 加入今日任务并回到 Stage1 继续学。
 */
export function startEncore(customSize?: number): WordSessionResponse {
  ensureProgressInitialized();
  const day = today();
  ensureStage1Tasks();
  const smartSize = encoreChunkSize(encoreRemainingCount(day));
  const size = customSize && customSize > 0
    ? Math.min(Math.round(customSize), 100)
    : (smartSize > 0 ? smartSize : Math.max(Math.round(getDailyWordGoal() / 2), 5));
  if (size <= 0) return getWordSession();

  const db = getDatabase();
  const startIndex = firstValue<number>(
    "SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",
    [day],
    1
  );
  const reviewRows = rowsFor(`
    SELECT p.word_id
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
      AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
    ORDER BY
      p.fsrs_due ASC,
      p.fsrs_lapses DESC,
      w.importance DESC,
      p.last_seen_on ASC,
      p.word_id ASC
    LIMIT ?
  `, [studyDayEnd().toISOString(), day, size]);
  reviewRows.forEach((row, index) => {
    db.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'review', ?)
    `, [day, Number(row.word_id), startIndex + index]);
  });

  // 积压不够就用新词补齐,让「继续学习」在清完积压后依然可用
  const newFill = size - reviewRows.length;
  if (newFill > 0) {
    const newRows = rowsFor(`
      SELECT p.word_id
      FROM progress p
      JOIN words w ON w.id = p.word_id
      WHERE p.known_forever = 0
        AND p.seen_count = 0
        AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
      ORDER BY ${newWordOrderSql("w")}
      LIMIT ?
    `, [day, newFill]);
    // task_type 用 'encore_new' 而不是 'new':加餐词有意超出每日配额,
    // 不能被 reconcileStage1NewQuota 的超额裁剪删掉,也不占配额计数。
    newRows.forEach((row, index) => {
      db.run(`
        INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
        VALUES (?, ?, 'encore_new', ?)
      `, [day, Number(row.word_id), startIndex + reviewRows.length + index]);
    });
    if (reviewRows.length + newRows.length > 0) {
      recordEncore(day, reviewRows.length + newRows.length);
    }
  } else if (reviewRows.length > 0) {
    recordEncore(day, reviewRows.length);
  }

  setPhase("stage1");
  persistSoon();
  notifyProgressUpdated();
  return getWordSession();
}

/** Add one dictionary-discovered word to today's queue without consuming the
 * normal new-word quota.  The task type is deliberately encore_new so the
 * daily reconciler will not trim it away. */
export function addWordToTodayEncore(wordId: number): boolean {
  ensureProgressInitialized();
  ensureStage1Tasks();
  const id = Math.round(Number(wordId));
  if (!Number.isFinite(id) || id <= 0) return false;
  const day = today();
  const exists = firstValue<number>(
    "SELECT 1 FROM words w JOIN progress p ON p.word_id = w.id WHERE w.id = ? AND p.known_forever = 0 LIMIT 1",
    [id],
    0
  );
  if (!exists) return false;
  const alreadyQueued = firstValue<number>(
    "SELECT 1 FROM stage1_tasks WHERE reviewed_on = ? AND word_id = ? LIMIT 1",
    [day, id],
    0
  );
  if (alreadyQueued) return false;
  getDatabase().run(
    "INSERT OR IGNORE INTO dictionary_discovered_words (word_id) VALUES (?)",
    [id]
  );
  const orderIndex = firstValue<number>(
    "SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",
    [day],
    1
  );
  getDatabase().run(`
    INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
    VALUES (?, ?, 'encore_new', ?)
  `, [day, id, orderIndex]);
  setPhase("stage1");
  persistSoon();
  notifyProgressUpdated();
  return true;
}


export function getWordSession(options: WordSessionOptions = {}): WordSessionResponse {
  ensureProgressInitialized();
  const { card, phase } = nextCard(options);
  return {
    card,
    phase,
    stats: getWordStats(phase, options),
    canUndo: canUndoSnapshot(sessionMode(phase, options))
  };
}

/**
 * 从相似释义气泡传送到另一张词卡。当前词按“模糊”走一次正式调度，
 * 但 UI 不播放评分反馈；随后把目标词声明为当前卡，下一次作答仍能被防重锁正确接收。
 */
export function jumpToSimilarWord(
  currentWordId: number,
  targetWordId: number,
  options: WordSessionOptions = {}
): WordSessionResponse {
  ensureProgressInitialized();
  if (!Number.isFinite(targetWordId) || targetWordId === currentWordId) {
    throw new Error("相似词目标无效");
  }
  const targetCard = wordCardById(targetWordId);
  if (!targetCard) throw new Error("找不到这个相似词");

  const scored = submitWordAnswer(currentWordId, "fuzzy", options);
  setCurrentCard(targetCard);
  return {
    card: targetCard,
    phase: scored.phase,
    stats: scored.stats,
    canUndo: scored.canUndo
  };
}

export interface QuickStudySessionResponse {
  cards: WordCard[];
  phase: string;
  stats: WordStats;
}

/** 首页快速学习用的「只读取、不评分」批次。limit 只是懒加载单位，不是总量上限。 */
export function getQuickStudySession(limit = 50, excludedWordIds: number[] = []): QuickStudySessionResponse {
  ensureProgressInitialized();
  const safeLimit = Math.max(1, Math.round(limit));
  const phase = currentPhase();
  const cards: WordCard[] = [];
  const excludedIds = new Set(excludedWordIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)));

  const pickNext = () => {
    if (phase === "stage1") return pickStage1Next(excludedIds);
    if (phase === "stage2" || phase === "kanji") {
      return pickDirectionNext(directionByPhase(phase), excludedIds);
    }
    return null;
  };

  while (cards.length < safeLimit) {
    const card = pickNext();
    if (!card || excludedIds.has(card.id)) break;
    cards.push(card);
    excludedIds.add(card.id);
  }

  return { cards, phase, stats: getWordStats(phase) };
}

/** 按列表中的选择逐张走正式提交流程，实际算法仍由 submitWordAnswer 完成。 */
export function submitQuickStudyBatch(
  answers: { wordId: number; answer: WordAnswer }[],
  phase: string
): WordSessionResponse {
  ensureProgressInitialized();
  if (!answers.length) return getWordSession();

  const safePhase = phase === "stage2" || phase === "kanji" ? phase : "stage1";
  let result: WordSessionResponse | null = null;
  answers.forEach(({ wordId, answer }, index) => {
    setPhase(safePhase);
    setCurrentCard({ id: wordId });
    result = submitWordAnswer(wordId, answer);
    if (index < answers.length - 1) setPhase(safePhase);
  });
  return result ?? getWordSession();
}

/**
 * 三个「按阶段出题」的模式各有一个入口,共同的规矩:
 * **进来先把 phase 摆正**。phase 是存在 app_state 里的当天状态,昨天停在反向、
 * 今天选今日计划的话,不显式重置就会被上一次的 phase 劫持(选 A 出 B)。
 */
export function continueTodayPlanStudy(): WordSessionResponse {
  ensureProgressInitialized();
  setPhase("stage1");
  const session = getWordSession();
  // 顶栏的小路自己也读一份统计,只在进度事件上刷新。切模式会改当天的队列
  // (反向/汉字进来才建队列),不吱一声的话小路会停在上一个模式的数字上。
  notifyProgressUpdated();
  return session;
}

/** 反向/汉字:进模式先把当日计划排好(三方向同一套规则,见 direction-plan) */
const continueDirectionStudy = (direction: StudyDirection): WordSessionResponse => {
  ensureProgressInitialized();
  // 进模式才引入新卡:光在首页看一眼统计不该给这个方向攒债
  ensureDirectionTasks(direction, true);
  const counts = directionProgressCounts(direction);
  if (counts.total > 0 && counts.completed < counts.total) {
    setPhase(direction.phase);
    const session = getWordSession();
    notifyProgressUpdated();
    return session;
  }
  setPhase("done");
  return getWordSession();
};

export function continueStage2Study(): WordSessionResponse {
  return continueDirectionStudy(REVERSE);
}

export function continueKanjiStudy(): WordSessionResponse {
  return continueDirectionStudy(KANJI);
}

export function submitWordAnswer(wordId: number, answer: WordAnswer, options: WordSessionOptions = {}): WordSessionResponse {
  ensureProgressInitialized();
  if (!claimCurrentCard(wordId)) {
    // Stale or duplicate submission (e.g. a rapid double-tap before the card
    // advanced). Do NOT score the word again; just re-sync with the current card.
    return getWordSession(options);
  }
  const db = getDatabase();
  const studyDate = today();
  // 筛选学习和错题本都使用正式的 Stage1/FSRS 作答流程，但不能被常规计划当前正处于
  // 反向或汉字阶段所劫持。它们只替换选词，不另建一套记忆。
  const phase = hasWordFilter(options) ? "stage1" : currentPhase();

  // 反向 / 汉字:和正向同一套规则,只是记忆表换成这个方向自己的那张(见 direction-answer)。
  // 以前这里是两大段 temp_score 的土办法 —— 答对加 10、≥10 算过关、due_after 数张数,
  // 只活在当天的队列表里,所以「毕业」「顽固卡」「已掌握」在这两个方向里根本不存在。
  if (phase === "stage2" || phase === "kanji") {
    applyDirectionAnswer(directionByPhase(phase), wordId, answer);
    import("./storage").then(({ scheduleSave }) => scheduleSave());
    notifyProgressUpdated();
    return getWordSession(options);
  }

  const progress = firstRow("SELECT * FROM progress WHERE word_id = ?", [wordId]);
  if (!progress) return getWordSession(options);
  const snapshot = {
    phase: "stage1",
    // 撤销要认「这是哪一场、哪一天」的快照:对不上就当作没得撤销(见 undo-stack)
    mode: sessionMode("stage1", options),
    reviewed_on: studyDate,
    word_id: wordId,
    last_answered_word: lastAnsweredWord(),
    seen_count: Number(progress.seen_count ?? 0),
    known_forever: Number(progress.known_forever ?? 0),
    last_seen_on: progress.last_seen_on,
    right_count: Number(progress.right_count ?? 0),
    fuzzy_count: Number(progress.fuzzy_count ?? 0),
    forgot_count: Number(progress.forgot_count ?? 0),
    mistake_streak: Number(progress.mistake_streak ?? 0),
    // 撤销要能把 FSRS 状态原样放回去(null = 这次是它第一次进调度)
    fsrs: readFsrsState(wordId),
    review_queue: getReviewQueue()
  };

  advanceReviewQueue(wordId);
  // 间隔和「有多熟」全部由 FSRS 的 stability/difficulty 决定,不再维护分数。
  // 这里只留下几个纯统计计数(答对/模糊/忘记多少次),不参与任何调度判定。
  let knownForever = Number(progress.known_forever ?? 0);
  let rightCount = Number(progress.right_count ?? 0);
  let fuzzyCount = Number(progress.fuzzy_count ?? 0);
  let forgotCount = Number(progress.forgot_count ?? 0);
  // mistake_streak 留下来当会话内计数器(连着答错几次 → 允许贴脸重复),
  // 和 stage2/kanji 的 temp_score 一个性质,不参与任何长期记忆判定。
  let mistakeStreak = Number(progress.mistake_streak ?? 0);

  if (answer === "known_forever") {
    knownForever = 1;
    mistakeStreak = 0;
  } else {
    rightCount += answer === "know" ? 1 : 0;
    fuzzyCount += answer === "fuzzy" ? 1 : 0;
    forgotCount += answer === "forgot" ? 1 : 0;
    mistakeStreak = answer === "know" ? 0 : mistakeStreak + 1;
  }

  // 自动退休已由 FSRS 接管:间隔排到 180 天以外即视为掌握(isMastered),
  // 不再需要「3 连胜 + score ≥ 15」这套计数器,也不再有每日抽查池。
  // known_forever 只保留手动点「熟知」的语义。

  // FSRS 生效:每次作答都推进学习步骤,再据「是否毕业」决定当天要不要再出。
  // 未毕业(新词/答错,学习或重学中,due 只排到几分钟后)→ 塞回队列过几张再刷;
  // 毕业(due 排到明天及以后)→ 今天不再出。旧算法则沿用「分数 ≤6 未过就重排」。
  let fsrsGraduated = false;
  let graduationTest = false;
  let stepMinutes = 0; // 学习步骤给的「几分钟后再考」,用来换算隔几张卡
  // 顽固词判据用「当天累计答错次数」,不用 mistakeStreak —— 后者答对一次就清零,
  // 那样刚答对的瞬间这个词就不再算顽固,加码等于没加。次数只增不减,一整天有效。
  const wrongToday =
    firstValue<number>(
      `SELECT COUNT(*) FROM reviews
       WHERE word_id = ? AND reviewed_on = ? AND direction = 'forward'
         AND answer IN ('forgot','fuzzy')`,
      [wordId, studyDate],
      0
    ) + (answer === "forgot" || answer === "fuzzy" ? 1 : 0); // 本次作答还没入库,手动计上
  const stubbornWord = wrongToday >= STUBBORN_DAILY_MISTAKES;
  // 当天第一次看到就点「认识」= 额外奖励一次:按 Easy 记,跳过短期学习步骤,
  // 并把下次复习拉远。这个判据只看「今天是否已经答过这张卡」,不看 seen_count
  // 或它以前是否进入过 FSRS,所以历史词也能享受当天首答奖励。
  const firstSeenToday = firstValue<number>(
    "SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ? AND direction = 'forward'",
    [wordId, studyDate],
    0
  ) === 0;
  const firstKnowToday = firstSeenToday && answer === "know";
  const stepMode = firstKnowToday ? "known" : stubbornWord ? "stubborn" : "normal";

  if (!knownForever) {
    try {
      const next = recordFsrsReview(wordId, answer, new Date(), { mode: stepMode });
      fsrsGraduated = isGraduatedForDay(next, studyDayEnd());
      stepMinutes = Math.max((new Date(next.due).getTime() - Date.now()) / 60_000, 0);
      // 下一次答「认识」是不是就当天出队了?不写死步数 —— 让调度器自己回答,
      // 以后改学习步参数这里不用跟着改。
      graduationTest = !fsrsGraduated && isGraduatedForDay(
        recordReview(next, "know", new Date(), { mode: stubbornWord ? "stubborn" : "normal" }),
        studyDayEnd()
      );
    } catch (err) {
      console.warn("[fsrs] 记录跳过:", err);
      fsrsGraduated = answer === "know"; // 兜底:认识当作过了
    }
  }
  const notPassed = !fsrsGraduated;
  // 顽固词(连着错到阈值)排 0 位当场接着刷 —— 难词就是要越出越密才攻得下来。
  // 这里的 mistakeStreak 已经按本次作答更新过:答对即归零,所以贴脸重复只发生在
  // 连着答错的阶段;一旦答对,下一次由学习步骤拉开(10 分→约 10 个词,30 分→约 20 个)。
  const stubborn = mistakeStreak >= STUBBORN_MISTAKE_STREAK;
  // 长期低分词的毕业判定那一次拉到 8~20 张:那次「认识」会真的改写长期间隔,
  // 靠残留答对的话 FSRS 就收到假信号。中间步骤不受影响(答对也不毕业)。
  if (notPassed && !knownForever) {
    scheduleDelayedReview(
      wordId,
      stepMinutes,
      stubborn,
      graduationTest && isLongTermWeak(progress)
    );
  }
  setLastAnsweredWord(wordId);

  db.run(`
    UPDATE progress
    SET seen_count = seen_count + 1,
        known_forever = ?,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?
    WHERE word_id = ?
  `, [knownForever, studyDate, rightCount, fuzzyCount, forgotCount, mistakeStreak, wordId]);

  // score_after 是 score 系统留下的历史列(NOT NULL)。调度已完全交给 FSRS,
  // 这里写 0 占位;历史行里的旧值保留不动,供回看当初的曲线。
  db.run(
    "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, ?, 0, ?, 'forward')",
    [wordId, answer, studyDate]
  );
  const reviewId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
  // 记忆画像不是只在测试里手动刷新:每次真实正向答题后按阈值增量更新。
  // 统计页还会再补一次检查,这样已有历史用户打开页面也能脱离旧的默认 1.0。
  updateMemoryProfileIfNeeded();
  pushUndoSnapshot({ ...snapshot, review_id: reviewId });

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  notifyProgressUpdated();
  return getWordSession(options);
}

/**
 * 「没得撤销」的回答:停在当前这张卡上,一个字都不改。
 * 手上没有当前卡(比如刚进来还没发牌)才去正常取一张。
 */
const stayOnCurrentCard = (options: WordSessionOptions = {}): WordSessionResponse => {
  const mode = currentSessionMode(options);
  const wordId = Number(getState("current_card", "0")) || 0;
  const card = wordId
    ? (mode === "stage2" || mode === "kanji"
      ? directionCardById(directionByPhase(mode), wordId)
      : wordCardById(wordId))
    : null;
  if (!card) return getWordSession(options);
  const phase = mode === "done" ? currentPhase() : mode;
  return { card, phase, stats: getWordStats(phase, options), canUndo: false };
};

/**
 * 「上一个」:把最近一次作答整个放回去,并把那张卡原样交回来。
 *
 * 撤不了的时候(这一场还没答过、已经连撤两次、快照是别的模式或昨天的)**原样返回当前卡**,
 * 绝不重新抽词 —— 以前这里兜底走 getWordSession(),于是点一下就跳到一个无关的词上,
 * 在错题本里还会连模式一起掉回今日计划。
 */
export function undoLastWordAnswer(options: WordSessionOptions = {}): WordSessionResponse {
  ensureProgressInitialized();
  const db = getDatabase();
  const snapshot = popUndoSnapshot(currentSessionMode(options));
  if (!snapshot) return stayOnCurrentCard(options);

  if (snapshot.phase === "stage2" || snapshot.phase === "kanji") {
    // 反向/汉字的撤销和正向同构:把记忆行和 FSRS 状态放回作答前,并删掉那条流水
    undoDirectionAnswer(directionByPhase(String(snapshot.phase)), snapshot);
    setPhase(String(snapshot.phase));
  } else if (snapshot.phase === "stage1") {
    db.run(`
      UPDATE progress
      SET seen_count = ?,
          known_forever = ?,
          last_seen_on = ?,
          right_count = ?,
          fuzzy_count = ?,
          forgot_count = ?,
          mistake_streak = ?
      WHERE word_id = ?
    `, [
      Number(snapshot.seen_count ?? 0),
      Number(snapshot.known_forever ?? 0),
      snapshot.last_seen_on == null ? null : String(snapshot.last_seen_on),
      Number(snapshot.right_count ?? 0),
      Number(snapshot.fuzzy_count ?? 0),
      Number(snapshot.forgot_count ?? 0),
      Number(snapshot.mistake_streak ?? 0),
      Number(snapshot.word_id)
    ]);
    if (snapshot.review_id != null) {
      db.run("DELETE FROM reviews WHERE id = ?", [Number(snapshot.review_id)]);
    }
    // FSRS 是唯一调度器,撤销必须把 due/S/D 一起放回作答前,
    // 否则这个词会带着一个凭空多出来的下次到期时间留在计划里。
    restoreFsrsState(Number(snapshot.word_id), (snapshot.fsrs ?? null) as FsrsState | null);
    if (Array.isArray(snapshot.review_queue)) {
      setReviewQueue(snapshot.review_queue.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const wordId = Number(record.word_id);
        if (!Number.isFinite(wordId)) return [];
        return [{ word_id: wordId, due_after: Math.max(Number(record.due_after ?? 0), 0) }];
      }));
    }
    if (snapshot.last_answered_word != null) {
      setLastAnsweredWord(Number(snapshot.last_answered_word));
    }
    if (!hasWordFilter(options)) setPhase("stage1");
  }

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  notifyProgressUpdated();

  // 撤销的语义是「回到刚才那张」,而不是在恢复数据后再随机抽下一张。
  // 重新抽题会让用户看到无关词,也会把 current_card 留在错误的下一题上。
  const mode = String(snapshot.mode ?? snapshot.phase ?? "stage1");
  const wordId = Number(snapshot.word_id);
  const restoredCard = mode === "stage2" || mode === "kanji"
    ? directionCardById(directionByPhase(mode), wordId)
    : wordCardById(wordId);
  if (!restoredCard) return getWordSession(options);

  setCurrentCard(restoredCard);
  // 钉住:刷新、切前后台、任何一次读 session 都得还是这张,直到它被答掉
  pinCard(restoredCard.id, mode);
  return {
    card: restoredCard,
    phase: mode,
    stats: getWordStats(mode, options),
    canUndo: canUndoSnapshot(mode)
  };
}

export function updateWordNote(wordId: number, note: string): { wordId: number; note: string } {
  const db = getDatabase();
  const cleaned = note.trim();
  if (cleaned) {
    db.run(
      "INSERT OR REPLACE INTO word_notes (word_id, note, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
      [wordId, cleaned]
    );
  } else {
    db.run("DELETE FROM word_notes WHERE word_id = ?", [wordId]);
  }

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  return { wordId, note: cleaned };
}

export function addWordStudySeconds(seconds: number): { seconds: number; stats: WordStats } {
  // 只写 word_study_time 的话学习时长跨设备永远不同步(那张表按天单主键,
  // 没法合并)。改走 by_device:记本设备那行,再把当天跨设备合计写回原表。
  ensureSyncSchema();
  recordStudySeconds(today(), seconds);

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  return {
    seconds,
    stats: getWordStats("stage1")
  };
}
