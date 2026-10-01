import type { WordAnswer } from "../../types/vocabulary";
import { createCardLog } from "../card-log";
import { getDatabase } from "../database";
import { oncePerDatabase, persistSoon } from "../database/db-utils";
import { firstValue, rowsFor, studyDayEnd, today } from "../study-core";
import { withoutSyncStamp } from "../sync/schema";
import { allCardKeys, newCardOrder } from "./cards";
import { talkContent, talkContentLoaded } from "./content";

export const TALK_NEW_PER_DAY = 5;

const log = createCardLog({
  entity: { table: "talk_memory", idColumn: "card_key", eligible: "known_forever = 0" },
  reviewsTable: "talk_reviews",
  tasksTable: "talk_tasks",
  dayEnd: (day) => studyDayEnd(new Date(`${day}T12:00:00`))
});

// 三张表只由 local-schema.sql 在启动时建（那之后 ensureSyncSchema 才给它们挂同步列和触发器）。
// ⚠️ 这里别再写 CREATE TABLE：懒建出来的同步表没有同步列，下一次启动同步层回填会撞上它、整个 App 打不开
// （2026-09-30 预览里实测过，根因和另一半修法见 local-delta.ts 的 SCHEMA_FINGERPRINT_FILTER）。
export const ensureTalkTables = (): void => {
  oncePerDatabase("talk-tables", () => log.ensure());
};

export const materializeTalkCards = (): number => {
  if (!talkContentLoaded()) throw new Error("开口练习内容尚未加载");
  ensureTalkTables();
  const db = getDatabase();
  const existing = new Set(rowsFor("SELECT card_key FROM talk_memory").map((row) => String(row.card_key)));
  const missing = allCardKeys().filter((key) => !existing.has(key));
  // memory 是 LWW 检查点：空占位的「现在」不能赢过真实学习记录，必须留空同步时间戳。
  withoutSyncStamp(() => {
    db.run("SAVEPOINT materialize_talk");
    try {
      for (const key of missing) db.run("INSERT OR IGNORE INTO talk_memory (card_key) VALUES (?)", [key]);
      db.run("RELEASE materialize_talk");
    } catch (error) {
      db.run("ROLLBACK TO materialize_talk");
      db.run("RELEASE materialize_talk");
      throw error;
    }
  });
  return missing.length;
};

export const createTalkTasks = (day = today()) => {
  materializeTalkCards();
  return log.createTasks({ fresh: TALK_NEW_PER_DAY, review: Number.MAX_SAFE_INTEGER }, () => {
    const unseen = new Set(rowsFor(`SELECT card_key FROM talk_memory WHERE ${log.exclude} AND seen_count = 0`).map((row) => String(row.card_key)));
    return newCardOrder().filter((key) => unseen.has(key));
  }, day);
};

// 加餐可以包含尚未到期的旧卡：必须今天答过、且已毕业，才能计为完成。
// 不改共享 card-log 的毕业判据，也不为加餐另建表或改 FSRS 到期日。
const talkTaskStates = (day: string) => {
  ensureTalkTables();
  const end = studyDayEnd(new Date(`${day}T12:00:00`)).toISOString();
  return rowsFor(`SELECT t.card_key, m.known_forever, m.fsrs_state, m.fsrs_due,
    EXISTS(SELECT 1 FROM talk_reviews r WHERE r.card_key = t.card_key AND r.reviewed_on = t.reviewed_on) AS answered
    FROM talk_tasks t JOIN talk_memory m ON m.card_key = t.card_key
    WHERE t.reviewed_on = ? ORDER BY t.order_index`, [day]).map((row) => ({
    key: String(row.card_key),
    done: Number(row.known_forever) === 1 || (Number(row.answered) === 1 && Number(row.fsrs_state) === 2 && row.fsrs_due != null && String(row.fsrs_due) > end)
  }));
};

export const pickTalkNext = (day = today(), excluded = new Set<string>()): string | null =>
  talkTaskStates(day).find((task) => !task.done && !excluded.has(task.key))?.key ?? null;

export const talkProgress = (day = today()) => {
  const tasks = talkTaskStates(day);
  const done = tasks.filter((task) => task.done).length;
  return { total: tasks.length, done, remaining: tasks.length - done };
};

export const canUndoTalk = (day = today()): boolean => {
  ensureTalkTables();
  return firstValue<number>("SELECT EXISTS(SELECT 1 FROM talk_reviews WHERE reviewed_on = ?)", [day], 0) === 1;
};

export const talkSceneCollection = () => {
  ensureTalkTables();
  const seenKeys = new Set(rowsFor("SELECT card_key FROM talk_memory WHERE seen_count > 0").map((row) => String(row.card_key)));
  return (talkContent()?.scenes ?? []).map((scene) => {
    const keys = scene.lines.flatMap((line, index) => line.self ? [`r:${scene.id}:${index}`] : []);
    const seen = keys.filter((key) => seenKeys.has(key)).length;
    return { id: scene.id, title: scene.title, image: `/talk/scenes/${scene.id}.jpg`, collected: keys.length > 0 && seen === keys.length, seen, total: keys.length };
  });
};

const extraCandidates = (day: string): string[] => {
  materializeTalkCards();
  const available = rowsFor(`SELECT m.card_key, m.seen_count FROM talk_memory m WHERE ${log.exclude}
    AND NOT EXISTS(SELECT 1 FROM talk_tasks t WHERE t.reviewed_on = ? AND t.card_key = m.card_key)
    ORDER BY m.fsrs_due, m.card_key`, [day]);
  const unseen = new Set(available.filter((row) => Number(row.seen_count) === 0).map((row) => String(row.card_key)));
  const valid = new Set(allCardKeys());
  return [...newCardOrder().filter((key) => unseen.has(key)),
    ...available.filter((row) => Number(row.seen_count) > 0 && valid.has(String(row.card_key))).map((row) => String(row.card_key))];
};

export const canExtendTalkTasks = (day = today()): boolean => extraCandidates(day).length > 0;

export const extendTalkTasks = (day = today(), count = 5): number => {
  const keys = extraCandidates(day).slice(0, Math.max(0, Math.floor(count)));
  if (!keys.length) return 0;
  withTalkWrite(() => {
    const offset = firstValue<number>("SELECT COALESCE(MAX(order_index), -1) + 1 FROM talk_tasks WHERE reviewed_on = ?", [day], 0);
    keys.forEach((key, index) => getDatabase().run(
      "INSERT INTO talk_tasks (reviewed_on, card_key, order_index) VALUES (?, ?, ?)", [day, key, offset + index]
    ));
  });
  persistSoon();
  return keys.length;
};

export const answerForHints = (hintsUsed: number, gaveUp: boolean): WordAnswer =>
  gaveUp || hintsUsed >= 2 ? "forgot" : hintsUsed === 1 ? "fuzzy" : "know";

/** 流水和检查点一起成功或一起回滚，不能留下没有流水可重建的 FSRS 状态。 */
const withTalkWrite = <T>(write: () => T): T => {
  ensureTalkTables();
  const db = getDatabase();
  db.run("SAVEPOINT talk_write");
  try {
    const result = write();
    db.run("RELEASE talk_write");
    return result;
  } catch (error) {
    db.run("ROLLBACK TO talk_write");
    db.run("RELEASE talk_write");
    throw error;
  }
};

// 记账和撤销之后排一次落盘（增量里带着 talk_*，见 sync/tables.ts 的 cloud: false）。
export const recordTalkAnswer = (key: string, hintsUsed: number, gaveUp: boolean, filler?: string) => {
  const next = withTalkWrite(() => log.record(key, answerForHints(hintsUsed, gaveUp), new Date(), undefined, { hints: hintsUsed, filler: filler ?? null }));
  persistSoon();
  return next;
};

export const undoLastTalkAnswer = (day = today()) => {
  const key = withTalkWrite(() => log.undoLast(day));
  if (key) persistSoon();
  return key;
};

export const replayTalkReviews = (onlyKeys?: Iterable<string>) => withTalkWrite(() => log.replay(onlyKeys, (key) => {
  withoutSyncStamp(() => getDatabase().run("INSERT OR IGNORE INTO talk_memory (card_key) VALUES (?)", [key]));
}));
