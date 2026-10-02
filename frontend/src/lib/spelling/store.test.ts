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
vi.mock("../storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));

import { mergeWordInto } from "../legacy-word-migrations";
import { ensureFsrsColumns, WORD_FSRS } from "../fsrs-store";
import { LEECH_LAPSE_THRESHOLD } from "../fsrs-scheduler";
import { firstValue, rowsFor, today, type DbRow } from "../study-core";
import { ensureSyncSchema } from "../sync/schema";
import { localOnlyTables, SYNCED_TABLES } from "../sync/tables";
import { exportSyncSnapshot } from "../sync/snapshot";
import { SEEDED_STABILITY_RATIO } from "../word-api/directions";
import {
  clearSpellingTasks,
  createSpellingTasks,
  ensureSpellingTables,
  lastEncounterToday,
  pickSpellingNext,
  recordSpellingAnswer,
  seedSpellingCards,
  seedSpellingCardFor,
  spellingDoneToday,
  spellingInlineToday,
  spellingProgress,
  undoLastSpelling
} from "./store";

const seedPath = fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url));
const localSchemaPath = fileURLToPath(new URL("../database/local-schema.sql", import.meta.url));

const rows = (db: Database, sql: string): DbRow[] => {
  const result = db.exec(sql)[0];
  return result ? result.values.map((values) => Object.fromEntries(
    result.columns.map((column, index) => [column, values[index]])
  ) as DbRow) : [];
};

const wordIds = (count: number): number[] => rowsFor(
  "SELECT id FROM words ORDER BY id LIMIT ?", [count]
).map((row) => Number(row.id));

const setForward = (
  wordId: number,
  options: { seen?: number; known?: number; lapses?: number; stability?: number; due?: string } = {}
): void => {
  const { seen = 1, known = 0, lapses = 0, stability = 8, due = "2026-10-01T00:00:00.000Z" } = options;
  testDb.run(`
    INSERT INTO progress (
      word_id, seen_count, known_forever, fsrs_stability, fsrs_difficulty,
      fsrs_due, fsrs_last_review, fsrs_state, fsrs_steps, fsrs_reps, fsrs_lapses
    ) VALUES (?, ?, ?, ?, 5, ?, '2026-09-30T12:00:00.000Z', 2, 0, 4, ?)
    ON CONFLICT(word_id) DO UPDATE SET
      seen_count=excluded.seen_count, known_forever=excluded.known_forever,
      fsrs_stability=excluded.fsrs_stability, fsrs_difficulty=excluded.fsrs_difficulty,
      fsrs_due=excluded.fsrs_due, fsrs_last_review=excluded.fsrs_last_review,
      fsrs_state=excluded.fsrs_state, fsrs_steps=excluded.fsrs_steps,
      fsrs_reps=excluded.fsrs_reps, fsrs_lapses=excluded.fsrs_lapses
  `, [wordId, seen, known, stability, due, lapses]);
};

const spellingMemory = (wordId: number): DbRow => rowsFor(
  "SELECT * FROM spelling_memory WHERE word_id = ?", [wordId]
)[0];

const businessFields = (row: DbRow): DbRow => Object.fromEntries(
  Object.entries(row).filter(([column]) => !column.startsWith("sync_"))
);

const taskRows = (day = today()): DbRow[] => rowsFor(
  "SELECT word_id, order_index FROM spelling_tasks WHERE reviewed_on = ? ORDER BY order_index", [day]
);

beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  testDb.run(readFileSync(localSchemaPath, "utf8"));
  ensureSyncSchema();
  ensureFsrsColumns(WORD_FSRS);
});
afterEach(() => {
  testDb.close();
  vi.useRealTimers();
});

describe("拼写卡播种", () => {
  it("度读正向稳定度，单词播种不依赖 due 排序；已有卡幂等", () => {
    const [low, high, unseen, leech] = wordIds(4);
    setForward(low, { stability: 20 }); setForward(high, { stability: 21, due: "2099-01-01T00:00:00.000Z" });
    setForward(unseen, { seen: 0, stability: 60 }); setForward(leech, { lapses: LEECH_LAPSE_THRESHOLD, stability: 60 });
    expect(seedSpellingCardFor(low, { minStabilityDays: 21 })).toBe(false);
    expect(seedSpellingCardFor(unseen)).toBe(false); expect(seedSpellingCardFor(leech)).toBe(false);
    expect(seedSpellingCardFor(high, { minStabilityDays: 21 })).toBe(true);
    expect(seedSpellingCardFor(high, { minStabilityDays: 60 })).toBe(true);
    expect(spellingMemory(high).fsrs_stability).toBe(21 * SEEDED_STABILITY_RATIO);
    expect(seedSpellingCards(10, { minStabilityDays: 21 })).toBe(0);
    expect(seedSpellingCards(10)).toBe(1);
  });
  it("只给学过、非顽固且没有拼写卡的词按正向 due 播种，折半并保持幂等", () => {
    const [first, second, unseen, known, leech] = wordIds(5);
    setForward(first, { stability: 10, due: "2026-09-01T00:00:00.000Z" });
    setForward(second, { stability: 8, due: "2026-09-02T00:00:00.000Z" });
    setForward(unseen, { seen: 0, stability: 20, due: "2026-08-01T00:00:00.000Z" });
    setForward(known, { known: 1, stability: 20, due: "2026-08-02T00:00:00.000Z" });
    setForward(leech, { lapses: LEECH_LAPSE_THRESHOLD, stability: 20, due: "2026-08-03T00:00:00.000Z" });

    expect(seedSpellingCards(1)).toBe(1);
    expect(seedSpellingCards(10)).toBe(1);
    expect(seedSpellingCards(10)).toBe(0);
    expect(rowsFor("SELECT word_id FROM spelling_memory ORDER BY word_id").map((row) => Number(row.word_id)))
      .toEqual([first, second].sort((a, b) => a - b));
    const seeded = spellingMemory(first);
    expect(seeded).toMatchObject({
      seen_count: 0,
      fsrs_stability: Math.max(10 * SEEDED_STABILITY_RATIO, 0.1),
      fsrs_due: new Date().toISOString(),
      fsrs_last_review: new Date().toISOString(),
      fsrs_state: 2,
      fsrs_steps: 0,
      fsrs_reps: 0,
      fsrs_lapses: 0
    });
    expect(seeded.sync_updated_at).toBeTruthy();
    expect(JSON.parse(String(seeded.seed_fsrs_state))).toMatchObject({
      stability: Math.max(10 * SEEDED_STABILITY_RATIO, 0.1),
      due: new Date().toISOString(),
      lastReview: new Date().toISOString(),
      reps: 0,
      lapses: 0,
      steps: 0
    });
  });
});

describe("拼写卡任务与作答", () => {
  it("度只过滤新卡，不阻止到期复习", () => {
    const [low, high, review] = wordIds(3);
    setForward(low, { stability: 6 }); setForward(high, { stability: 21 }); setForward(review, { stability: 1 });
    seedSpellingCards(3);
    testDb.run("UPDATE spelling_memory SET seen_count = 1, fsrs_due = '2026-10-01T00:00:00.000Z' WHERE word_id = ?", [review]);
    expect(createSpellingTasks({ fresh: 10, review: 10 }, today(), { minStabilityDays: 21 })).toEqual({ fresh: 1, review: 1 });
    expect(taskRows().map((row) => Number(row.word_id))).toEqual([review, high]);
  });
  it("每日数量按不同词去重，插播仅计 inline 来源，遵守指定学习日", () => {
    const [first, second] = wordIds(2);
    seedSpellingCards(1);
    ensureSpellingTables();
    for (const [id, day, source] of [[first, today(), "page"], [first, today(), "inline"], [first, today(), "inline"], [second, today(), "page"], [second, "2026-10-01", "inline"]]) {
      testDb.run("INSERT INTO spelling_reviews (word_id, answer, reviewed_on, reviewed_at, typed, form, source) VALUES (?, 'know', ?, 0, '', 'empty', ?)", [id, day, source]);
    }
    expect(spellingDoneToday()).toBe(2); expect(spellingInlineToday()).toBe(1);
    expect(spellingDoneToday("2026-10-01")).toBe(1); expect(spellingInlineToday("2026-10-01")).toBe(1);
  });
  it("按额度建到期和新学清单，同日不重排，清除后按新额度重排", () => {
    const ids = wordIds(5);
    [2, 8, 6, 4, 10].forEach((stability, index) => setForward(ids[index], { stability, due: `2026-09-0${index + 1}T00:00:00.000Z` }));
    expect(seedSpellingCards(5)).toBe(5);
    testDb.run("UPDATE spelling_memory SET seen_count = 1, fsrs_due = '2026-10-01T00:00:00.000Z' WHERE word_id IN (?, ?)", [ids[0], ids[1]]);

    expect(createSpellingTasks({ fresh: 2, review: 1 })).toEqual({ review: 1, fresh: 2 });
    const firstList = taskRows();
    expect(firstList).toHaveLength(3);
    expect(firstList.slice(1).map((row) => Number(row.word_id))).toEqual([ids[4], ids[2]]);
    expect(createSpellingTasks({ fresh: 0, review: 0 })).toEqual({ review: 1, fresh: 2 });
    expect(taskRows()).toEqual(firstList);

    const next = pickSpellingNext();
    expect(typeof next).toBe("number");
    expect(next).not.toBeNull();
    expect(pickSpellingNext(today(), new Set([String(next)]))).not.toBe(next);
    expect(spellingProgress()).toEqual({ total: 3, done: 0, remaining: 3 });

    clearSpellingTasks();
    expect(taskRows()).toEqual([]);
    expect(createSpellingTasks({ fresh: 1, review: 0 })).toEqual({ review: 0, fresh: 1 });
    expect(taskRows()).toHaveLength(1);
  });

  it.each([
    ["know", "known", 1, 0, 0, 2],
    ["fuzzy", "normal", 0, 1, 0, 1],
    ["forgot", "normal", 0, 0, 1, 1]
  ] as const)("%s 写入拼写流水和合理 FSRS 状态", (answer, mode, right, fuzzy, forgot, state) => {
    const [wordId] = wordIds(1);
    ensureSpellingTables();
    testDb.run("INSERT INTO spelling_memory (word_id) VALUES (?)", [wordId]);
    const mainReviewsBefore = firstValue<number>("SELECT COUNT(*) FROM reviews", [], 0);

    recordSpellingAnswer(wordId, answer, {
      typed: "きょうは",
      form: "kana",
      hints: answer === "know" ? 0 : 1,
      tries: answer === "know" ? 1 : 2,
      ms: 1234,
      problem: answer === "know" ? "" : "long_vowel"
    });

    expect(spellingMemory(wordId)).toMatchObject({
      seen_count: 1, right_count: right, fuzzy_count: fuzzy, forgot_count: forgot,
      fsrs_state: state
    });
    expect(rowsFor("SELECT word_id, answer, scheduler_mode, typed, form, hints, tries, ms, problem, sync_uid FROM spelling_reviews"))
      .toMatchObject([{
        word_id: wordId, answer, scheduler_mode: mode, typed: "きょうは", form: "kana",
        hints: answer === "know" ? 0 : 1, tries: answer === "know" ? 1 : 2,
        ms: 1234, problem: answer === "know" ? "" : "long_vowel"
      }]);
    expect(rowsFor("SELECT sync_uid FROM spelling_reviews")[0].sync_uid).toBeTruthy();
    expect(firstValue<number>("SELECT COUNT(*) FROM reviews", [], 0)).toBe(mainReviewsBefore);
  });

  it("撤销后逐字段恢复播种前状态", () => {
    const [wordId] = wordIds(1);
    setForward(wordId, { stability: 8 });
    expect(seedSpellingCards(1)).toBe(1);
    const before = businessFields(spellingMemory(wordId));

    recordSpellingAnswer(wordId, "forgot", {
      typed: "ちがう", form: "kana", hints: 2, tries: 2, ms: 4000, problem: "wrong_reading"
    });

    expect(undoLastSpelling()).toBe(wordId);
    expect(businessFields(spellingMemory(wordId))).toEqual(before);
    expect(rowsFor("SELECT id FROM spelling_reviews")).toEqual([]);
  });
});

describe("正向毕业钩子和同步登记", () => {
  it.each([1, 3])("正向卡在 Learning / Relearning (%i) 时不算毕业", (state) => {
    const [wordId] = wordIds(1);
    setForward(wordId);
    testDb.run(`UPDATE progress SET fsrs_state = ?, fsrs_due = '2099-01-01T00:00:00.000Z' WHERE word_id = ?`, [state, wordId]);
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, 'know', 0, ?)", [wordId, today()]);
    expect(lastEncounterToday(wordId)).toBe(false);
  });

  it("已答且正向 Review due 越过学习日边界才算毕业；没答过为 false", () => {
    const [answered, untouched] = wordIds(2);
    setForward(answered);
    setForward(untouched);
    testDb.run("UPDATE progress SET fsrs_due = '2099-01-01T00:00:00.000Z', fsrs_state = 2 WHERE word_id = ?", [answered]);
    testDb.run("UPDATE progress SET fsrs_due = '2099-01-01T00:00:00.000Z', fsrs_state = 2 WHERE word_id = ?", [untouched]);
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, 'know', 0, ?)", [answered, today()]);
    expect(lastEncounterToday(answered)).toBe(true);
    expect(lastEncounterToday(untouched)).toBe(false);
  });

  it("三表只在本机增量，出厂库有登记，云快照与墓碑都不包含它们", async () => {
    const spellingTables = ["spelling_memory", "spelling_reviews", "spelling_tasks"];
    expect(new Set(localOnlyTables().filter((table) => table.startsWith("spelling_")))).toEqual(new Set(spellingTables));
    expect(SYNCED_TABLES.filter((entry) => spellingTables.includes(entry.table) && entry.cloud === false)).toHaveLength(3);
    for (const table of spellingTables) {
      expect(testDb.exec(`PRAGMA table_info(${table})`)[0]?.values.length).toBeGreaterThan(0);
    }
    const [wordId] = wordIds(1);
    testDb.run("INSERT INTO spelling_memory (word_id) VALUES (?)", [wordId]);
    testDb.run("DELETE FROM spelling_memory WHERE word_id = ?", [wordId]);
    testDb.run(`INSERT INTO spelling_reviews (word_id, answer, reviewed_on, reviewed_at, typed, form)
      VALUES (?, 'know', ?, ?, 'あ', 'kana')`, [wordId, today(), Date.now()]);
    testDb.run("DELETE FROM spelling_reviews WHERE word_id = ?", [wordId]);
    testDb.run("INSERT INTO spelling_tasks (reviewed_on, word_id, order_index) VALUES (?, ?, 0)", [today(), wordId]);
    testDb.run("DELETE FROM spelling_tasks WHERE word_id = ?", [wordId]);
    expect(new Set(rowsFor("SELECT DISTINCT table_name FROM sync_tombstones WHERE table_name LIKE 'spelling_%'").map((row) => row.table_name)))
      .toEqual(new Set(spellingTables));

    const snapshot = new SQL.Database(await exportSyncSnapshot());
    try {
      expect(rows(snapshot, "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'spelling_%'")).toEqual([]);
      expect(rows(snapshot, "SELECT table_name FROM sync_tombstones WHERE table_name LIKE 'spelling_%'")).toEqual([]);
    } finally {
      snapshot.close();
    }
  });

  it("词条合并时搬迁拼写 memory / tasks，并为流水更换同步身份", () => {
    const fromId = 2480;
    const intoId = 775;
    testDb.run("INSERT OR IGNORE INTO words (id, meaning, kana, kanji, pos, importance) VALUES (?, '楼', 'ビル', 'ビル', '名词', 5)", [fromId]);
    testDb.run("INSERT OR IGNORE INTO progress (word_id, seen_count) VALUES (?, 2), (?, 1)", [fromId, intoId]);
    testDb.run("UPDATE progress SET seen_count = 1 WHERE word_id = ?", [intoId]);
    testDb.run("UPDATE progress SET seen_count = 2 WHERE word_id = ?", [fromId]);
    testDb.run("INSERT INTO spelling_memory (word_id, seen_count) VALUES (?, 1), (?, 3)", [intoId, fromId]);
    testDb.run("INSERT INTO spelling_tasks (reviewed_on, word_id, order_index) VALUES (?, ?, 0), (?, ?, 1)", [today(), intoId, today(), fromId]);
    testDb.run(`INSERT INTO spelling_reviews (word_id, answer, reviewed_on, reviewed_at, typed, form)
      VALUES (?, 'know', ?, 1, 'ビル', 'kana')`, [fromId, today()]);
    const oldUid = String(firstValue("SELECT sync_uid FROM spelling_reviews WHERE word_id = ?", [fromId], ""));

    mergeWordInto(testDb, fromId, intoId);

    expect(firstValue<number>("SELECT seen_count FROM spelling_memory WHERE word_id = ?", [intoId], 0)).toBe(3);
    expect(firstValue<number>("SELECT COUNT(*) FROM spelling_memory WHERE word_id = ?", [fromId], 0)).toBe(0);
    expect(firstValue<number>("SELECT COUNT(*) FROM spelling_reviews WHERE word_id = ?", [fromId], 0)).toBe(0);
    expect(firstValue<number>("SELECT COUNT(*) FROM spelling_reviews WHERE word_id = ?", [intoId], 0)).toBe(1);
    expect(firstValue("SELECT sync_uid FROM spelling_reviews WHERE word_id = ?", [intoId], "")).not.toBe(oldUid);
    expect(firstValue<number>("SELECT COUNT(*) FROM sync_tombstones WHERE table_name = 'spelling_reviews' AND row_key = ?", [oldUid], 0)).toBe(1);
    expect(firstValue<number>("SELECT COUNT(*) FROM spelling_tasks WHERE word_id = ?", [fromId], 0)).toBe(0);
    expect(firstValue<number>("SELECT COUNT(*) FROM spelling_tasks WHERE word_id = ?", [intoId], 0)).toBe(1);
  });
});


describe("老库补列", () => {
  it("已存在的 spelling_reviews 缺 override / mode / source 三列时，ensureSpellingTables 补上，已有流水保留并取默认值", () => {
    testDb.run("DROP TABLE spelling_reviews");
    testDb.run(`CREATE TABLE spelling_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, word_id INTEGER NOT NULL, answer TEXT NOT NULL, reviewed_on TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL, scheduler_mode TEXT NOT NULL DEFAULT 'normal', fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, typed TEXT NOT NULL, form TEXT NOT NULL,
      hints INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0, problem TEXT NOT NULL DEFAULT ''
    )`);
    testDb.run("INSERT INTO spelling_reviews (word_id, answer, reviewed_on, reviewed_at, typed, form) VALUES (1, 'know', '2026-10-01', 1, 'あ', 'kana')");
    ensureSpellingTables();
    ensureSpellingTables();
    const columns = rowsFor("PRAGMA table_info(spelling_reviews)").map((row) => String(row.name));
    expect(columns).toEqual(expect.arrayContaining(["override", "mode", "source"]));
    expect(rowsFor("SELECT override, mode, source FROM spelling_reviews")[0]).toEqual({ override: "", mode: "meaning", source: "page" });
  });

  it("recordSpellingAnswer 把裁决 / 题面形式 / 来源写进流水，不传时取默认值", () => {
    const [wordId] = wordIds(1);
    setForward(wordId);
    expect(seedSpellingCards(1)).toBe(1);
    recordSpellingAnswer(wordId, "fuzzy", { typed: "a", form: "romaji", hints: 0, tries: 1, ms: 1, problem: "wrong_reading", override: "correct", mode: "cloze", source: "inline" });
    recordSpellingAnswer(wordId, "know", { typed: "b", form: "kana", hints: 0, tries: 1, ms: 1, problem: "" });
    const rows = rowsFor("SELECT override, mode, source FROM spelling_reviews ORDER BY id");
    expect(rows[0]).toEqual({ override: "correct", mode: "cloze", source: "inline" });
    expect(rows[1]).toEqual({ override: "", mode: "meaning", source: "page" });
  });

});
