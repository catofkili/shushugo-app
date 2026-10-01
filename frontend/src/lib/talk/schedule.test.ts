import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
vi.mock("../database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  createDatabase: async () => new SQL.Database(),
  exportDatabase: () => testDb.export()
}));
vi.mock("../storage", () => ({
  scheduleSave: () => undefined,
  requestFullSnapshot: () => undefined
}));

import { setTalkContentForTest, type TalkContent } from "./content";
import { allCardKeys } from "./cards";
import {
  answerForHints, canUndoTalk, talkSceneSets, talkDueKeys, talkEverAnswered,
  ensureTalkTables, materializeTalkCards, recordTalkAnswer, replayTalkReviews, undoLastTalkAnswer
} from "./schedule";
import { rowsFor, studyDayEnd, today, type DbRow } from "../study-core";
import { ensureSyncSchema } from "../sync/schema";
import { SYNCED_TABLES, syncedTablesForCloud } from "../sync/tables";
import { exportSyncSnapshot } from "../sync/snapshot";
import { applyDelta, collectDelta, currentMark } from "../local-delta";

const content: TalkContent = {
  version: "schedule-fixture",
  formulas: ["F99", "F03", "F02", "F04", "F01", "F00"].map((id) => ({
    id,
    intent: "请对方给我某物",
    pattern: "[物]をお願いします。",
    skeleton: "[物]を ……",
    prompt: "请给我：{物}",
    note: "礼貌请求",
    fillers: [{ 物: { ja: "お水", zh: "水" } }]
  })),
  scenes: [
    {
      id: "S02", title: "便利店",
      lines: [
        { speaker: "店员", self: false, ja: "温めますか。", zh: "需要加热吗？", formulas: [] },
        { speaker: "顾客", self: true, ja: "はい、お願いします。", zh: "好的，麻烦您。", formulas: ["F02", "F01"] },
        { speaker: "顾客", self: true, ja: "ありがとうございます。", zh: "谢谢。", formulas: [] }
      ]
    },
    {
      id: "S01", title: "餐厅",
      lines: [
        { speaker: "顾客", self: true, ja: "すみません。", zh: "不好意思。", formulas: ["F01", "F03"] },
        { speaker: "店员", self: false, ja: "はい。", zh: "您好。", formulas: [] },
        { speaker: "顾客", self: true, ja: "お水をお願いします。", zh: "请给我水。", formulas: ["F04"] }
      ]
    }
  ]
};
const expectedOrder = ["f:F99", "f:F03", "f:F02", "f:F04", "f:F01", "f:F00", "r:S02:1", "r:S02:2", "r:S01:0", "r:S01:2"];
const seedPath = fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url));
const localSchemaPath = fileURLToPath(new URL("../database/local-schema.sql", import.meta.url));

const rows = (db: Database, sql: string): DbRow[] => {
  const result = db.exec(sql)[0];
  return result ? result.values.map((values) => Object.fromEntries(
    result.columns.map((column, index) => [column, values[index]])
  ) as DbRow) : [];
};
// 重放会给 memory 盖新的本地同步章；业务状态必须相等，剩余流水连同步身份也不能改。
const memory = () => rowsFor("SELECT * FROM talk_memory ORDER BY card_key").map((row) =>
  Object.fromEntries(Object.entries(row).filter(([column]) => !column.startsWith("sync_")))
);
const reviews = () => rowsFor("SELECT * FROM talk_reviews ORDER BY id");
const tasks = (day = today()) => rowsFor(
  "SELECT card_key FROM talk_tasks WHERE reviewed_on = ? ORDER BY order_index", [day]
).map((row) => String(row.card_key));
const advance = (minutes = 1) => vi.setSystemTime(new Date(Date.now() + minutes * 60_000));

beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00"));
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  testDb.run(readFileSync(localSchemaPath, "utf8"));
  ensureSyncSchema();
  setTalkContentForTest(content);
});
afterEach(() => {
  testDb.close();
  vi.useRealTimers();
});

describe("开口练习的卡片流水与场景", () => {
  it("空占位幂等且不盖同步章，作答后才进入本地增量", () => {
    expect(materializeTalkCards()).toBe(expectedOrder.length);
    const before = memory();
    expect(materializeTalkCards()).toBe(0);
    ensureTalkTables();
    expect(memory()).toEqual(before);
    expect(rowsFor("SELECT seen_count, sync_updated_at FROM talk_memory").every((row) =>
      row.seen_count === 0 && !row.sync_updated_at
    )).toBe(true);
    expect(collectDelta("2000-01-01T00:00:00.000Z").rows.talk_memory).toBeUndefined();
    recordTalkAnswer("f:F02", 0, false, "お水");
    const changed = collectDelta("2000-01-01T00:00:00.000Z").rows.talk_memory;
    expect(changed).toHaveLength(1);
    expect(changed[0].card_key).toBe("f:F02");
    expect(changed[0].sync_updated_at).toBeTruthy();
  });

  it("内容未加载时拒绝物化，加载后物化所有卡，不写任务表", () => {
    setTalkContentForTest(null);
    expect(() => materializeTalkCards()).toThrow("开口练习内容尚未加载");
    expect(tasks()).toEqual([]);
    setTalkContentForTest(content);
    expect(materializeTalkCards()).toBe(allCardKeys().length);
    expect(tasks()).toEqual([]);
  });

  it("到期卡按 fsrs_due 升序，使用指定学习日边界，排除新卡、已掌握和无效卡", () => {
    materializeTalkCards();
    testDb.run("UPDATE talk_memory SET seen_count = 1, fsrs_due = '2026-10-01T12:00:00.000Z' WHERE card_key = 'f:F02'");
    testDb.run("UPDATE talk_memory SET seen_count = 1, fsrs_due = '2000-01-01T00:00:00.000Z' WHERE card_key = 'f:F01'");
    testDb.run("UPDATE talk_memory SET fsrs_due = '1999-01-01T00:00:00.000Z' WHERE card_key = 'f:F03'");
    testDb.run("UPDATE talk_memory SET seen_count = 1, known_forever = 1, fsrs_due = '1999-01-01T00:00:00.000Z' WHERE card_key = 'f:F99'");
    testDb.run("INSERT INTO talk_memory (card_key, seen_count, fsrs_due) VALUES ('f:removed', 1, '1999-01-01T00:00:00.000Z')");
    const boundary = studyDayEnd(new Date("2026-10-01T12:00:00"));
    testDb.run("UPDATE talk_memory SET seen_count = 1, fsrs_due = ? WHERE card_key = 'f:F04'", [boundary.toISOString()]);
    testDb.run("UPDATE talk_memory SET seen_count = 1, fsrs_due = ? WHERE card_key = 'f:F00'", [new Date(boundary.getTime() + 1).toISOString()]);
    expect(talkDueKeys("2026-09-30")).toEqual(["f:F01"]);
    expect(talkDueKeys("2026-10-01")).toEqual(["f:F01", "f:F02", "f:F04"]);
    expect(tasks()).toEqual([]);
  });

  it("上一张只看指定学习日的流水，撤完即消失；昨天的作答不能撤", () => {
    materializeTalkCards();
    expect(canUndoTalk()).toBe(false);
    recordTalkAnswer("f:F02", 0, false);
    expect(canUndoTalk()).toBe(true);
    expect(canUndoTalk("2026-10-01")).toBe(false);
    expect(undoLastTalkAnswer("2026-10-01")).toBeNull();
    expect(undoLastTalkAnswer()).toBe("f:F02");
    expect(canUndoTalk()).toBe(false);
  });

  it("图鉴只数 self 接话卡，公式和对方不算；答错也算见过，撤销后现场重算", () => {
    materializeTalkCards();
    expect(talkEverAnswered()).toBe(false);
    recordTalkAnswer("f:F02", 0, false);
    expect(talkEverAnswered()).toBe(true);
    expect(talkSceneSets()[0]).toMatchObject({ id: "S02", seen: 0, total: 2, due: 0, collected: false });
    advance();
    recordTalkAnswer("r:S02:1", 2, false);
    expect(talkSceneSets()[0]).toMatchObject({ seen: 1, collected: false });
    advance();
    recordTalkAnswer("r:S02:2", 0, false);
    expect(talkSceneSets()[0]).toMatchObject({ title: "便利店", image: "/talk/scenes/S02.jpg", seen: 2, total: 2, collected: true });
    testDb.run("UPDATE talk_memory SET fsrs_due = '2099-01-01T00:00:00.000Z' WHERE card_key LIKE 'r:S02:%'");
    expect(talkSceneSets()[0]).toMatchObject({ seen: 2, due: 0, collected: true });
    expect(talkSceneSets()[1]).toMatchObject({ seen: 0, total: 2, collected: false });
    undoLastTalkAnswer();
    expect(talkSceneSets()[0]).toMatchObject({ seen: 1, collected: false });
    testDb.run("UPDATE talk_memory SET fsrs_due = '2000-01-01T00:00:00.000Z' WHERE card_key = 'r:S02:1'");
    expect(talkSceneSets()[0]).toMatchObject({ seen: 1, due: 1, collected: false });
  });

  it.each([
    [0, false, "know"], [1, false, "fuzzy"], [2, false, "forgot"],
    [3, false, "forgot"], [0, true, "forgot"]
  ] as const)("提示 %i 次、放弃 %s → %s，并在同一条流水记录提示和槽位", (hints, gaveUp, answer) => {
    expect(answerForHints(hints, gaveUp)).toBe(answer);
    materializeTalkCards();
    recordTalkAnswer("f:F02", hints, gaveUp, "お水/コーヒー");
    const events = reviews();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      card_key: "f:F02", answer, hints, filler: "お水/コーヒー", reviewed_on: today()
    });
    expect(events[0].sync_uid).toBeTruthy();
    expect(rowsFor("SELECT seen_count, right_count, fuzzy_count, forgot_count FROM talk_memory WHERE card_key = 'f:F02'"))
      .toEqual([{
        seen_count: 1, right_count: answer === "know" ? 1 : 0,
        fuzzy_count: answer === "fuzzy" ? 1 : 0, forgot_count: answer === "forgot" ? 1 : 0
      }]);
  });

  it("撤销重复作答后精确回到上一业务状态，剩余流水的提示、槽位和同步身份完整保留", () => {
    materializeTalkCards();
    recordTalkAnswer("f:F02", 2, false, "お水");
    advance();
    recordTalkAnswer("f:F01", 0, false);
    const beforeMemory = memory();
    const beforeReviews = reviews();
    advance();
    recordTalkAnswer("f:F02", 1, false, "コーヒー");
    expect(reviews()).toHaveLength(3);
    expect(undoLastTalkAnswer()).toBe("f:F02");
    expect(memory()).toEqual(beforeMemory);
    expect(reviews()).toEqual(beforeReviews);
    expect(beforeReviews[1].filler).toBeNull();
  });

  it("撤掉最后一条流水恢复全新卡，包括 FSRS；再撤返回 null", () => {
    materializeTalkCards();
    const beforeMemory = memory();
    recordTalkAnswer("f:F02", 0, false, "お水");
    expect(undoLastTalkAnswer()).toBe("f:F02");
    expect(memory()).toEqual(beforeMemory);
    expect(reviews()).toEqual([]);
    expect(undoLastTalkAnswer()).toBeNull();
  });

  it("流水插入失败时整次记账回滚，不能只留下变过的 memory", () => {
    materializeTalkCards();
    const beforeMemory = memory();
    const beforeReviews = reviews();
    testDb.run("CREATE TRIGGER reject_talk_review BEFORE INSERT ON talk_reviews BEGIN SELECT RAISE(ABORT, 'reject talk review'); END");
    expect(() => recordTalkAnswer("f:F02", 2, false, "お水")).toThrow("reject talk review");
    expect(memory()).toEqual(beforeMemory);
    expect(reviews()).toEqual(beforeReviews);
    testDb.run("DROP TRIGGER reject_talk_review");
    expect(() => recordTalkAnswer("f:F02", 0, false, "お水")).not.toThrow();
    expect(reviews()).toHaveLength(1);
  });

  it("按流水重建出的完整 memory 与逐条记账相同，重放不增改流水", () => {
    materializeTalkCards();
    recordTalkAnswer("f:F02", 2, false, "お水");
    advance();
    recordTalkAnswer("f:F01", 0, false);
    advance();
    recordTalkAnswer("f:F02", 1, false, "コーヒー");
    advance();
    recordTalkAnswer("f:F02", 0, false, "お茶");
    const beforeMemory = memory();
    const beforeReviews = reviews();
    testDb.run("UPDATE talk_memory SET seen_count = 99, right_count = 99, fuzzy_count = 99, forgot_count = 99, mistake_streak = 99, fsrs_due = NULL WHERE seen_count > 0");
    expect(replayTalkReviews()).toBe(2);
    expect(memory()).toEqual(beforeMemory);
    expect(reviews()).toEqual(beforeReviews);
    expect(replayTalkReviews(["f:F02", "f:F02"])).toBe(1);
    expect(memory()).toEqual(beforeMemory);
    expect(reviews()).toEqual(beforeReviews);
  });
});

describe("开口练习只在本机持久化", () => {
  it("三张表有本地追踪，云表清单和云快照都没有它们及它们的墓碑", async () => {
    expect(SYNCED_TABLES.filter((entry) => entry.table.startsWith("talk_"))).toHaveLength(3);
    expect(syncedTablesForCloud(true).filter((entry) => entry.table.startsWith("talk_"))).toEqual([]);
    expect(syncedTablesForCloud(false).filter((entry) => entry.table.startsWith("talk_"))).toEqual([]);
    materializeTalkCards();
    recordTalkAnswer("f:F02", 0, false, "お水");
    undoLastTalkAnswer();
    testDb.run("INSERT INTO talk_tasks (reviewed_on, card_key, order_index) VALUES ('2026-09-30', 'f:F01', 0)");
    testDb.run("DELETE FROM talk_tasks WHERE card_key = 'f:F01'");
    testDb.run("DELETE FROM talk_memory WHERE card_key = 'f:F01'");
    expect(new Set(rowsFor("SELECT table_name FROM sync_tombstones WHERE table_name LIKE 'talk_%'").map((row) => row.table_name)))
      .toEqual(new Set(["talk_memory", "talk_reviews", "talk_tasks"]));
    const snapshot = new SQL.Database(await exportSyncSnapshot());
    try {
      expect(rows(snapshot, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'talk_%'")).toEqual([]);
      expect(rows(snapshot, "SELECT table_name FROM sync_tombstones WHERE table_name LIKE 'talk_%'")).toEqual([]);
    } finally { snapshot.close(); }
  });

  it("本地增量只写 memory 和 reviews，快照加增量重启能原样恢复作答", () => {
    materializeTalkCards();
    const mark = currentMark();
    const checkpoint = testDb.export();
    materializeTalkCards();
    recordTalkAnswer("f:F02", 1, false, "お水");
    const expectedMemory = memory();
    const expectedReviews = reviews();
    const expectedTasks = tasks();
    const delta = collectDelta(mark);
    expect(delta.rows.talk_memory).toHaveLength(1);
    expect(delta.rows.talk_reviews).toHaveLength(1);
    expect(delta.rows.talk_tasks).toBeUndefined();
    const original = testDb;
    testDb = new SQL.Database(checkpoint);
    try {
      applyDelta(delta);
      expect(memory()).toEqual(expectedMemory);
      expect(reviews()).toEqual(expectedReviews);
      expect(tasks()).toEqual(expectedTasks);
    } finally { original.close(); }
  });

  it("撤销的墓碑也进入本地增量，重启不会让已撤作答复活", () => {
    materializeTalkCards();
    recordTalkAnswer("f:F02", 2, false, "お水");
    advance();
    recordTalkAnswer("f:F02", 0, false, "コーヒー");
    const deletedUid = reviews()[1].sync_uid;
    const mark = currentMark();
    const checkpoint = testDb.export();
    undoLastTalkAnswer();
    const expectedMemory = memory();
    const expectedReviews = reviews();
    const delta = collectDelta(mark);
    expect(delta.tombstones).toContainEqual(expect.objectContaining({
      table_name: "talk_reviews", row_key: deletedUid
    }));
    const original = testDb;
    testDb = new SQL.Database(checkpoint);
    try {
      applyDelta(delta);
      expect(memory()).toEqual(expectedMemory);
      expect(reviews()).toEqual(expectedReviews);
      expect(rowsFor("SELECT row_key FROM sync_tombstones WHERE table_name = 'talk_reviews'"))
        .toEqual([{ row_key: deletedUid }]);
    } finally { original.close(); }
  });
});
