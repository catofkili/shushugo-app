/**
 * 「流水是事实、memory 是检查点、tasks 是当天投影」这一套的公共部分。
 * 单独汉字卡（kanji-char-cards）和疑难连线卡（confusion-cards）都长这样，只有
 * 「候选从哪来、新学怎么排」不一样，所以那两样由调用方传进来，其余在这里一份。
 *
 * 和 kanji-unit-scheduler.ts 是同一个模式（那份先写、在旗子后面，没动它）。
 */
import type { WordAnswer } from "../types/vocabulary";
import { getDatabase } from "./database";
import { firstValue, rowsFor, studyDayEnd, today } from "./study-core";
import { ensureFsrsColumns, recordFsrsReview, type FsrsEntity } from "./fsrs-store";
import { STUBBORN_DAILY_MISTAKES } from "./fsrs-scheduler";
import { FSRS_PARAMS_VERSION } from "./reviews";

export type StepMode = "normal" | "stubborn" | "known";

export interface CardLogConfig {
  entity: FsrsEntity;
  reviewsTable: string;
  tasksTable: string;
  /** 除 known_forever 之外还要排掉的（比如「已掌握」的辨析组），写成 SQL 片段 */
  extraExclude?: string | (() => string);
}

export const createCardLog = (config: CardLogConfig) => {
  const { entity, reviewsTable, tasksTable } = config;
  const id = entity.idColumn;
  const memory = entity.table;
  const exclude = () => {
    const extra = typeof config.extraExclude === "function" ? config.extraExclude() : config.extraExclude;
    return `known_forever = 0${extra ? ` AND ${extra}` : ""}`;
  };

  const ensure = () => ensureFsrsColumns(entity);

  const priorEntity = memory === "kanji_char_memory" ? "kanji"
    : memory === "confusion_progress" ? "confusion"
      : "";

  /** 流水从用户自报水平形成的起点重放；没有起点才回到全新卡。 */
  const resetToStartingPoint = (key: string) => {
    const hasBaselines = priorEntity && firstValue<number>(
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'level_prior_baselines'", [], 0
    ) > 0;
    const baseline = hasBaselines ? rowsFor(`
      SELECT stability, difficulty, due, last_review, state, steps, reps, lapses
      FROM level_prior_baselines WHERE entity = ? AND entity_key = ?
    `, [priorEntity, key])[0] : undefined;
    if (baseline) {
      getDatabase().run(`
        UPDATE ${memory}
        SET seen_count = 1, right_count = 0, fuzzy_count = 0, forgot_count = 0, mistake_streak = 0, known_forever = 0, last_seen_on = NULL,
            fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?,
            fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ?
        WHERE ${id} = ?
      `, [baseline.stability, baseline.difficulty, baseline.due, baseline.last_review, baseline.state, baseline.steps, baseline.reps, baseline.lapses, key]);
      return;
    }
    getDatabase().run(`
      UPDATE ${memory}
      SET seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0, mistake_streak = 0, known_forever = 0, last_seen_on = NULL,
          fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_due = NULL, fsrs_last_review = NULL,
          fsrs_state = NULL, fsrs_steps = NULL, fsrs_reps = NULL, fsrs_lapses = NULL
      WHERE ${id} = ?
    `, [key]);
  };

  const updateCounters = (key: string, answer: WordAnswer, seenOn: string) => {
    const counts = answer === "forgot" ? [1, 0, 0, 1] : answer === "fuzzy" ? [1, 0, 1, 0] : [1, 1, 0, 0];
    const previousStreak = firstValue<number>(`SELECT mistake_streak FROM ${memory} WHERE ${id} = ?`, [key], 0);
    getDatabase().run(`
      UPDATE ${memory}
      SET seen_count = seen_count + ?, right_count = right_count + ?, fuzzy_count = fuzzy_count + ?, forgot_count = forgot_count + ?,
          mistake_streak = ?, last_seen_on = ?
      WHERE ${id} = ?
    `, [...counts, answer === "forgot" ? previousStreak + 1 : 0, seenOn, key]);
  };

  /** 同词级路径：第一次见就答对 → known；今天错够次数 → stubborn；其余 normal。全从流水现算，重放能原样重建。 */
  const stepMode = (key: string, answer: WordAnswer, day = today()): StepMode => {
    const answeredToday = firstValue<number>(`SELECT COUNT(*) FROM ${reviewsTable} WHERE ${id} = ? AND reviewed_on = ?`, [key, day], 0);
    if (answeredToday === 0 && (answer === "know" || answer === "known_forever")) return "known";
    const wrongToday = firstValue<number>(
      `SELECT COUNT(*) FROM ${reviewsTable} WHERE ${id} = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')`, [key, day], 0
    ) + (answer === "forgot" || answer === "fuzzy" ? 1 : 0);
    return wrongToday >= STUBBORN_DAILY_MISTAKES ? "stubborn" : "normal";
  };

  const record = (key: string, answer: WordAnswer, now = new Date(), mode?: StepMode) => {
    ensure();
    if (!firstValue<number>(`SELECT COUNT(*) FROM ${memory} WHERE ${id} = ?`, [key], 0)) throw new Error(`Unknown ${memory} row: ${key}`);
    mode ??= stepMode(key, answer);
    const fsrsAnswer: WordAnswer = answer === "known_forever" ? "know" : answer;
    const next = recordFsrsReview(key, fsrsAnswer, now, { mode }, entity);
    const seenOn = today();
    updateCounters(key, fsrsAnswer, seenOn);
    if (answer === "known_forever") getDatabase().run(`UPDATE ${memory} SET known_forever = 1 WHERE ${id} = ?`, [key]);
    getDatabase().run(`
      INSERT INTO ${reviewsTable} (${id}, answer, reviewed_on, reviewed_at, scheduler_mode, fsrs_params_version)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [key, answer, seenOn, now.getTime(), mode, FSRS_PARAMS_VERSION]);
    return next;
  };

  /** 合并之后从流水重建检查点。流水里有、本机没物化的行先补一行（对端先学到的）。 */
  const replay = (onlyKeys?: Iterable<string>, insertMissing: (key: string) => void = (key) => {
    getDatabase().run(`INSERT OR IGNORE INTO ${memory} (${id}) VALUES (?)`, [key]);
  }): number => {
    ensure();
    const keys = onlyKeys ? [...new Set([...onlyKeys])] : rowsFor(`SELECT DISTINCT ${id} FROM ${reviewsTable}`).map((row) => String(row[id]));
    const db = getDatabase();
    let replayed = 0;
    for (const key of keys) {
      const events = rowsFor(`SELECT answer, reviewed_on, reviewed_at, scheduler_mode FROM ${reviewsTable} WHERE ${id} = ? ORDER BY reviewed_at ASC, id ASC`, [key]);
      if (!events.length) continue;
      insertMissing(key);
      resetToStartingPoint(key);
      for (const event of events) {
        const answer = String(event.answer) as WordAnswer;
        if (!["forgot", "fuzzy", "know", "known_forever"].includes(answer)) continue;
        const at = Number(event.reviewed_at);
        const when = Number.isFinite(at) ? new Date(at) : new Date(`${String(event.reviewed_on)}T12:00:00`);
        const fsrsAnswer: WordAnswer = answer === "known_forever" ? "know" : answer;
        recordFsrsReview(key, fsrsAnswer, when, { mode: String(event.scheduler_mode ?? "normal") as StepMode }, entity);
        updateCounters(key, fsrsAnswer, String(event.reviewed_on ?? today()));
        if (answer === "known_forever") db.run(`UPDATE ${memory} SET known_forever = 1 WHERE ${id} = ?`, [key]);
      }
      replayed += 1;
    }
    return replayed;
  };

  /**
   * 当天清单：到期的（复习额度内，装不下随机抽）+ 调用方给的新学序列（额度内）。
   * 同一天重复调用不重排。
   */
  const createTasks = (quota: { fresh: number; review: number }, freshCandidates: () => string[], day = today()) => {
    ensure();
    const db = getDatabase();
    if (firstValue<number>(`SELECT COUNT(*) FROM ${tasksTable} WHERE reviewed_on = ?`, [day], 0) > 0) {
      const count = (cond: string) => firstValue<number>(
        `SELECT COUNT(*) FROM ${tasksTable} t JOIN ${memory} m ON m.${id} = t.${id} WHERE t.reviewed_on = ? AND ${cond}`, [day], 0
      );
      return { review: count("m.seen_count > 0"), fresh: count("m.seen_count = 0") };
    }
    const dayEnd = studyDayEnd().toISOString();
    const due = rowsFor(`
      SELECT ${id} FROM ${memory}
      WHERE ${exclude()} AND seen_count > 0 AND fsrs_due IS NOT NULL AND fsrs_due <= ?
      ORDER BY RANDOM() LIMIT ?
    `, [dayEnd, Math.max(0, quota.review)]).map((row) => String(row[id]));
    const fresh = freshCandidates().slice(0, Math.max(0, quota.fresh));
    db.run("BEGIN");
    try {
      [...due, ...fresh].forEach((key, index) => {
        db.run(`INSERT OR IGNORE INTO ${tasksTable} (reviewed_on, ${id}, order_index) VALUES (?, ?, ?)`, [day, key, index]);
      });
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    return { review: due.length, fresh: fresh.length };
  };

  /** 改了额度之后重排今天的清单：清单只是投影，删掉重建不丢任何作答（已答的卡由 FSRS 状态说话）。 */
  const clearTasks = (day = today()) => {
    ensure();
    getDatabase().run(`DELETE FROM ${tasksTable} WHERE reviewed_on = ?`, [day]);
  };

  /** 当天还没毕业的下一张。Learning / Relearning 一律不算毕业（同 isGraduatedForDay）。 */
  const pickNext = (day = today(), excluded = new Set<string>()): string | null => {
    ensure();
    const dayEnd = studyDayEnd().toISOString();
    const rows = rowsFor(`
      SELECT t.${id} AS k, m.fsrs_due, m.fsrs_state
      FROM ${tasksTable} t JOIN ${memory} m ON m.${id} = t.${id}
      WHERE t.reviewed_on = ? AND m.known_forever = 0
      ORDER BY t.order_index
    `, [day]);
    for (const row of rows) {
      const key = String(row.k);
      if (excluded.has(key)) continue;
      const learning = row.fsrs_state != null && Number(row.fsrs_state) !== 2;
      const graduated = !learning && row.fsrs_due != null && String(row.fsrs_due) > dayEnd;
      if (!graduated) return key;
    }
    return null;
  };

  const progress = (day = today()) => {
    ensure();
    const dayEnd = studyDayEnd().toISOString();
    const total = firstValue<number>(`SELECT COUNT(*) FROM ${tasksTable} WHERE reviewed_on = ?`, [day], 0);
    const done = firstValue<number>(`
      SELECT COUNT(*) FROM ${tasksTable} t JOIN ${memory} m ON m.${id} = t.${id}
      WHERE t.reviewed_on = ? AND (m.known_forever = 1 OR (m.fsrs_state = 2 AND m.fsrs_due > ?))
    `, [day, dayEnd], 0);
    return { total, done, remaining: Math.max(0, total - done) };
  };

  /**
   * 撤销最后一次作答：删最后一行流水，按剩下的流水把这张卡重放一遍。
   * 精确回到上一状态，不需要另存「上一次的快照」。返回被撤的 key，没有可撤的返回 null。
   */
  const undoLast = (day = today()): string | null => {
    ensure();
    const last = rowsFor(`SELECT id, ${id} AS k FROM ${reviewsTable} WHERE reviewed_on = ? ORDER BY reviewed_at DESC, id DESC LIMIT 1`, [day])[0];
    if (!last) return null;
    const key = String(last.k);
    getDatabase().run(`DELETE FROM ${reviewsTable} WHERE id = ?`, [last.id as number]);
    if (!replay([key])) resetToStartingPoint(key);
    return key;
  };

  /** 到期数（给圆环做池子和「复习建议下限」）。 */
  const dueCount = () => {
    ensure();
    return firstValue<number>(`SELECT COUNT(*) FROM ${memory} WHERE ${exclude()} AND seen_count > 0 AND fsrs_due <= ?`, [studyDayEnd().toISOString()], 0);
  };

  return { ensure, stepMode, record, replay, undoLast, createTasks, clearTasks, pickNext, progress, dueCount, get exclude() { return exclude(); } };
};
