import { readFileSync } from "node:fs";
import initSqlJs, { type Database } from "sql.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
vi.mock("../database", () => ({ getDatabase: () => testDb, createDatabase: async () => new SQL.Database() }));
vi.mock("../storage", () => ({ scheduleSave: vi.fn() }));
vi.mock("../database/db-utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("../database/db-utils")>(), persistSoon: vi.fn()
}));
vi.mock("../progress-events", () => ({ notifyProgressUpdated: vi.fn(), notifyTodayWordPlanUpdated: vi.fn() }));

import { parseStem, pickDrillQuestions, mistakeQuestions, mockParts, recordJlptAnswers, jlptKindStats } from "./index";
import type { JlptBank, JlptKind, JlptQuestion } from "./types";
import { rowsFor, today } from "../study-core";
import { persistSoon } from "../database/db-utils";
import { notifyProgressUpdated, notifyTodayWordPlanUpdated } from "../progress-events";
import { ensureSyncSchema } from "../sync/schema";
import { exportSyncSnapshot } from "../sync/snapshot";
import { collectDelta, currentMark } from "../local-delta";

const question = (id: string, kind: JlptKind, extra: Partial<JlptQuestion> = {}): JlptQuestion => ({
  id, level: "N3", kind, setId: "trial", stem: "[[駅]]へ行く。", options: ["えき", "いき", "あき", "おき"],
  answer: 1, explanation: "駅读えき。", distractors: { "2": "读音不对。" }, target: null, ...extra
});
// 刻意打乱题型和文章空号，不能把 fixture 的存储顺序当作考试顺序。
const bank: JlptBank = {
  version: "fixture", level: "N3", sets: [{ id: "trial", title: "试做卷" }], passages: { p: "話を[1]、[2]。" },
  questions: [
    question("p2", "passage", { passageId: "p", stem: "[2]" }),
    question("g", "grammar-form", { stem: "明日（　）行く。" }),
    question("p1", "passage", { passageId: "p", stem: "[1]" }),
    question("old", "kanji-reading"), question("newer", "kanji-reading"),
    question("wrong", "kanji-reading"), question("unanswered", "kanji-reading"),
    question("new1", "kanji-reading"), question("new2", "kanji-reading")
  ]
};
const ids = (questions: JlptQuestion[]) => questions.map((q) => q.id);
const record = (questionId: string, chosen: 0 | 1 | 2 | 3 | 4) =>
  recordJlptAnswers(bank, "drill", "session", [{ questionId, chosen }]);

beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T02:30:00"));
  vi.clearAllMocks();
  testDb = new SQL.Database(new Uint8Array(readFileSync(new URL("../../../public/nihongo.db", import.meta.url))));
  testDb.run(readFileSync(new URL("../database/local-schema.sql", import.meta.url), "utf8"));
  ensureSyncSchema();
});
afterEach(() => { testDb.close(); vi.useRealTimers(); });

describe("JLPT 数据层", () => {
  it("逐段解析每种标记，保留普通文本与不合规格的括号", () => {
    expect(parseStem("前[[漢字]]（　）（　　　）＿＿★＿＿[12]後( )（ ）")).toEqual([
      { type: "text", text: "前" }, { type: "underline", text: "漢字" },
      { type: "blank" }, { type: "blank" }, { type: "slot", star: false }, { type: "slot", star: true },
      { type: "ref", n: 12 }, { type: "text", text: "後( )（ ）" }
    ]);
    // 手写题的实际写法：★ 自己占一个空，前后用半角或全角空格隔开
    expect(parseStem("店で ＿＿ ★ ＿＿　＿＿、買う。").filter((part) => part.type === "slot")).toEqual([
      { type: "slot", star: false }, { type: "slot", star: true }, { type: "slot", star: false }, { type: "slot", star: false }
    ]);
    expect(parseStem("")).toEqual([]);
    expect(parseStem("普通文字")).toEqual([{ type: "text", text: "普通文字" }]);
    expect(parseStem("[[改\n行]][1][2]")).toEqual([
      { type: "underline", text: "改\n行" }, { type: "ref", n: 1 }, { type: "ref", n: 2 }
    ]);
  });

  it("新题 → 最近错题或未答 → 最早答对的题，档内随机且不改题库", () => {
    record("old", 1);
    vi.setSystemTime(Date.now() + 1000);
    record("newer", 1); record("wrong", 2); record("unanswered", 0);
    const before = ids(bank.questions);
    const picked = ids(pickDrillQuestions(bank, "kanji-reading", 20, () => 0.999));
    expect(picked).toEqual(["new1", "new2", "wrong", "unanswered", "old", "newer"]);
    const draws = [0.8, 0.999, 0.999, 0.999, 0.999];
    const randomized = ids(pickDrillQuestions(bank, "kanji-reading", 20, () => draws.shift()!));
    expect(randomized.slice(0, 2).sort()).toEqual(["new1", "new2"]);
    expect(randomized.slice(0, 2)).not.toEqual(picked.slice(0, 2));
    expect(randomized.slice(2, 4).sort()).toEqual(["unanswered", "wrong"]);
    expect(randomized.slice(4)).toEqual(["old", "newer"]);
    expect(ids(pickDrillQuestions(bank, "kanji-reading", 1, () => 0.999))).toEqual(["new1"]);
    expect(pickDrillQuestions(bank, "kanji-reading", 0)).toEqual([]);
    expect(pickDrillQuestions(bank, "usage")).toEqual([]);
    expect(ids(bank.questions)).toEqual(before);
  });

  it("文章整篇返回、空号排序，混合新错空仍然整篇出", () => {
    const extended: JlptBank = { ...bank, passages: { ...bank.passages, pOther: "[10][2]" }, questions: [
      ...bank.questions,
      question("other10", "passage", { passageId: "pOther", stem: "[10]" }),
      question("other2", "passage", { passageId: "pOther", stem: "[2]" })
    ] };
    record("p1", 2);
    expect(ids(pickDrillQuestions(extended, "passage", 1, () => 0.999))).toEqual(["p1", "p2"]);
    expect(ids(pickDrillQuestions(extended, "passage", 3, () => 0.999))).toEqual(["p1", "p2", "other2", "other10"]);
    expect(ids(pickDrillQuestions(extended, "passage", 1, () => 0))).toEqual(["other2", "other10"]);
  });

  it("同一题先错后对取最新，同毫秒用 id 破平局；0 算错", () => {
    expect(jlptKindStats(bank).map((s) => s.kind)).toEqual(["kanji-reading", "grammar-form", "passage"]);
    record("wrong", 2); record("wrong", 1); record("g", 0); record("p2", 3); record("p1", 2);
    expect(ids(mistakeQuestions(bank))).toEqual(["g", "p1", "p2"]);
    expect(mistakeQuestions(bank, "kanji-reading")).toEqual([]);
    expect(jlptKindStats(bank)).toEqual([
      { kind: "kanji-reading", total: 6, done: 1, correct: 1, mistakes: 0 },
      { kind: "grammar-form", total: 1, done: 1, correct: 0, mistakes: 1 },
      { kind: "passage", total: 2, done: 2, correct: 0, mistakes: 2 }
    ]);
    const rows = rowsFor("SELECT * FROM jlpt_answers ORDER BY id");
    expect(rows).toHaveLength(5);
    expect(rows[2]).toMatchObject({ chosen: 0, correct: 0, answered_on: today(), mode: "drill", session_id: "session" });
    expect(today()).toBe("2026-10-01");
    expect(persistSoon).toHaveBeenCalledTimes(5);
  });

  it("统计忽略删除的题和其它等级，即使 id 相同", () => {
    record("wrong", 2);
    testDb.run("INSERT INTO jlpt_answers (question_id, level, kind, chosen, correct, mode, session_id, answered_on, answered_at) VALUES ('deleted', 'N3', 'usage', 2, 0, 'drill', 'x', '2026-10-01', 9999999999999)");
    testDb.run("INSERT INTO jlpt_answers (question_id, level, kind, chosen, correct, mode, session_id, answered_on, answered_at) VALUES ('wrong', 'N2', 'kanji-reading', 1, 1, 'drill', 'x', '2026-10-01', 9999999999999)");
    expect(ids(mistakeQuestions(bank))).toEqual(["wrong"]);
    expect(jlptKindStats(bank)[0]).toMatchObject({ done: 1, correct: 0, mistakes: 1 });
    const revised = { ...bank, questions: bank.questions.filter((q) => q.id !== "wrong") };
    expect(mistakeQuestions(revised)).toEqual([]);
    expect(jlptKindStats(revised)[0]).toMatchObject({ total: 5, done: 0, mistakes: 0 });
  });

  it("模拟卷两部分按考试顺序，分钟数按题数；其它套不混进来", () => {
    const parts = mockParts({ ...bank, questions: [...bank.questions, question("elsewhere", "kanji-reading", { setId: "other" })] }, "trial");
    expect(parts.map((p) => [p.section, p.minutes])).toEqual([["vocab", 6], ["grammar", 3]]);
    expect(ids(parts[0].questions)).toEqual(["old", "newer", "wrong", "unanswered", "new1", "new2"]);
    expect(ids(parts[1].questions)).toEqual(["g", "p1", "p2"]);
    expect(mockParts(bank, "unknown").map((p) => p.minutes)).toEqual([0, 0]);
  });

  it("只写本地作答流水，不改任何其它业务表 / FSRS / 计划，不派发进度事件", async () => {
    const tables = rowsFor("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((r) => String(r.name)).filter((name) => !name.startsWith("sqlite_") && !name.startsWith("sync_") && name !== "jlpt_answers");
    const snapshot = () => tables.map((table) => rowsFor(`SELECT * FROM "${table}"`));
    const before = snapshot();
    const mark = currentMark();
    recordJlptAnswers(bank, "mock", "exam", [{ questionId: "old", chosen: 1 }, { questionId: "g", chosen: 0 }]);
    expect(snapshot()).toEqual(before);
    expect(notifyProgressUpdated).not.toHaveBeenCalled();
    expect(notifyTodayWordPlanUpdated).not.toHaveBeenCalled();
    expect(rowsFor("PRAGMA table_info(jlpt_answers)").some((r) => String(r.name).startsWith("fsrs_"))).toBe(false);
    expect(rowsFor("SELECT sync_uid FROM jlpt_answers").every((r) => r.sync_uid)).toBe(true);
    expect(collectDelta(mark).rows.jlpt_answers).toHaveLength(2);
    const cloud = new SQL.Database(await exportSyncSnapshot());
    try {
      expect(cloud.exec("SELECT name FROM sqlite_master WHERE name = 'jlpt_answers'")).toEqual([]);
    } finally { cloud.close(); }
  });

  it("一批失败完整回滚，未知题目不留下半批；空批不落盘", () => {
    testDb.run("CREATE TRIGGER reject_jlpt BEFORE INSERT ON jlpt_answers WHEN NEW.question_id = 'g' BEGIN SELECT RAISE(ABORT, 'reject'); END");
    expect(() => recordJlptAnswers(bank, "mock", "exam", [{ questionId: "old", chosen: 1 }, { questionId: "g", chosen: 1 }])).toThrow("reject");
    expect(rowsFor("SELECT * FROM jlpt_answers")).toEqual([]);
    expect(() => recordJlptAnswers(bank, "drill", "exam", [{ questionId: "old", chosen: 1 }, { questionId: "missing", chosen: 1 }])).toThrow("没有题目");
    recordJlptAnswers(bank, "drill", "empty", []);
    expect(persistSoon).not.toHaveBeenCalled();
  });
});
