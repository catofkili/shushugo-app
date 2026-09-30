import type { WordAnswer } from "../../types/vocabulary";
import { createCardLog } from "../card-log";
import { getDatabase } from "../database";
import { oncePerDatabase } from "../database/db-utils";
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

export const ensureTalkTables = (): void => {
  oncePerDatabase("talk-tables", () => {
    const db = getDatabase();
    db.run(`
      CREATE TABLE IF NOT EXISTS talk_memory (
        card_key TEXT PRIMARY KEY,
        seen_count INTEGER NOT NULL DEFAULT 0,
        right_count INTEGER NOT NULL DEFAULT 0,
        fuzzy_count INTEGER NOT NULL DEFAULT 0,
        forgot_count INTEGER NOT NULL DEFAULT 0,
        mistake_streak INTEGER NOT NULL DEFAULT 0,
        known_forever INTEGER NOT NULL DEFAULT 0,
        last_seen_on TEXT
      );
      CREATE TABLE IF NOT EXISTS talk_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_key TEXT NOT NULL,
        answer TEXT NOT NULL,
        reviewed_on TEXT NOT NULL,
        reviewed_at INTEGER NOT NULL,
        hints INTEGER NOT NULL DEFAULT 0,
        filler TEXT,
        scheduler_mode TEXT NOT NULL DEFAULT 'normal',
        fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_talk_reviews_card_on ON talk_reviews (card_key, reviewed_on);
      CREATE TABLE IF NOT EXISTS talk_tasks (
        reviewed_on TEXT NOT NULL,
        card_key TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        PRIMARY KEY (reviewed_on, card_key)
      )
    `);
    log.ensure();
    // 启动必须先跑 local-schema 再初始化同步（同另两种卡），这里不能重跑全库同步初始化。
    // origin 回填会给既有空占位盖「现在」章，破坏占位行不参与 LWW 的约定。
  });
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

export const recordTalkAnswer = (key: string, hintsUsed: number, gaveUp: boolean, filler?: string) =>
  withTalkWrite(() => log.record(key, answerForHints(hintsUsed, gaveUp), new Date(), undefined, { hints: hintsUsed, filler: filler ?? null }));

export const undoLastTalkAnswer = () => withTalkWrite(() => log.undoLast());

export const replayTalkReviews = (onlyKeys?: Iterable<string>) => withTalkWrite(() => log.replay(onlyKeys, (key) => {
  withoutSyncStamp(() => getDatabase().run("INSERT OR IGNORE INTO talk_memory (card_key) VALUES (?)", [key]));
}));
