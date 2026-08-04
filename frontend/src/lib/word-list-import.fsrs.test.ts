/**
 * 外部词单导入 → FSRS：导入的熟悉度必须落成真实的 FSRS 状态，
 * 并且未激活的导入词不得进入当日到期池。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb,
  exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, persistSoon: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

import { importExternalWordList } from "./word-list-import";
import { fsrsDueWordIds, readFsrsState } from "./fsrs-store";

const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));

const wordIdOf = (kanji: string) => Number(
  testDb.exec("SELECT id FROM words WHERE kanji = ? LIMIT 1", [kanji])[0]?.values[0]?.[0]
);

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
});

const importJson = (rows: unknown[]) => importExternalWordList(JSON.stringify(rows));

describe("外部词单导入的记忆迁移", () => {
  it("熟悉度换算成 FSRS 状态，而不是留一个空的 fsrs_due", () => {
    importJson([
      { spell: "確認", pron: "かくにん", briefInfo: "确认", score: 9, qCnt: 6, qWrCnt: 0, lastSeen: "2026-07-20" },
      { spell: "負ける", pron: "まける", briefInfo: "输", score: -10, qCnt: 5, qWrCnt: 4, lastSeen: "2026-07-20" }
    ]);

    const known = readFsrsState(wordIdOf("確認"));
    const weak = readFsrsState(wordIdOf("負ける"));
    expect(known).not.toBeNull();
    expect(weak).not.toBeNull();
    // 熟的那个间隔应当明显比不熟的长
    expect(known!.stability).toBeGreaterThan(weak!.stability);
  });

  it("未激活的导入词不进入 FSRS 到期池", () => {
    importJson([
      { spell: "確認", pron: "かくにん", briefInfo: "确认", score: -10, qCnt: 5, qWrCnt: 4, lastSeen: "2026-07-20" }
    ]);
    const wordId = wordIdOf("確認");
    expect(
      testDb.exec("SELECT activated_on FROM moji_migrated_reviews WHERE word_id = ?", [wordId])[0]?.values[0]?.[0]
    ).toBeNull();

    // 分数很低、时间也早就过了，如果没有激活闸门它一定会出现在到期集合里
    expect(fsrsDueWordIds(500)).not.toContain(wordId);

    testDb.run("UPDATE moji_migrated_reviews SET activated_on = '2026-08-04' WHERE word_id = ?", [wordId]);
    expect(fsrsDueWordIds(500)).toContain(wordId);
  });

  it("已经有 FSRS 记忆的词不被外部快照覆盖", () => {
    importJson([{ spell: "確認", pron: "かくにん", briefInfo: "确认", score: 9, qCnt: 6, qWrCnt: 0, lastSeen: "2026-07-20" }]);
    const wordId = wordIdOf("確認");
    const before = readFsrsState(wordId);

    importJson([{ spell: "確認", pron: "かくにん", briefInfo: "确认", score: -20, qCnt: 9, qWrCnt: 9, lastSeen: "2026-07-25" }]);
    expect(readFsrsState(wordId)).toEqual(before);
  });
});
