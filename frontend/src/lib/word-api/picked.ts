import type { WordCard } from "../../types/vocabulary";
import { rowObjectToCard } from "../models/word-card";
import { allowsBackToBack } from "../scheduler/requeue";
import { getState, persistSoon, setState, studyDayEnd, today, rowsFor, type DbRow } from "../study-core";
import { lastAnsweredWord } from "./session-state";

/**
 * 自选清单：用户在词库里勾出来的一批词，单独开一场只含这些词的学习。
 *
 * 和错题本一样，**只换选词通道**：不碰今日计划、不进 stage1_tasks、不参与排片。
 * 评分照样走正式的 FSRS —— 提前复习本来就是正常操作（FSRS 按实际间隔算），
 * 危险的只有「看完答案再评分」，那是词库页坚决不给评分按钮的原因。
 *
 * 出题范围刻意**不看到期**：考前想突击这 30 个词，就是要把还没到期的也过一遍。
 * 但今天已经答过并且已经排到明天以后的词会退出本轮（和错题本同一条判据），
 * 否则同一个词会在一场里被问到第二遍，那才是在给 FSRS 灌假数据。
 */

const KEY = "picked_word_ids";
/** 一次最多带这么多词进一场，和词库页的全选上限同一个数 */
const MAX_PICKED = 300;

export const setPickedWords = (wordIds: number[]): number[] => {
  const ids = Array.from(new Set(
    wordIds.map((id) => Math.round(Number(id))).filter((id) => Number.isFinite(id) && id > 0)
  )).slice(0, MAX_PICKED);
  setState(KEY, JSON.stringify(ids));
  persistSoon();
  return ids;
};

export const pickedWordIds = (): number[] => {
  try {
    const parsed = JSON.parse(getState(KEY, "[]")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  } catch {
    return [];
  }
};

export const clearPickedWords = () => {
  setState(KEY, "[]");
  persistSoon();
};

const pickedRows = (): DbRow[] => {
  const ids = pickedWordIds();
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return rowsFor(`
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
      p.fsrs_state,
      p.fsrs_reps,
      p.fsrs_lapses,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id IN (${placeholders})
      AND p.known_forever = 0
      AND (
        p.last_seen_on IS NULL
        OR p.last_seen_on <> ?
        OR p.fsrs_due IS NULL
        OR p.fsrs_due <= ?
      )
    ORDER BY
      CASE WHEN p.last_seen_on IS NULL OR p.last_seen_on <> ? THEN 0 ELSE 1 END ASC,
      CASE WHEN p.fsrs_due IS NULL THEN 0 ELSE 1 END ASC,
      p.fsrs_due ASC,
      w.importance DESC,
      w.id ASC
  `, [...ids, today(), studyDayEnd().toISOString(), today()]);
};

/** 这一轮还剩几个 / 一共几个，给学习页顶上的进度条 */
export const pickedProgress = (): { total: number; remaining: number } => {
  const total = pickedWordIds().length;
  return { total, remaining: Math.min(pickedRows().length, total) };
};

export const pickPickedNext = (): WordCard | null => {
  const rows = pickedRows();
  if (!rows.length) return null;

  // 刚答过的那张不连着出（顽固词连错、池子只剩它时例外），和其它通道同一条闸门
  const lastId = lastAnsweredWord();
  const lastRow = rows.find((row) => Number(row.id) === lastId);
  const repeatAllowed = allowsBackToBack({
    mistakeStreak: Number(lastRow?.mistake_streak ?? 0),
    remaining: rows.length,
    total: pickedWordIds().length
  });
  const pickable = rows.length > 1 && !repeatAllowed
    ? rows.filter((row) => Number(row.id) !== lastId)
    : rows;
  return rowObjectToCard(pickable[0] ?? rows[0]);
};
