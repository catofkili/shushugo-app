import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const preferences = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => preferences.get(key) ?? null,
  setItem: (key: string, value: string) => preferences.set(key, String(value))
};
(globalThis as any).window = { addEventListener: () => {}, dispatchEvent: () => true };
vi.mock("../database", () => ({ getDatabase: () => testDb, initDatabase: async () => testDb }));
vi.mock("../storage", () => ({ scheduleSave: () => {}, requestFullSnapshot: () => {} }));

import { ensureProgressInitialized } from "./bootstrap";
import { setPickedWords } from "./picked";
import { addAnswerPreview, getWordSession, startAnswerPreviews, submitWordAnswer, submitWordAnswerWithPreview, takeAnswerPreview, undoLastWordAnswer } from "../word-api";
import { shouldSpellWord } from "../spelling/study";
import { readFsrsState } from "../fsrs-store";
import { isGraduatedForDay, LEECH_LAPSE_THRESHOLD } from "../fsrs-scheduler";
import { ensureUserTables, firstValue, rowsFor, studyDayEnd, today } from "../study-core";
import { LOCAL_SCHEMA_SQL } from "../database/schema";
import { getStudyPreferences, saveStudyPreferences } from "../studyPreferences";
import { mergeWordInto } from "../legacy-word-migrations";
import type { WordAnswer } from "../../types/vocabulary";

const factory = readFileSync(new URL("../../../public/nihongo.db", import.meta.url));
const options = { focus: "picked" } as const;
const flag = (id: number) => firstValue<number>("SELECT always_spell FROM spelling_memory WHERE word_id = ?", [id], 0);
const dueWord = (id: number) => testDb.run(`UPDATE progress SET seen_count = 5, known_forever = 0,
  fsrs_stability = 2, fsrs_difficulty = 5, fsrs_due = '2026-10-01T00:00:00.000Z',
  fsrs_last_review = '2026-09-29T00:00:00.000Z', fsrs_state = 2, fsrs_steps = 0,
  fsrs_reps = 5, fsrs_lapses = 0 WHERE word_id = ?`, [id]);
const sessionFor = (ids = [1, 2, 3]) => {
  ids.forEach(dueWord); setPickedWords(ids); return getWordSession(options);
};
const previewFor = (id: number) => {
  const previews = startAnswerPreviews(id);
  addAnswerPreview(previews, "know", options); addAnswerPreview(previews, "forgot", options);
  return previews;
};

beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T04:00:00.000Z"));
  vi.spyOn(Math, "random").mockReturnValue(0.25);
  preferences.clear(); testDb = new SQL.Database(new Uint8Array(factory)); ensureProgressInitialized();
});
afterEach(() => { testDb.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("学习模式的拼写开关", () => {
  it("默认关且保存为设备偏好；最后一次出现用认识预算决定，预算不改进度", () => {
    expect(getStudyPreferences().spellingEnabled).toBe(false);
    saveStudyPreferences({ ...getStudyPreferences(), spellingEnabled: true });
    expect(getStudyPreferences().spellingEnabled).toBe(true);
    const id = sessionFor().card!.id;
    const before = rowsFor("SELECT * FROM progress WHERE word_id = ?", [id]);
    const count = firstValue<number>("SELECT COUNT(*) FROM reviews", [], 0);
    const previews = previewFor(id);
    expect(previews.byAnswer.know?.graduatedForDay).toBe(true);
    expect(shouldSpellWord(id, previews.byAnswer.know!.graduatedForDay, true, "stage1")).toBe(true);
    expect(rowsFor("SELECT * FROM progress WHERE word_id = ?", [id])).toEqual(before);
    expect(firstValue("SELECT COUNT(*) FROM reviews", [], 0)).toBe(count); expect(flag(id)).toBe(0);
    submitWordAnswer(id, "know", options, true);
    expect(isGraduatedForDay(readFsrsState(id), studyDayEnd())).toBe(true);
  });

  it("学习步骤未结束时仍是普通卡；今天最后一张没有下一张也能预测毕业", () => {
    const id = sessionFor([1]).card!.id;
    testDb.run("UPDATE progress SET fsrs_state = 1, fsrs_steps = 0 WHERE word_id = ?", [id]);
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'forgot', 0, ?, 'forward')", [id, today()]);
    const learning = previewFor(id);
    expect(learning.byAnswer.know?.graduatedForDay).toBe(false);
    expect(shouldSpellWord(id, learning.byAnswer.know!.graduatedForDay, true, "stage1")).toBe(false);
    dueWord(id);
    const final = previewFor(id);
    expect(final.byAnswer.know?.card).toBeNull(); expect(takeAnswerPreview(final, id, "know")).toBeNull();
    expect(final.byAnswer.know?.graduatedForDay).toBe(true);
    expect(shouldSpellWord(id, final.byAnswer.know!.graduatedForDay, true, "stage1")).toBe(true);
  });

  it("拼写忘记写正常 reviews / FSRS，之后一直拼写；撤销恢复标记、FSRS 和统计", () => {
    const id = sessionFor().card!.id;
    const before = readFsrsState(id);
    const statsBefore = rowsFor("SELECT seen_count, forgot_count FROM progress WHERE word_id = ?", [id]);
    submitWordAnswer(id, "forgot", options, true);
    expect(flag(id)).toBe(1); expect(shouldSpellWord(id, false, true, "stage1")).toBe(true);
    expect(rowsFor("SELECT word_id, answer, direction FROM reviews")).toContainEqual({ word_id: id, answer: "forgot", direction: "forward" });
    expect(readFsrsState(id)).not.toEqual(before); expect(firstValue("SELECT COUNT(*) FROM spelling_reviews", [], 0)).toBe(0);
    expect(undoLastWordAnswer(options).card?.id).toBe(id); expect(flag(id)).toBe(0);
    expect(readFsrsState(id)).toEqual(before);
    expect(rowsFor("SELECT seen_count, forgot_count FROM progress WHERE word_id = ?", [id])).toEqual(statsBefore);
    expect(firstValue("SELECT COUNT(*) FROM reviews WHERE word_id = ?", [id], 0)).toBe(0);
  });

  it("延后记账也写标记；撤销保留作答前已有的标记，普通忘记不产生标记", () => {
    const id = sessionFor().card!.id;
    const preview = takeAnswerPreview(previewFor(id), id, "forgot")!;
    expect(preview).not.toBeNull(); submitWordAnswerWithPreview(id, "forgot", preview, options, true);
    expect(flag(id)).toBe(1); undoLastWordAnswer(options); expect(flag(id)).toBe(0);
    testDb.run("UPDATE spelling_memory SET always_spell = 1 WHERE word_id = ?", [id]);
    submitWordAnswer(id, "forgot", options, true); undoLastWordAnswer(options); expect(flag(id)).toBe(1);
    testDb.run("UPDATE spelling_memory SET always_spell = 0 WHERE word_id = ?", [id]);
    submitWordAnswer(id, "forgot", options); expect(flag(id)).toBe(0);
  });

  it("开关关、反向、汉字、压轴、回顾保留普通卡；顽固词只认「一直拼写」", () => {
    const id = sessionFor().card!.id;
    testDb.run("INSERT INTO spelling_memory (word_id, always_spell) VALUES (?, 1)", [id]);
    expect(shouldSpellWord(id, true, false, "stage1")).toBe(false);
    for (const phase of ["stage2", "kanji", "relief", "daily-tail", "daily-mistakes"]) expect(shouldSpellWord(id, true, true, phase)).toBe(false);
    expect(shouldSpellWord(id, true, true, "stage1", true)).toBe(false);
    testDb.run("UPDATE progress SET fsrs_lapses = ? WHERE word_id = ?", [LEECH_LAPSE_THRESHOLD, id]);
    // 顽固词不因「今天最后一次」变拼写，但已标「一直拼写」的仍然拼写（作者：不再回到非拼写模式）。
    expect(shouldSpellWord(id, true, true, "stage1")).toBe(true);
    testDb.run("UPDATE spelling_memory SET always_spell = 0 WHERE word_id = ?", [id]);
    expect(shouldSpellWord(id, true, true, "stage1")).toBe(false);
  });

  it("切换作答方式不改变出卡顺序、FSRS、统计；关闭时与原流程一致", () => {
    // 自选清单不参与排片；这里走真正的今日计划，比较正常正向队列。
    testDb.run("UPDATE progress SET known_forever = 1");
    [1, 2, 3, 4, 5, 6].forEach(dueWord);
    getWordSession(); const initial = testDb.export();
    const run = (spelling: boolean) => {
      const sequence: number[] = []; let session = getWordSession();
      const answers: WordAnswer[] = ["forgot", "fuzzy", "know", "know", "forgot", "know", "know", "know", "know"];
      for (const answer of answers) {
        if (!session.card) break;
        sequence.push(session.card.id); session = submitWordAnswer(session.card.id, answer, {}, spelling);
      }
      return { sequence,
        progress: rowsFor("SELECT word_id, seen_count, right_count, fuzzy_count, forgot_count, fsrs_due, fsrs_stability, fsrs_difficulty, fsrs_steps FROM progress WHERE seen_count > 0"),
        reviews: rowsFor("SELECT word_id, answer, reviewed_on, direction, scheduler_mode FROM reviews ORDER BY id"),
        reviewedToday: session.stats.reviewedToday, masteredToday: session.stats.masteredToday };
    };
    const normal = run(false); testDb.close(); testDb = new SQL.Database(initial);
    expect(run(true)).toEqual(normal);
  });

  it.each([true, false])("合并词条保留任一词条的标记，独立拼写记忆仍按 seen_count 取胜 (%s)", (markFrom) => {
    testDb.run("INSERT INTO spelling_memory (word_id, seen_count, always_spell) VALUES (1, 9, ?), (2, 2, ?)", [markFrom ? 0 : 1, markFrom ? 1 : 0]);
    mergeWordInto(testDb, 2, 1); expect(flag(1)).toBe(1);
    expect(firstValue("SELECT seen_count FROM spelling_memory WHERE word_id = 1", [], 0)).toBe(9);
    expect(firstValue("SELECT COUNT(*) FROM spelling_memory WHERE word_id = 2", [], 0)).toBe(0);
  });

  it("旧本机拼写表补列而保留历史", () => {
    testDb.close(); testDb = new SQL.Database(new Uint8Array(factory));
    testDb.run(LOCAL_SCHEMA_SQL.replace("  always_spell INTEGER NOT NULL DEFAULT 0,\n", ""));
    testDb.run("INSERT INTO spelling_memory (word_id, seen_count) VALUES (1, 4)"); ensureUserTables();
    expect(rowsFor("SELECT seen_count, always_spell FROM spelling_memory WHERE word_id = 1")).toEqual([{ seen_count: 4, always_spell: 0 }]);
  });
});
