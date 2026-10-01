import type { WordAnswer } from "../../types/vocabulary";
import { createCardLog } from "../card-log";
import { getDatabase } from "../database";
import { oncePerDatabase, persistSoon } from "../database/db-utils";
import { rowsFor, studyDayEnd, today } from "../study-core";
import { withoutSyncStamp } from "../sync/schema";
import { allCardKeys, newCardOrder } from "./cards";
import { talkContentLoaded } from "./content";

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

export const pickTalkNext = (day = today(), excluded = new Set<string>()) => {
  ensureTalkTables();
  return log.pickNext(day, excluded);
};

export const talkProgress = (day = today()) => { ensureTalkTables(); return log.progress(day); };

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

export const undoLastTalkAnswer = () => {
  const key = withTalkWrite(() => log.undoLast());
  if (key) persistSoon();
  return key;
};

export const replayTalkReviews = (onlyKeys?: Iterable<string>) => withTalkWrite(() => log.replay(onlyKeys, (key) => {
  withoutSyncStamp(() => getDatabase().run("INSERT OR IGNORE INTO talk_memory (card_key) VALUES (?)", [key]));
}));
