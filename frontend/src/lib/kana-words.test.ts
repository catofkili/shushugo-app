import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key)
  },
  window: { dispatchEvent: () => true }
});
vi.mock("./database", () => ({ getDatabase: () => testDb }));
vi.mock("./storage", () => ({ requestFullSnapshot: vi.fn(), scheduleSave: vi.fn() }));

import { firstValue, today } from "./database/db-utils";
import { ensureUserTables } from "./study-core";
import { kanaStudyDay, newWordsToday, recordKanaWordAnswer, simpleWords, wordMeaningQuestion } from "./kana-words";

const BASIC_HIRAGANA = new Set([..."あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"]);
const dayAgo = (days: number) => today(new Date(Date.now() - days * 86_400_000));

describe("五十音简单单词", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    ensureUserTables();
  });

  beforeEach(() => {
    testDb.run("DELETE FROM kana_reviews");
    testDb.run("DELETE FROM reviews");
  });

  it("学习日数按此前有作答的不同日期计算，再加今天", () => {
    expect(kanaStudyDay()).toBe(1);
    const add = (symbol: string, day: string, at: number) => testDb.run(
      "INSERT INTO kana_reviews (symbol, answer, reviewed_on, reviewed_at) VALUES (?, 'know', ?, ?)",
      [symbol, day, at]
    );
    add("あ", dayAgo(2), 1);
    add("い", dayAgo(1), 2);
    add("う", today(), 3);
    expect(kanaStudyDay()).toBe(3);
  });

  it("今天第一次复习的词不包括昨天已复习过的词", () => {
    const add = (wordId: number, day: string) => testDb.run(
      "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, 'know', 0, ?)",
      [wordId, day]
    );
    add(1, today());
    add(2, dayAgo(1));
    add(2, today());
    expect(newWordsToday()).toBe(1);
  });

  it("只返回由已学清音组成、释义完整的 N5 词", () => {
    const words = simpleWords(BASIC_HIRAGANA);
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(firstValue<string>("SELECT jlpt_level FROM words WHERE id = ?", [word.id], "")).toBe("N5");
      expect([...word.kana].every((character) => BASIC_HIRAGANA.has(character))).toBe(true);
      expect(word.meaning.trim()).not.toBe("");
      expect(word.meaning).not.toContain("；");
    }
  });

  it("排除见过或标记为熟知的词", () => {
    const words = simpleWords(BASIC_HIRAGANA);
    expect(words.length).toBeGreaterThan(1);
    const seen = words[0];
    const known = words[1];
    testDb.run("UPDATE progress SET seen_count = 1 WHERE word_id = ?", [seen.id]);
    testDb.run("UPDATE progress SET known_forever = 1 WHERE word_id = ?", [known.id]);

    const remainingIds = new Set(simpleWords(BASIC_HIRAGANA).map((word) => word.id));
    expect(remainingIds.has(seen.id)).toBe(false);
    expect(remainingIds.has(known.id)).toBe(false);
  });

  it("只用引入集合里的假名组成单词", () => {
    const introduced = new Set(["い", "え", "あ", "お", "う"]);
    const words = simpleWords(introduced);
    expect(words.every((word) => [...word.kana].every((character) => introduced.has(character)))).toBe(true);
  });

  it("词义题有四个不同选项且恰好一个正确答案", () => {
    const word = simpleWords(BASIC_HIRAGANA)[0];
    expect(word).toBeDefined();
    for (let run = 0; run < 20; run += 1) {
      const question = wordMeaningQuestion(word!);
      expect(question.choices).toHaveLength(4);
      expect(new Set(question.choices.map(({ label }) => label)).size).toBe(4);
      const correct = question.choices.filter(({ correct }) => correct);
      expect(correct).toHaveLength(1);
      expect(correct[0].label).toBe(word!.meaning);
    }
  });

  it("记录单词作答会更新单词进度和流水，但不写五十音流水", () => {
    const word = simpleWords(BASIC_HIRAGANA)[0];
    expect(word).toBeDefined();
    const kanaReviewsBefore = firstValue<number>("SELECT COUNT(*) FROM kana_reviews", [], 0);

    recordKanaWordAnswer(word!.id, true);

    expect(firstValue<number>("SELECT seen_count FROM progress WHERE word_id = ?", [word!.id], 0)).toBeGreaterThanOrEqual(1);
    expect(firstValue<number>("SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ?", [word!.id, today()], 0)).toBeGreaterThan(0);
    expect(firstValue<number>("SELECT COUNT(*) FROM kana_reviews", [], 0)).toBe(kanaReviewsBefore);
  });
  it("同音词不进（ひ = 火 / 日 这种只看假名问意思两个都对），错项也不取同音词的释义", () => {
    const words = simpleWords(BASIC_HIRAGANA, 400);
    expect(words.some((word) => word.kana === "ひ")).toBe(false);
    for (const word of words) {
      expect(firstValue<number>("SELECT COUNT(*) FROM words WHERE jlpt_level = 'N5' AND kana = ?", [word.kana], 0)).toBe(1);
    }
  });
});
