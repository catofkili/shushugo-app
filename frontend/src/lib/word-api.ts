import { getDatabase } from "./database";
import { WordAnswer, WordCard, WordSessionResponse, WordStats } from "../types/vocabulary";
import { getDailyWordGoal } from "./studyPreferences";
import { rowObjectToCard } from "./models/word-card";
import { notifyProgressUpdated } from "./progress-events";
import { requeueGap, STUBBORN_MISTAKE_STREAK } from "./scheduler/requeue";
import {
  answerScore,
  CRITICAL_SCORE,
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
import { nextRightStreak, SCORE_CAP, shouldAutoRetire } from "./streak-ladder";
import {
  encoreChunkSize,
  markComebackAnnouncedOn,
  recordEncore,
  retuneComebackMode
} from "./comeback";
import type { ComebackMode } from "./comeback";
import { recordFsrsReview, isFsrsActive } from "./fsrs-store";
import { isGraduatedForDay, STUBBORN_DAILY_MISTAKES } from "./fsrs-scheduler";
import {
  advanceReviewQueue,
  getReviewQueue,
  scheduleDelayedReview,
  setLastAnsweredWord,
  setReviewQueue
} from "./word-api/session-state";
import { ensureProgressInitialized } from "./word-api/bootstrap";
import { getWordStats } from "./word-api/stats";
import { hasWordFilter, wordFilterSql } from "./word-api/filters";
import {
  advanceKanjiQueue,
  advanceStage2Queue,
  buildKanjiProgressFromReviews,
  kanjiStats,
  pickKanjiNext,
  pickStage2Next,
  recordStage2Word,
  stage2Stats
} from "./word-api/queues";
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

// 导出分析统计功能
export { getStudyAnalytics } from "./analytics/stats";
export type {
  FavoriteItem,
  FavoriteType,
  GrammarMistakeItem,
  GrammarStudyCard,
  GrammarStudySession,
  GrammarStudyStats,
  LevelProgressItem,
  ProgressOverview,
  StudyAnswer,
  WordSessionOptions
} from "./study-types";
export {
  getGrammarMistakes,
  getGrammarPointFavorite,
  getGrammarSession,
  getGrammarStats,
  prioritizeGrammarMistake,
  resolveGrammarMistake,
  submitGrammarAnswer
} from "./grammar-api";
export { getFavoriteItems, toggleFavorite } from "./favorites-api";



const currentPhase = () => {
  const day = today();
  if (getState("phase_date", "") !== day) {
    setState("phase_date", day);
    setState("phase", "stage1");
  }
  const phase = getState("phase", "stage1");
  if (phase === "stage2") {
    const stage2 = stage2Stats();
    if (stage2.total > 0 && stage2.completed >= stage2.total) {
      setState("phase", "kanji");
      return "kanji";
    }
  }
  if (phase === "kanji") {
    const kanji = kanjiStats();
    if (kanji.total > 0 && kanji.completed >= kanji.total) {
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
      SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
             p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
             p.mistake_streak, COALESCE(n.note, '') AS note
      FROM words w
      JOIN progress p ON p.word_id = w.id
      LEFT JOIN word_notes n ON n.word_id = w.id
      WHERE w.id IN (${placeholders})
        AND p.known_forever = 0
        ${filter.clause}
      ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, w.importance DESC
      LIMIT 1
    `, [...dueIds, ...filter.params]);
    if (due) return rowObjectToCard(due);
  }

  const critical = firstRow(`
    SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND p.score <= ?
      ${filter.clause}
    ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, w.importance DESC
    LIMIT 1
  `, [CRITICAL_SCORE, ...filter.params]);
  if (critical) return rowObjectToCard(critical);

  const low = firstRow(`
    SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND p.score <= 6
      ${filter.clause}
    ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, w.importance DESC
    LIMIT 1
  `, filter.params);
  if (low) return rowObjectToCard(low);

  const unseen = firstRow(`
    SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count = 0
      ${filter.clause}
    ORDER BY CASE w.jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END,
             w.importance DESC, w.shuffle_rank DESC, w.id ASC
    LIMIT 1
  `, filter.params);
  if (unseen) return rowObjectToCard(unseen);

  const review = firstRow(`
    SELECT w.*, p.score, p.seen_count, p.known_forever, p.mastered_on,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      ${filter.clause}
    ORDER BY p.score ASC, p.last_seen_on ASC, w.importance DESC, w.shuffle_rank DESC
    LIMIT 1
  `, filter.params);
  return review ? rowObjectToCard(review) : null;
};

const setCurrentCard = (card: WordCard | null): void => {
  setState("current_card", card && card.id != null ? String(card.id) : "0");
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
    return true;
  }
  return false;
};

const nextCard = (options: WordSessionOptions = {}): { card: WordCard | null; phase: string } => {
  const result = resolveNextCard(options);
  setCurrentCard(result.card);
  return result;
};

const resolveNextCard = (options: WordSessionOptions = {}): { card: WordCard | null; phase: string } => {
  if (hasWordFilter(options)) {
    return { card: pickFilteredWordNext(options), phase: "filtered" };
  }
  const phase = currentPhase();
  if (phase === "done") return { card: null, phase: "done" };
  if (phase === "stage2") {
    const card = pickStage2Next();
    if (card) return { card, phase: "stage2" };
    setPhase("done");
    recordCheckin();
    return { card: null, phase: "done" };
  }
  if (phase === "kanji") {
    buildKanjiProgressFromReviews();
    const card = pickKanjiNext();
    if (card) return { card, phase: "kanji" };
    setPhase("done");
    recordCheckin();
    return { card: null, phase: "done" };
  }

  const stage1Card = pickStage1Next();
  if (stage1Card) return { card: stage1Card, phase: "stage1" };

  const stage2 = stage2Stats();
  if (stage2.total > 0 && stage2.completed < stage2.total) {
    setPhase("stage2");
    const card = pickStage2Next();
    if (card) return { card, phase: "stage2" };
  }

  buildKanjiProgressFromReviews();
  const kanji = kanjiStats();
  if (kanji.total > 0 && kanji.completed < kanji.total) {
    setPhase("kanji");
    const card = pickKanjiNext();
    if (card) return { card, phase: "kanji" };
  }

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
  }
  notifyProgressUpdated();
  return getWordStats(currentPhase());
}

export function completeTodayWordPlan(): { stats: WordStats; completedCount: number } {
  ensureProgressInitialized();
  const day = today();
  ensureStage1Tasks();
  const rows = rowsFor(`
    SELECT t.word_id, p.score
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND p.score <= 6
  `, [day]);
  const ids = rows.map((row) => Number(row.word_id)).filter((id) => Number.isFinite(id));

  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    // 与 answerWord 的「首见答对」同规则:+15 封顶 20、非深坑词连胜 +1;
    // 但一键完成是快捷通道,不参与自动退休(退休只能靠真实作答攒出来)。
    // MAX(…, 10) 保证深坑词也算完成今日任务,维持本函数「清空今日计划」的契约。
    getDatabase().run(`
      UPDATE progress
      SET score = MIN(MAX(score + 15, 10), ${SCORE_CAP}),
          right_streak = CASE WHEN score >= 0 THEN right_streak + 1 ELSE right_streak END,
          seen_count = seen_count + 1,
          mastered_on = COALESCE(mastered_on, ?),
          last_seen_on = ?,
          right_count = right_count + 1,
          mistake_streak = 0
      WHERE word_id IN (${placeholders})
        AND known_forever = 0
    `, [day, day, ...ids]);

    getDatabase().run(`
      INSERT INTO reviews (word_id, answer, score_after, reviewed_on)
      SELECT t.word_id, 'know', 10, ?
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

  getDatabase().run(`
    UPDATE stage2_progress
    SET temp_score = MAX(temp_score, 10),
        completed = 1,
        due_after = NULL
    WHERE reviewed_on = ?
  `, [day]);
  getDatabase().run(`
    UPDATE kanji_progress
    SET temp_score = MAX(temp_score, 10),
        completed = 1,
        due_after = NULL
    WHERE reviewed_on = ?
  `, [day]);

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

export function markComebackAnnounced(): WordStats {
  ensureProgressInitialized();
  markComebackAnnouncedOn(today());
  persistSoon();
  return getWordStats(currentPhase());
}

/**
 * 回归进行中当场切换节奏（欢迎卡上的 🌱/⚡）：重算 planDays，
 * 并按新档位重建当天复习任务（未完成时才重建，避免丢已答进度）。
 */
export function setComebackModeForToday(mode: ComebackMode): WordStats {
  ensureProgressInitialized();
  retuneComebackMode(mode);
  const stats = refreshTodayWordPlan();
  persistSoon();
  return stats;
}

/**
 * 续杯：今日计划完成后，从积压里按遗忘风险再取一小批（递减批量）
 * 加入今日任务并回到 Stage1 继续学。
 */
export function startComebackEncore(customSize?: number): WordSessionResponse {
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
      AND p.score <= 6
      AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
    ORDER BY
      p.score ASC,
      p.low_history DESC,
      w.importance DESC,
      p.last_seen_on ASC,
      p.word_id ASC
    LIMIT ?
  `, [day, size]);
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
      ORDER BY w.shuffle_rank DESC, w.importance DESC, p.word_id ASC
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


export function getWordSession(options: WordSessionOptions = {}): WordSessionResponse {
  ensureProgressInitialized();
  const { card, phase } = nextCard(options);
  return {
    card,
    phase,
    stats: getWordStats(phase, options)
  };
}

export function continueStage2Study(): WordSessionResponse {
  ensureProgressInitialized();
  const stage2 = stage2Stats();
  if (stage2.total > 0 && stage2.completed < stage2.total) {
    setPhase("stage2");
    return getWordSession();
  }
  setPhase("done");
  return getWordSession();
}

export function continueKanjiStudy(): WordSessionResponse {
  ensureProgressInitialized();
  buildKanjiProgressFromReviews();
  const kanji = kanjiStats();
  if (kanji.total > 0 && kanji.completed < kanji.total) {
    setPhase("kanji");
    return getWordSession();
  }
  setPhase("done");
  return getWordSession();
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
  const phase = currentPhase();

  if (phase === "stage2") {
    const current = firstRow("SELECT * FROM stage2_progress WHERE reviewed_on = ? AND word_id = ?", [studyDate, wordId]);
    if (!current) return getWordSession(options);
    advanceStage2Queue(wordId);
    const snapshot = {
      phase: "stage2",
      reviewed_on: studyDate,
      word_id: wordId,
      temp_score: Number(current.temp_score ?? 0),
      seen_count: Number(current.seen_count ?? 0),
      completed: Number(current.completed ?? 0),
      due_after: current.due_after
    };
    const tempScore = Math.max(Number(current.temp_score ?? 0) + answerScore[answer], -40);
    const completed = tempScore >= 10 ? 1 : 0;
    const dueAfter = completed ? null : requeueGap(0);
    db.run(`
      UPDATE stage2_progress
      SET temp_score = ?, seen_count = seen_count + 1,
          completed = ?, due_after = ?
      WHERE reviewed_on = ? AND word_id = ?
    `, [tempScore, completed, dueAfter, studyDate, wordId]);
    setState("last_answer", JSON.stringify(snapshot));
    import("./storage").then(({ scheduleSave }) => scheduleSave());
    notifyProgressUpdated();
    return getWordSession(options);
  }

  if (phase === "kanji") {
    const current = firstRow("SELECT * FROM kanji_progress WHERE reviewed_on = ? AND word_id = ?", [studyDate, wordId]);
    if (!current) return getWordSession(options);
    const memory = firstRow("SELECT * FROM kanji_memory WHERE word_id = ?", [wordId]);
    advanceKanjiQueue(wordId);
    const snapshot = {
      phase: "kanji",
      reviewed_on: studyDate,
      word_id: wordId,
      temp_score: Number(current.temp_score ?? 0),
      seen_count: Number(current.seen_count ?? 0),
      completed: Number(current.completed ?? 0),
      due_after: current.due_after,
      memory_exists: Boolean(memory),
      memory_score: Number(memory?.score ?? 0),
      memory_seen_count: Number(memory?.seen_count ?? 0),
      memory_right_count: Number(memory?.right_count ?? 0),
      memory_fuzzy_count: Number(memory?.fuzzy_count ?? 0),
      memory_forgot_count: Number(memory?.forgot_count ?? 0),
      memory_low_history: Number(memory?.low_history ?? 0),
      memory_last_seen_on: memory?.last_seen_on ?? null
    };
    const delta = answerScore[answer];
    const tempScore = Math.max(Number(current.temp_score ?? 0) + delta, -40);
    const memoryScore = Math.max(Number(memory?.score ?? 0) + delta, -40);
    const completed = tempScore >= 10 ? 1 : 0;
    const lowHistory = memoryScore <= CRITICAL_SCORE || Number(memory?.low_history ?? 0) ? 1 : 0;
    // 差词也不贴脸重复:短步间隔(3~8 张)已经够密,再短就是照着刚才的答案抄
    const dueAfter = completed ? null : requeueGap(0);
    db.run(`
      UPDATE kanji_progress
      SET temp_score = ?, seen_count = seen_count + 1,
          completed = ?, due_after = ?
      WHERE reviewed_on = ? AND word_id = ?
    `, [tempScore, completed, dueAfter, studyDate, wordId]);
    db.run(`
      INSERT INTO kanji_memory (
        word_id, score, seen_count, right_count,
        fuzzy_count, forgot_count, low_history, last_seen_on
      )
      VALUES (?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(word_id) DO UPDATE SET
        score = excluded.score,
        seen_count = kanji_memory.seen_count + 1,
        right_count = kanji_memory.right_count + excluded.right_count,
        fuzzy_count = kanji_memory.fuzzy_count + excluded.fuzzy_count,
        forgot_count = kanji_memory.forgot_count + excluded.forgot_count,
        low_history = MAX(kanji_memory.low_history, excluded.low_history),
        last_seen_on = excluded.last_seen_on
    `, [
      wordId,
      memoryScore,
      answer === "know" || answer === "known_forever" ? 1 : 0,
      answer === "fuzzy" ? 1 : 0,
      answer === "forgot" ? 1 : 0,
      lowHistory,
      studyDate
    ]);
    setState("last_answer", JSON.stringify(snapshot));
    import("./storage").then(({ scheduleSave }) => scheduleSave());
    notifyProgressUpdated();
    return getWordSession(options);
  }

  const progress = firstRow("SELECT * FROM progress WHERE word_id = ?", [wordId]);
  if (!progress) return getWordSession(options);
  const snapshot = {
    phase: "stage1",
    word_id: wordId,
    score: Number(progress.score ?? 0),
    seen_count: Number(progress.seen_count ?? 0),
    low_history: Number(progress.low_history ?? 0),
    known_forever: Number(progress.known_forever ?? 0),
    mastered_on: progress.mastered_on,
    last_seen_on: progress.last_seen_on,
    right_count: Number(progress.right_count ?? 0),
    fuzzy_count: Number(progress.fuzzy_count ?? 0),
    forgot_count: Number(progress.forgot_count ?? 0),
    mistake_streak: Number(progress.mistake_streak ?? 0),
    right_streak: Number(progress.right_streak ?? 0),
    auto_retired_on: progress.auto_retired_on ?? null,
    review_queue: getReviewQueue()
  };

  advanceReviewQueue(wordId);
  const preScore = Number(progress.score ?? 0);
  let score = preScore;
  let knownForever = Number(progress.known_forever ?? 0);
  let rightCount = Number(progress.right_count ?? 0);
  let fuzzyCount = Number(progress.fuzzy_count ?? 0);
  let forgotCount = Number(progress.forgot_count ?? 0);
  let mistakeStreak = Number(progress.mistake_streak ?? 0);
  let rightStreak = Number(progress.right_streak ?? 0);
  let autoRetiredOn = progress.auto_retired_on == null ? null : String(progress.auto_retired_on);

  if (answer === "known_forever") {
    knownForever = 1;
    mistakeStreak = 0;
    // 手动熟知 = 永久退休,不参与抽查
    autoRetiredOn = null;
  } else {
    // First "know" of the day on a word earns a +5 first-impression bonus
    // (+15 instead of +10). Only the day's first sighting counts; fuzzy/forgot
    // and later sightings are unchanged.
    const firstSeenToday =
      firstValue<number>("SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ?", [wordId, studyDate], 0) === 0;
    const delta = answer === "know" && firstSeenToday ? 15 : answerScore[answer];
    score = Math.min(Math.max(score + delta, -40), SCORE_CAP);
    rightCount += answer === "know" ? 1 : 0;
    fuzzyCount += answer === "fuzzy" ? 1 : 0;
    forgotCount += answer === "forgot" ? 1 : 0;
    mistakeStreak = answer === "know" ? 0 : mistakeStreak + 1;
    rightStreak = nextRightStreak(rightStreak, answer, firstSeenToday, preScore);
  }

  let lowHistory = Number(progress.low_history ?? 0);
  if (score <= CRITICAL_SCORE) lowHistory = 1;
  if (score <= CRITICAL_SCORE && !knownForever) {
    db.run("INSERT OR IGNORE INTO critical_reviews (reviewed_on, word_id) VALUES (?, ?)", [studyDate, wordId]);
  }
  // 连胜攒满自动退休,进抽查池(known_forever + auto_retired_on 标记)
  if (!knownForever && answer === "know" && shouldAutoRetire(rightStreak, score, lowHistory === 1)) {
    knownForever = 1;
    autoRetiredOn = studyDate;
  }
  const masteredOn = score >= 10 && !knownForever ? studyDate : null;

  // FSRS 生效:每次作答都推进学习步骤,再据「是否毕业」决定当天要不要再出。
  // 未毕业(新词/答错,学习或重学中,due 只排到几分钟后)→ 塞回队列过几张再刷;
  // 毕业(due 排到明天及以后)→ 今天不再出。旧算法则沿用「分数 ≤6 未过就重排」。
  let fsrsGraduated = false;
  let stepMinutes = 0; // 学习步骤给的「几分钟后再考」,用来换算隔几张卡
  // 顽固词判据用「当天累计答错次数」,不用 mistakeStreak —— 后者答对一次就清零,
  // 那样刚答对的瞬间这个词就不再算顽固,加码等于没加。次数只增不减,一整天有效。
  const wrongToday =
    firstValue<number>(
      "SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')",
      [wordId, studyDate],
      0
    ) + (answer === "forgot" || answer === "fuzzy" ? 1 : 0); // 本次作答还没入库,手动计上
  const stubbornWord = wrongToday >= STUBBORN_DAILY_MISTAKES;
  // 新词第一次见到就点「认识」= 看答案之前就已经会了,这个词不需要软件帮着记。
  // 跳过学习步骤直接毕业,当天不再出现(间隔照常由 FSRS 给:首次 Good = 2 天)。
  const alreadyKnown = Number(progress.seen_count ?? 0) === 0 && answer === "know";
  const stepMode = alreadyKnown ? "known" : stubbornWord ? "stubborn" : "normal";

  if (isFsrsActive() && !knownForever) {
    try {
      const next = recordFsrsReview(wordId, answer, new Date(), { mode: stepMode });
      fsrsGraduated = isGraduatedForDay(next, studyDayEnd());
      stepMinutes = Math.max((new Date(next.due).getTime() - Date.now()) / 60_000, 0);
    } catch (err) {
      console.warn("[fsrs] 记录跳过:", err);
      fsrsGraduated = answer === "know"; // 兜底:认识当作过了
    }
  }
  const notPassed = isFsrsActive() ? !fsrsGraduated : score <= 6;
  // 顽固词(连着错到阈值)排 0 位当场接着刷 —— 难词就是要越出越密才攻得下来。
  // 这里的 mistakeStreak 已经按本次作答更新过:答对即归零,所以贴脸重复只发生在
  // 连着答错的阶段;一旦答对,下一次由学习步骤拉开(10 分→约 10 个词,30 分→约 20 个)。
  const stubborn = mistakeStreak >= STUBBORN_MISTAKE_STREAK;
  if (notPassed && !knownForever) scheduleDelayedReview(wordId, stepMinutes, stubborn);
  setLastAnsweredWord(wordId);
  if (answer !== "known_forever") recordStage2Word(wordId);

  db.run(`
    UPDATE progress
    SET score = ?,
        seen_count = seen_count + 1,
        low_history = ?,
        known_forever = ?,
        mastered_on = ?,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?,
        right_streak = ?,
        auto_retired_on = ?
    WHERE word_id = ?
  `, [score, lowHistory, knownForever, masteredOn, studyDate, rightCount, fuzzyCount, forgotCount, mistakeStreak, rightStreak, autoRetiredOn, wordId]);

  db.run(
    "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
    [wordId, answer, score, studyDate]
  );
  const reviewId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
  setState("last_answer", JSON.stringify({ ...snapshot, review_id: reviewId }));

  // FSRS 未启用时:保留「当日首见」影子写,供切换前对比明日到期数。
  // 已启用时:上面已在每次作答时记录(学习步骤需要每次推进),此处不再重复写。
  if (!isFsrsActive()) {
    try {
      const priorToday = firstValue<number>(
        "SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ? AND id < ?",
        [wordId, studyDate, reviewId],
        0
      );
      if (priorToday === 0) recordFsrsReview(wordId, answer);
    } catch (err) {
      console.warn("[fsrs] 影子写跳过:", err);
    }
  }

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  notifyProgressUpdated();
  return getWordSession(options);
}

export function undoLastWordAnswer(): WordSessionResponse {
  ensureProgressInitialized();
  const db = getDatabase();
  const rawSnapshot = getState("last_answer", "");
  if (!rawSnapshot) return getWordSession();

  let snapshot: Record<string, unknown>;
  try {
    snapshot = JSON.parse(rawSnapshot) as Record<string, unknown>;
  } catch {
    return getWordSession();
  }

  if (snapshot.phase === "stage2") {
    db.run(`
      UPDATE stage2_progress
      SET temp_score = ?, seen_count = ?, completed = ?, due_after = ?
      WHERE reviewed_on = ? AND word_id = ?
    `, [
      Number(snapshot.temp_score ?? 0),
      Number(snapshot.seen_count ?? 0),
      Number(snapshot.completed ?? 0),
      snapshot.due_after == null ? null : Number(snapshot.due_after),
      String(snapshot.reviewed_on ?? today()),
      Number(snapshot.word_id)
    ]);
    setPhase("stage2");
  } else if (snapshot.phase === "kanji") {
    db.run(`
      UPDATE kanji_progress
      SET temp_score = ?, seen_count = ?, completed = ?, due_after = ?
      WHERE reviewed_on = ? AND word_id = ?
    `, [
      Number(snapshot.temp_score ?? 0),
      Number(snapshot.seen_count ?? 0),
      Number(snapshot.completed ?? 0),
      snapshot.due_after == null ? null : Number(snapshot.due_after),
      String(snapshot.reviewed_on ?? today()),
      Number(snapshot.word_id)
    ]);
    if (snapshot.memory_exists) {
      db.run(`
        INSERT INTO kanji_memory (
          word_id, score, seen_count, right_count,
          fuzzy_count, forgot_count, low_history, last_seen_on
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
          score = excluded.score,
          seen_count = excluded.seen_count,
          right_count = excluded.right_count,
          fuzzy_count = excluded.fuzzy_count,
          forgot_count = excluded.forgot_count,
          low_history = excluded.low_history,
          last_seen_on = excluded.last_seen_on
      `, [
        Number(snapshot.word_id),
        Number(snapshot.memory_score ?? 0),
        Number(snapshot.memory_seen_count ?? 0),
        Number(snapshot.memory_right_count ?? 0),
        Number(snapshot.memory_fuzzy_count ?? 0),
        Number(snapshot.memory_forgot_count ?? 0),
        Number(snapshot.memory_low_history ?? 0),
        snapshot.memory_last_seen_on == null ? null : String(snapshot.memory_last_seen_on)
      ]);
    } else {
      db.run("DELETE FROM kanji_memory WHERE word_id = ?", [Number(snapshot.word_id)]);
    }
    setPhase("kanji");
  } else if (snapshot.phase === "stage1") {
    db.run(`
      UPDATE progress
      SET score = ?,
          seen_count = ?,
          low_history = ?,
          known_forever = ?,
          mastered_on = ?,
          last_seen_on = ?,
          right_count = ?,
          fuzzy_count = ?,
          forgot_count = ?,
          mistake_streak = ?,
          right_streak = ?,
          auto_retired_on = ?
      WHERE word_id = ?
    `, [
      Number(snapshot.score ?? 0),
      Number(snapshot.seen_count ?? 0),
      Number(snapshot.low_history ?? 0),
      Number(snapshot.known_forever ?? 0),
      snapshot.mastered_on == null ? null : String(snapshot.mastered_on),
      snapshot.last_seen_on == null ? null : String(snapshot.last_seen_on),
      Number(snapshot.right_count ?? 0),
      Number(snapshot.fuzzy_count ?? 0),
      Number(snapshot.forgot_count ?? 0),
      Number(snapshot.mistake_streak ?? 0),
      Number(snapshot.right_streak ?? 0),
      snapshot.auto_retired_on == null ? null : String(snapshot.auto_retired_on),
      Number(snapshot.word_id)
    ]);
    if (snapshot.review_id != null) {
      db.run("DELETE FROM reviews WHERE id = ?", [Number(snapshot.review_id)]);
    }
    if (Array.isArray(snapshot.review_queue)) {
      setReviewQueue(snapshot.review_queue.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const wordId = Number(record.word_id);
        if (!Number.isFinite(wordId)) return [];
        return [{ word_id: wordId, due_after: Math.max(Number(record.due_after ?? 0), 0) }];
      }));
    }
    setPhase("stage1");
  }

  setState("last_answer", "");

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  notifyProgressUpdated();

  // 撤销的语义是「回到刚才那张」，而不是在恢复数据后再随机抽下一张。
  // 重新抽题会让用户看到无关词，也会把 current_card 留在错误的下一题上。
  const restoredRow = firstRow(`
    SELECT
      w.*,
      p.score,
      p.seen_count,
      p.low_history,
      p.known_forever,
      p.mastered_on,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.last_decay_amount,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `, [Number(snapshot.word_id)]);
  const restoredCard = restoredRow ? rowObjectToCard(restoredRow) : null;
  if (restoredCard) {
    const restoredPhase = snapshot.phase === "stage2" || snapshot.phase === "kanji" || snapshot.phase === "stage1"
      ? snapshot.phase
      : currentPhase();
    setCurrentCard(restoredCard);
    return {
      card: restoredCard,
      phase: restoredPhase,
      stats: getWordStats(restoredPhase)
    };
  }

  return getWordSession();
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
  const db = getDatabase();
  const studyDate = today();
  db.run(`
    INSERT INTO word_study_time (studied_on, seconds, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(studied_on) DO UPDATE SET
      seconds = seconds + excluded.seconds,
      updated_at = CURRENT_TIMESTAMP
  `, [studyDate, Math.max(0, Math.round(seconds))]);

  import("./storage").then(({ scheduleSave }) => scheduleSave());
  return {
    seconds,
    stats: getWordStats("stage1")
  };
}
