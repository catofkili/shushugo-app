import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb
}));

import {
  createKanjiCharTasks,
  kanjiCharCard,
  kanjiCharPool,
  kanjiCharProgress,
  loadKanjiCharData,
  materializeKanjiChars,
  pickKanjiCharNext,
  recordKanjiCharReview,
  replayKanjiCharReviews
} from "./kanji-char-cards";
import { allKanjiReadingQuestionChars, assignKanjiReadingPair, shuffleKanjiReadingOptions } from "./kanji-reading-usage";
import { rowsFor, firstValue, today } from "./study-core";

describe("单独汉字卡", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    await loadKanjiCharData();
  });

  it("从读音单位索引聚出候选字，等级取最低；重跑不重复", () => {
    const first = materializeKanjiChars();
    expect(first).toBeGreaterThan(1500);
    expect(materializeKanjiChars()).toBe(0);
    // 「日」在 N5 词里出现（日本、今日），等级必须是 0
    expect(firstValue<number>("SELECT level_rank FROM kanji_char_memory WHERE char = '日'", [], 9)).toBe(0);
  });

  it("反面：读音来自 KANJIDIC、多音字带判据、例词带释义且按熟悉度排", () => {
    const card = kanjiCharCard("悪");
    expect(card).not.toBeNull();
    expect(card!.on).toContain("あく");
    expect(card!.kun.join("|")).toMatch(/わる/);
    expect(card!.usage.length).toBeGreaterThanOrEqual(2);
    expect(card!.usage.every((u) => u.note.length > 0)).toBe(true);
    expect(card!.examples.length).toBeGreaterThan(0);
    expect(card!.examples.every((e) => e.kanji.includes("悪") && e.meaning)).toBe(true);
    expect(card!.question?.items.length).toBeGreaterThanOrEqual(2);
    expect(new Set(card!.question!.items.map((item) => item.targetReading)).size).toBe(card!.question!.items.length);
    expect(card!.question!.items.every((item) => [...item.word].filter((char) => char === "悪").length === 1)).toBe(true);
    // 学过的例词排前面
    const wordId = card!.examples[card!.examples.length - 1].wordId;
    testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [wordId]);
    testDb.run("UPDATE progress SET seen_count = 30 WHERE word_id = ?", [wordId]);
    expect(kanjiCharCard("悪")!.examples[0].wordId).toBe(wordId);
    // 单音字没有 usage 也照样有读音
    const single = kanjiCharCard("犬");
    expect(single!.on.length + single!.kun.length).toBeGreaterThan(0);
  });

  it("当天清单：新学按额度、目标等级内、出现多的先；同一天不重排", () => {
    const eligible = new Set(allKanjiReadingQuestionChars());
    expect(eligible.size).toBe(520);
    const unsupported = rowsFor("SELECT char FROM kanji_char_memory").map((row) => String(row.char)).find((char) => !eligible.has(char));
    expect(unsupported).toBeTruthy();
    testDb.run("INSERT INTO kanji_char_tasks (reviewed_on, char, order_index) VALUES (?, ?, 0)", [today(), unsupported!]);
    const made = createKanjiCharTasks({ fresh: 5, review: 10 }, 0);
    expect(made).toEqual({ fresh: 5, review: 0 });
    const tasks = rowsFor("SELECT t.char, m.level_rank FROM kanji_char_tasks t JOIN kanji_char_memory m ON m.char = t.char ORDER BY order_index");
    expect(tasks).toHaveLength(5);
    expect(tasks.every((row) => eligible.has(String(row.char)))).toBe(true);
    expect(tasks.every((row) => Number(row.level_rank) === 0)).toBe(true);
    expect(createKanjiCharTasks({ fresh: 50, review: 50 }, 4)).toEqual({ fresh: 5, review: 0 });
    expect(kanjiCharProgress()).toEqual({ total: 5, done: 0, remaining: 5 });
    expect(kanjiCharPool(0).unseen).toBeGreaterThan(5);
  });

  it("读音选项打乱后仍各不相同，重配时每个读音只连一词", () => {
    const shuffled = shuffleKanjiReadingOptions(["あ", "い", "う"], () => 0);
    expect(new Set(shuffled)).toEqual(new Set(["あ", "い", "う"]));
    const first = assignKanjiReadingPair({}, 0, 0);
    const reassigned = assignKanjiReadingPair(first, 1, 0);
    expect(reassigned).toEqual({ 1: 0 });
    expect(Object.values(reassigned)).toEqual([0]);
  });

  it("作答进 FSRS、写流水；第一次就认识当天毕业，忘记的当天再出；重放能原样重建", () => {
    const first = pickKanjiCharNext()!;
    expect(first).toBeTruthy();
    recordKanjiCharReview(first, "know");
    expect(pickKanjiCharNext()).not.toBe(first);
    expect(kanjiCharProgress().done).toBe(1);

    const second = pickKanjiCharNext()!;
    recordKanjiCharReview(second, "forgot");
    // 忘记 → Learning 步骤，当天不算毕业，还在队列里
    const remaining: string[] = [];
    const excluded = new Set<string>();
    for (let i = 0; i < 6; i += 1) { const next = pickKanjiCharNext(today(), excluded); if (!next) break; remaining.push(next); excluded.add(next); }
    expect(remaining).toContain(second);
    expect(kanjiCharProgress().done).toBe(1);

    const before = rowsFor("SELECT char, seen_count, forgot_count, fsrs_due, fsrs_state FROM kanji_char_memory WHERE char IN (?, ?) ORDER BY char", [first, second]);
    testDb.run("UPDATE kanji_char_memory SET seen_count = 0, fsrs_due = NULL, fsrs_state = NULL WHERE char IN (?, ?)", [first, second]);
    expect(replayKanjiCharReviews([first, second])).toBe(2);
    const after = rowsFor("SELECT char, seen_count, forgot_count, fsrs_due, fsrs_state FROM kanji_char_memory WHERE char IN (?, ?) ORDER BY char", [first, second]);
    expect(after).toEqual(before);
    expect(firstValue<number>("SELECT COUNT(*) FROM kanji_char_reviews", [], 0)).toBe(2);
  });
});
