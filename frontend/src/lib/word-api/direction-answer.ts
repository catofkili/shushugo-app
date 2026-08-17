import { getDatabase } from "../database";
import type { WordAnswer } from "../../types/vocabulary";
import { firstRow, firstValue, studyDayEnd, today } from "../study-core";
import { recordFsrsReview, readFsrsState, restoreFsrsState } from "../fsrs-store";
import {
  isGraduatedForDay,
  recordReview,
  STUBBORN_DAILY_MISTAKES,
  type FsrsState
} from "../fsrs-scheduler";
import { STUBBORN_MISTAKE_STREAK } from "../scheduler/requeue";
import {
  advanceReviewQueue,
  getReviewQueue,
  lastAnsweredWord,
  scheduleDelayedReview,
  setLastAnsweredWord,
  setReviewQueue
} from "./session-state";
import { ensureDirectionColumns, type StudyDirection } from "./directions";
import { pushUndoSnapshot } from "./undo-stack";

/**
 * 反向/汉字的作答 —— 和正向**同一套规则**,只是记忆表换成这个方向自己的那张。
 *
 * 以前这两个方向走的是 temp_score:答对加 10、≥10 算过关、due_after 计数器决定隔几张,
 * 且只活在当天的队列表里。所以「已掌握」「顽固卡」「毕业」这些概念在反向和汉字里
 * 根本不存在。现在换成:
 *   FSRS 记录 → 是否毕业 → 没毕业就按学习步骤隔几张重刷 → 往 reviews 记流水(带方向)
 * 一字不差地对齐正向,包括当日首答奖励和顽固卡的三步重学。
 */
export const applyDirectionAnswer = (
  direction: StudyDirection,
  wordId: number,
  answer: WordAnswer
): void => {
  ensureDirectionColumns(direction);
  const db = getDatabase();
  const table = direction.entity.table;
  const studyDate = today();
  const memory = firstRow(`SELECT * FROM ${table} WHERE word_id = ?`, [wordId]);
  if (!memory) {
    // 卡还不存在(理论上进不来:任务表是从记忆表建的),补一行免得整场卡住
    db.run(`INSERT OR IGNORE INTO ${table} (word_id, seen_count) VALUES (?, 0)`, [wordId]);
  }

  const snapshot = {
    phase: direction.phase,
    // 撤销要认「这是哪一场的快照」:模式对不上就当作没得撤销(见 undo-stack)
    mode: direction.phase,
    direction: direction.id,
    reviewed_on: studyDate,
    word_id: wordId,
    memory_exists: Boolean(memory),
    known_forever: Number(
      firstValue<number>("SELECT known_forever FROM progress WHERE word_id = ?", [wordId], 0) ?? 0
    ),
    last_answered_word: lastAnsweredWord(direction.id),
    seen_count: Number(memory?.seen_count ?? 0),
    right_count: Number(memory?.right_count ?? 0),
    fuzzy_count: Number(memory?.fuzzy_count ?? 0),
    forgot_count: Number(memory?.forgot_count ?? 0),
    mistake_streak: Number(memory?.mistake_streak ?? 0),
    last_seen_on: memory?.last_seen_on ?? null,
    fsrs: readFsrsState(wordId, direction.entity),
    review_queue: getReviewQueue(direction.id)
  };

  advanceReviewQueue(wordId, direction.id);

  let rightCount = Number(memory?.right_count ?? 0);
  let fuzzyCount = Number(memory?.fuzzy_count ?? 0);
  let forgotCount = Number(memory?.forgot_count ?? 0);
  let mistakeStreak = Number(memory?.mistake_streak ?? 0);
  // 「永久熟知」是对这个**词**的表态,不是对某个方向的,所以写在 progress 上,
  // 三个方向一起退出轮换。
  const knownForever = answer === "known_forever";
  if (knownForever) {
    db.run("UPDATE progress SET known_forever = 1 WHERE word_id = ?", [wordId]);
    mistakeStreak = 0;
  } else {
    rightCount += answer === "know" ? 1 : 0;
    fuzzyCount += answer === "fuzzy" ? 1 : 0;
    forgotCount += answer === "forgot" ? 1 : 0;
    mistakeStreak = answer === "know" ? 0 : mistakeStreak + 1;
  }

  // 顽固判定用「这个方向今天累计答错几次」——和正向同口径,只增不减,一整天有效
  const wrongToday = firstValue<number>(
    `SELECT COUNT(*) FROM reviews
     WHERE word_id = ? AND reviewed_on = ? AND direction = ? AND answer IN ('forgot','fuzzy')`,
    [wordId, studyDate, direction.id],
    0
  ) + (answer === "forgot" || answer === "fuzzy" ? 1 : 0);
  const stubbornCard = wrongToday >= STUBBORN_DAILY_MISTAKES;
  const firstSeenToday = firstValue<number>(
    "SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ? AND direction = ?",
    [wordId, studyDate, direction.id],
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
      const next = recordFsrsReview(wordId, answer, new Date(), { mode: stepMode }, direction.entity);
      graduated = isGraduatedForDay(next, studyDayEnd());
      stepMinutes = Math.max((new Date(next.due).getTime() - Date.now()) / 60_000, 0);
      graduationTest = !graduated && isGraduatedForDay(
        recordReview(next, "know", new Date(), { mode: stubbornCard ? "stubborn" : "normal" }),
        studyDayEnd()
      );
    } catch (err) {
      console.warn(`[fsrs] ${direction.label}记录跳过:`, err);
      graduated = answer === "know";
    }
  }

  if (!graduated && !knownForever) {
    scheduleDelayedReview(
      wordId,
      stepMinutes,
      mistakeStreak >= STUBBORN_MISTAKE_STREAK,
      graduationTest,
      direction.id
    );
  }
  setLastAnsweredWord(wordId, direction.id);

  db.run(`
    UPDATE ${table}
    SET seen_count = COALESCE(seen_count, 0) + 1,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?
    WHERE word_id = ?
  `, [studyDate, rightCount, fuzzyCount, forgotCount, mistakeStreak, wordId]);

  db.run(
    "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, ?, 0, ?, ?)",
    [wordId, answer, studyDate, direction.id]
  );
  const reviewId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
  pushUndoSnapshot({ ...snapshot, review_id: reviewId });
};

/** 撤销:把这个方向的记忆行和 FSRS 状态原样放回作答前 */
export const undoDirectionAnswer = (
  direction: StudyDirection,
  snapshot: Record<string, unknown>
): void => {
  ensureDirectionColumns(direction);
  const db = getDatabase();
  const wordId = Number(snapshot.word_id);
  db.run(`
    UPDATE ${direction.entity.table}
    SET seen_count = ?, right_count = ?, fuzzy_count = ?, forgot_count = ?,
        mistake_streak = ?, last_seen_on = ?
    WHERE word_id = ?
  `, [
    Number(snapshot.seen_count ?? 0),
    Number(snapshot.right_count ?? 0),
    Number(snapshot.fuzzy_count ?? 0),
    Number(snapshot.forgot_count ?? 0),
    Number(snapshot.mistake_streak ?? 0),
    snapshot.last_seen_on ?? null,
    wordId
  ]);
  restoreFsrsState(wordId, (snapshot.fsrs ?? null) as FsrsState | null, direction.entity);
  // 「永久熟知」写在 progress 上(三个方向一起退出轮换),不放回去的话撤销等于没撤
  db.run("UPDATE progress SET known_forever = ? WHERE word_id = ?", [
    Number(snapshot.known_forever ?? 0),
    wordId
  ]);
  if (Array.isArray(snapshot.review_queue)) {
    setReviewQueue(snapshot.review_queue.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const queuedId = Number(record.word_id);
      if (!Number.isFinite(queuedId)) return [];
      return [{ word_id: queuedId, due_after: Math.max(Number(record.due_after ?? 0), 0) }];
    }), direction.id);
  }
  if (snapshot.last_answered_word != null) {
    setLastAnsweredWord(Number(snapshot.last_answered_word), direction.id);
  }
  if (snapshot.review_id != null) {
    db.run("DELETE FROM reviews WHERE id = ?", [Number(snapshot.review_id)]);
  }
};
