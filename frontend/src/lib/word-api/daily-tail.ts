import type { WordCard } from "../../types/vocabulary";
import { firstRow, getState, persistSoon, rowsFor, setState, studyDayEnd, today } from "../study-core";
import { notifyProgressUpdated } from "../progress-events";
import { rowObjectToCard } from "../models/word-card";
import { recallFromRow } from "../fsrs-store";
import { stage1ProgressCounts } from "./stage1";
import { ensureDailyRelief } from "./daily-relief";

// v2 让**今天已经按老判据挑好的那份**失效（和 daily_relief_v2 同一个套路）。
// ⚠️ 改压轴的挑法却不换 key = 改了个寂寞：ensureDailyTail 见到当天已有状态就直接返回，
// 用户当天怎么刷新都还是老那七张。2026-09-01 实测踩到:代码换了、他看到的一个字没变。
const TAIL_STATE_KEY = "daily_tail_v2";
const MIN_TAIL_WORDS = 3;
const MAX_TAIL_WORDS = 7;
/**
 * 同一张压轴卡最多出现三次（第一次 + 两次重来）。
 * 答错就挪到队尾重来，但不能无上限 —— 那会把「今天到此为止」变成一道关卡。
 */
const MAX_TAIL_APPEARANCES = 3;

interface DailyTailState {
  studyDate: string;
  wordIds: number[];
  completed: number;
}

const emptyTail = (studyDate = today()): DailyTailState => ({ studyDate, wordIds: [], completed: 0 });

const readTail = (studyDate = today()): DailyTailState => {
  const raw = getState(TAIL_STATE_KEY, "");
  if (!raw) return emptyTail(studyDate);
  try {
    const parsed = JSON.parse(raw) as Partial<DailyTailState>;
    if (parsed.studyDate !== studyDate) return emptyTail(studyDate);
    const wordIds = Array.isArray(parsed.wordIds)
      ? parsed.wordIds.map(Number).filter((id) => Number.isFinite(id))
      : [];
    return {
      studyDate,
      // ⚠️ 这里**不能去重**：答错重来就是往队尾再排一份同一个 id，
      // 重复项正是「这张卡出现过几次」的记录。
      wordIds,
      completed: Math.min(Math.max(Number(parsed.completed ?? 0), 0), wordIds.length)
    };
  } catch {
    return emptyTail(studyDate);
  }
};

const writeTail = (state: DailyTailState): DailyTailState => {
  setState(TAIL_STATE_KEY, JSON.stringify(state));
  persistSoon();
  notifyProgressUpdated();
  return state;
};

/**
 * ⚠️ **压轴卡必须按「记得牢」挑，不能按「此刻回忆概率高」挑。**
 *
 * 原来的判据是 `recall >= 0.82` 再按 recall 从高到低取前 7 张 —— 而 recall 是
 * 「距上次复习多久 / 稳定性」的函数，**刚答过的卡 recall 恒等于 1**。于是排在最前面的
 * 永远是今天刚复习过、而且因为老记不住所以复习得最勤的那批。实测用户 2026-08-31 的
 * 压轴七张里有四张是这样进来的：別れ（看过 30 次、忘过 11 次、稳定性 **0.57 天**）、
 * 虫（0.83 天）、鍋（1.45 天）、袖（3.84 天）。说好的「轻松收尾」，端上来的是他最不熟的词。
 *
 * 现在按稳定性设闸：`fsrs_stability >= TAIL_MIN_STABILITY`（14 天，和「昨日减负」
 * 那批词的实际水平同一档——实测减负词稳定性 14~21 天）。达标的候选按天随机取，
 * 不再按 recall 排序。实测用户库里达标候选有 870 个，够选。
 */
const TAIL_MIN_STABILITY = 14;

const highRecallRows = (): Record<string, unknown>[] => {
  const day = today();
  const dayEnd = studyDayEnd().toISOString();
  const reliefWordIds = new Set(ensureDailyRelief().wordIds);
  const rows = rowsFor(`
    SELECT
      w.*,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.fsrs_stability,
      p.fsrs_difficulty,
      p.fsrs_due,
      p.fsrs_last_review,
      p.fsrs_state,
      p.fsrs_steps,
      p.fsrs_reps,
      p.fsrs_lapses,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count >= 3
      AND p.fsrs_due IS NOT NULL
      AND p.fsrs_due > ?
      AND p.fsrs_stability >= ?
      AND NOT EXISTS (
        SELECT 1 FROM stage1_tasks t
        WHERE t.reviewed_on = ? AND t.word_id = p.word_id
      )
      -- 今天已经答过的不算「再确认一次」，那是一小时前刚做过的题
      AND NOT EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.word_id = p.word_id AND r.reviewed_on = ? AND r.direction = 'forward'
      )
  `, [dayEnd, TAIL_MIN_STABILITY, day, day]);
  return rows
    .map((row) => ({ row, recall: recallFromRow(row) ?? 0 }))
    .filter((item) => !reliefWordIds.has(Number(item.row.id)))
    .filter((item) => item.recall >= 0.82)
    // 按 recall 排序等于按「最近刚复习过」排序,那正是把不稳的词排到最前面的原因。
    // 达标的都够格收尾,随机取就行。
    .sort(() => Math.random() - 0.5)
    .slice(0, MAX_TAIL_WORDS)
    .map((item) => item.row);
};

/**
 * 真正结尾的轻松压轴卡。后台会在今日计划建立后预选，且不进入今日任务表；
 * 只有前置计划完全毕业后才允许 getDailyTailNext() 把它们交给前端。
 * 它们仍可走正式答题，所以用户如果想再确认一次，FSRS 会照常保存结果。
 */
export const ensureDailyTail = (): DailyTailState => {
  const studyDate = today();
  const existing = readTail(studyDate);
  const raw = getState(TAIL_STATE_KEY, "");
  let hasCurrentState = false;
  if (raw) {
    try {
      hasCurrentState = (JSON.parse(raw) as Partial<DailyTailState>).studyDate === studyDate;
    } catch {
      hasCurrentState = false;
    }
  }
  if (existing.wordIds.length > 0 || hasCurrentState) return existing;
  const frontPlan = stage1ProgressCounts();
  if (frontPlan.total <= 0) return emptyTail(studyDate);
  const wordIds = highRecallRows().map((row) => Number(row.id));
  const tailSize = wordIds.length >= MIN_TAIL_WORDS
    ? MIN_TAIL_WORDS + Math.floor(Math.random() * (Math.min(MAX_TAIL_WORDS, wordIds.length) - MIN_TAIL_WORDS + 1))
    : 0;
  return writeTail({ studyDate, wordIds: wordIds.slice(0, tailSize), completed: 0 });
};

const tailCardById = (wordId: number): WordCard | null => {
  const row = firstRow(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count,
           p.forgot_count, p.mistake_streak,
           p.fsrs_stability, p.fsrs_difficulty, p.fsrs_due, p.fsrs_last_review,
           p.fsrs_state, p.fsrs_steps, p.fsrs_reps, p.fsrs_lapses,
           COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `, [wordId]);
  return row ? rowObjectToCard(row) : null;
};

/** 把压轴卡声明为当前正向卡，复用既有的防重复提交锁。 */
const prepareTailCard = (wordId: number) => {
  setState("phase_date", today());
  setState("phase", "stage1");
  setState("current_card", String(wordId));
};

export const getDailyTailNext = (): WordCard | null => {
  const state = ensureDailyTail();
  const frontPlan = stage1ProgressCounts();
  if (frontPlan.total <= 0 || frontPlan.completed < frontPlan.total) return null;
  const wordId = state.wordIds[state.completed];
  if (wordId == null) return null;
  const card = tailCardById(wordId);
  if (card) prepareTailCard(wordId);
  return card;
};

export const getDailyTailProgress = (): { total: number; completed: number; pending: number } => {
  const state = readTail();
  return {
    total: state.wordIds.length,
    completed: state.completed,
    pending: Math.max(state.wordIds.length - state.completed, 0)
  };
};

/**
 * 答完一张压轴卡。
 *
 * `requeue`（答了忘记/模糊）时把这张卡再排一份到队尾 —— 压轴卡走的是正式 FSRS，
 * 答错的那一下已经写进库里了，界面上却让这个词当场消失、直接进完成页，
 * 等于「说好再确认一次，结果没确认」。重来最多两次（MAX_TAIL_APPEARANCES）。
 */
export const advanceDailyTail = (options: { requeue?: boolean } = {}): DailyTailState => {
  const state = readTail();
  if (state.completed >= state.wordIds.length) return state;
  const wordId = state.wordIds[state.completed];
  const appearances = state.wordIds.filter((id) => id === wordId).length;
  const wordIds = options.requeue && appearances < MAX_TAIL_APPEARANCES
    ? [...state.wordIds, wordId]
    : state.wordIds;
  return writeTail({ ...state, wordIds, completed: state.completed + 1 });
};

/**
 * 「上一个」把压轴队列退回一格。撤销本身由 undoLastWordAnswer 负责（FSRS、流水、
 * 那张卡都回到作答前），这里只负责让压轴的进度别多走一格 —— 否则撤销之后
 * 下一张会跳过一个词，压轴就少一张。
 */
export const rewindDailyTail = (wordId: number): DailyTailState => {
  const state = readTail();
  if (state.completed <= 0) return state;
  const wordIds = [...state.wordIds];
  // 刚才那一下是「答错重排」的话，队尾那份是它排进去的，要一起撤掉。
  if (wordIds[wordIds.length - 1] === wordId && wordIds.filter((id) => id === wordId).length > 1) {
    wordIds.pop();
  }
  return writeTail({ ...state, wordIds, completed: state.completed - 1 });
};
