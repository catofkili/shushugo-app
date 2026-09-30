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
import { allCardKeys, newCardOrder } from "./cards";
import {
  answerForHints,
  createTalkTasks,
  ensureTalkTables,
  materializeTalkCards,
  pickTalkNext,
  recordTalkAnswer,
  replayTalkReviews,
  TALK_NEW_PER_DAY,
  talkProgress,
  undoLastTalkAnswer
} from "./schedule";
import { rowsFor, today, type DbRow } from "../study-core";
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
const expectedOrder = [
  "f:F02", "f:F01", "r:S02:1", "r:S02:2",
  "f:F03", "f:F04", "r:S01:0", "r:S01:2", "f:F00", "f:F99"
];
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

describe("开口练习的卡片流水与当天清单", () => {
  it("场景依内容顺序，先公式再接话，重复公式只排一次，未引用公式按 id 排最后", () => {
    expect(newCardOrder()).toEqual(expectedOrder);
    expect(new Set(allCardKeys())).toEqual(new Set(expectedOrder));
    expect(TALK_NEW_PER_DAY).toBe(5);
    expect(createTalkTasks()).toEqual({ fresh: 5, review: 0 });
    expect(tasks()).toEqual(expectedOrder.slice(0, 5));
    expect(talkProgress()).toEqual({ total: 5, done: 0, remaining: 5 });
    expect(pickTalkNext()).toBe(expectedOrder[0]);
  });

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

  it("内容未加载时拒绝建计划，不留下空投影；内容到位后当天仍能正常建五张", () => {
    setTalkContentForTest(null);
    expect(() => createTalkTasks()).toThrow("开口练习内容尚未加载");
    expect(tasks()).toEqual([]);
    expect(rowsFor("SELECT card_key FROM talk_memory")).toEqual([]);
    setTalkContentForTest(content);
    expect(createTalkTasks()).toEqual({ fresh: 5, review: 0 });
    expect(tasks()).toEqual(expectedOrder.slice(0, 5));
  });

  it("同一天重进保持原清单，不因答过一张补第六张", () => {
    createTalkTasks();
    const original = tasks();
    recordTalkAnswer(original[0], 0, false);
    expect(talkProgress()).toEqual({ total: 5, done: 1, remaining: 4 });
    expect(pickTalkNext()).toBe(original[1]);
    createTalkTasks();
    expect(tasks()).toEqual(original);
    expect(tasks()).toHaveLength(5);
  });

  it("第二天只从仍未见过的卡中按原场景顺序取至多五张，保留昨日清单", () => {
    createTalkTasks();
    const yesterday = today();
    const original = tasks();
    for (const key of original) { recordTalkAnswer(key, 0, false); advance(); }
    // 排除第二天复习，只检查下一组新卡的内容和额度。
    testDb.run("UPDATE talk_memory SET fsrs_due = '2099-01-01T00:00:00.000Z' WHERE seen_count > 0");
    vi.setSystemTime(new Date("2026-10-01T12:00:00"));
    expect(createTalkTasks()).toEqual({ fresh: 5, review: 0 });
    expect(tasks()).toEqual(expectedOrder.slice(5));
    expect(tasks(yesterday)).toEqual(original);
    expect(createTalkTasks()).toEqual({ fresh: 5, review: 0 });
  });

  it("到期全部进入复习，五张限制只作用于新卡", () => {
    materializeTalkCards();
    const due = expectedOrder.slice(0, 7);
    for (const key of due) testDb.run(
      "UPDATE talk_memory SET seen_count = 1, fsrs_due = '2000-01-01T00:00:00.000Z', fsrs_state = 2 WHERE card_key = ?", [key]
    );
    expect(createTalkTasks()).toEqual({ fresh: 3, review: 7 });
    expect(new Set(tasks().slice(0, 7))).toEqual(new Set(due));
    expect(tasks().slice(7)).toEqual(expectedOrder.slice(7));
    expect(talkProgress()).toEqual({ total: 10, done: 0, remaining: 10 });
  });

  it("显式传入学习日时，到期判断、下一张和进度都使用那个学习日", () => {
    materializeTalkCards();
    const due = new Date("2026-10-01T12:00:00").toISOString();
    testDb.run("UPDATE talk_memory SET seen_count = 1, fsrs_due = ?, fsrs_state = 2 WHERE card_key = 'f:F02'", [due]);
    expect(createTalkTasks("2026-10-01")).toEqual({ fresh: 5, review: 1 });
    expect(tasks("2026-10-01")[0]).toBe("f:F02");
    expect(pickTalkNext("2026-10-01")).toBe("f:F02");
    expect(talkProgress("2026-10-01")).toEqual({ total: 6, done: 0, remaining: 6 });
    testDb.run("UPDATE talk_memory SET fsrs_due = '2099-01-01T00:00:00.000Z' WHERE card_key = 'f:F02'");
    expect(pickTalkNext("2026-10-01")).toBe("f:F01");
    expect(talkProgress("2026-10-01")).toEqual({ total: 6, done: 1, remaining: 5 });
  });

  it.each([
    [0, false, "know"], [1, false, "fuzzy"], [2, false, "forgot"],
    [3, false, "forgot"], [0, true, "forgot"]
  ] as const)("提示 %i 次、放弃 %s → %s，并在同一条流水记录提示和槽位", (hints, gaveUp, answer) => {
    expect(answerForHints(hints, gaveUp)).toBe(answer);
    createTalkTasks();
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
    if (answer === "know") expect(talkProgress().done).toBe(1);
    else { expect(talkProgress().done).toBe(0); expect(pickTalkNext()).toBe("f:F02"); }
  });

  it("撤销重复作答后精确回到上一业务状态，剩余流水的提示、槽位和同步身份完整保留", () => {
    createTalkTasks();
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
    expect(talkProgress()).toEqual({ total: 5, done: 1, remaining: 4 });
  });

  it("撤掉最后一条流水恢复全新卡，包括 FSRS；再撤返回 null", () => {
    createTalkTasks();
    const beforeMemory = memory();
    recordTalkAnswer("f:F02", 0, false, "お水");
    expect(undoLastTalkAnswer()).toBe("f:F02");
    expect(memory()).toEqual(beforeMemory);
    expect(reviews()).toEqual([]);
    expect(pickTalkNext()).toBe("f:F02");
    expect(talkProgress()).toEqual({ total: 5, done: 0, remaining: 5 });
    expect(undoLastTalkAnswer()).toBeNull();
  });

  it("流水插入失败时整次记账回滚，不能只留下变过的 memory", () => {
    createTalkTasks();
    const beforeMemory = memory();
    const beforeReviews = reviews();
    testDb.run("CREATE TRIGGER reject_talk_review BEFORE INSERT ON talk_reviews BEGIN SELECT RAISE(ABORT, 'reject talk review'); END");
    expect(() => recordTalkAnswer("f:F02", 2, false, "お水")).toThrow("reject talk review");
    expect(memory()).toEqual(beforeMemory);
    expect(reviews()).toEqual(beforeReviews);
    expect(talkProgress()).toEqual({ total: 5, done: 0, remaining: 5 });
    testDb.run("DROP TRIGGER reject_talk_review");
    expect(() => recordTalkAnswer("f:F02", 0, false, "お水")).not.toThrow();
    expect(reviews()).toHaveLength(1);
  });

  it("按流水重建出的完整 memory 与逐条记账相同，重放不增改流水", () => {
    createTalkTasks();
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
    createTalkTasks();
    recordTalkAnswer("f:F02", 0, false, "お水");
    undoLastTalkAnswer();
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

  it("本地增量包含三张表，快照加增量重启能原样恢复作答", () => {
    materializeTalkCards();
    const mark = currentMark();
    const checkpoint = testDb.export();
    createTalkTasks();
    recordTalkAnswer("f:F02", 1, false, "お水");
    const expectedMemory = memory();
    const expectedReviews = reviews();
    const expectedTasks = tasks();
    const delta = collectDelta(mark);
    expect(delta.rows.talk_memory).toHaveLength(1);
    expect(delta.rows.talk_reviews).toHaveLength(1);
    expect(delta.rows.talk_tasks).toHaveLength(5);
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
    createTalkTasks();
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
