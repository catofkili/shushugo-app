import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let freshDatabase: () => Database;
vi.mock("./database", () => ({ getDatabase: () => testDb }));

import { kanjiChoiceQuestion, readingDistractors } from "./kanji-choice";
import { loadKanjiCharData } from "./kanji-char-cards";
import { allKanjiUnits, kanjiUnitExamples } from "./kanji-unit-index";
import { allKanjiReadingQuestionChars } from "./kanji-reading-usage";

const withFreshDatabase = (run: () => void) => {
  const previous = testDb;
  testDb = freshDatabase();
  try { run(); } finally { testDb.close(); testDb = previous; }
};

describe("单字读音选择题", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))));
    freshDatabase = () => new SQL.Database(bytes);
    testDb = freshDatabase();
    await loadKanjiCharData();
  });
  afterAll(() => testDb.close());

  it("干扰项覆盖长短音、清浊半浊、拗音、ん和促音，转为平假名并去重", () => {
    expect(readingDistractors("こう", [])).toContain("こ");
    expect(readingDistractors("しゅう", [])).toContain("しゅ");
    expect(readingDistractors("せい", [])).toContain("せ");
    expect(readingDistractors("がく", [])).toContain("かく");
    expect(readingDistractors("は", [])).toEqual(expect.arrayContaining(["ば", "ぱ"]));
    expect(readingDistractors("きょ", [])).toEqual(expect.arrayContaining(["き", "こ"]));
    expect(readingDistractors("しゅ", [])).toContain("す");
    expect(readingDistractors("しん", [])).toContain("し");
    expect(readingDistractors("がく", [])).toContain("がっ");
    expect(readingDistractors("いっ", [])).toEqual(expect.arrayContaining(["いつ", "いく"]));
    for (const answer of ["こう", "せい", "がく", "きょ", "しゅ", "しん", "いっ"]) {
      const options = readingDistractors(answer, [answer, "カ", "か", "ABC", ""]);
      expect(options).not.toContain(answer);
      expect(options.every((option) => /^[ぁ-ゖ]+$/u.test(option))).toBe(true);
      expect(new Set(options).size).toBe(options.length);
    }
  });

  it("促音化使用实际读音，并保留原音作干扰项", () => {
    // 「学」的前六个例词没有学校；「楽」的索引实际包含楽器的促音化。
    const item = kanjiChoiceQuestion("楽")!.items.find((candidate) => candidate.variant === "sokuon");
    expect(item).toMatchObject({ word: "楽器", answer: "がっ", base: "がく" });
    expect(item!.options).toContain("がく");
  });

  it("按熟悉度选例词，同一库按字缓存，换库重新选题且选项顺序稳定", () => {
    const original = kanjiChoiceQuestion("犬")!;
    const learned = allKanjiUnits().filter((unit) => unit.char === "犬" && unit.unitType === "char")
      .flatMap((unit) => kanjiUnitExamples(unit.unitKey))
      .find((example) => example.wordId !== original.items[0].wordId && example.variant === "base")!;
    withFreshDatabase(() => {
      testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [learned.wordId]);
      testDb.run("UPDATE progress SET seen_count = 30 WHERE word_id = ?", [learned.wordId]);
      const chosen = kanjiChoiceQuestion("犬")!;
      expect(chosen.items[0].wordId).toBe(learned.wordId);
      testDb.run("UPDATE progress SET seen_count = 0 WHERE word_id = ?", [learned.wordId]);
      expect(kanjiChoiceQuestion("犬")).toBe(chosen);
    });
    withFreshDatabase(() => expect(kanjiChoiceQuestion("犬")).toEqual(original));
  });

  it("同一词形的另一个合法读音不作干扰项", () => {
    withFreshDatabase(() => {
      const wordId = Number(testDb.exec("SELECT id FROM words WHERE kanji = '止める' AND kana = 'とめる'")[0].values[0][0]);
      testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [wordId]);
      testDb.run("UPDATE progress SET seen_count = 30 WHERE word_id = ?", [wordId]);
      const item = kanjiChoiceQuestion("止")!.items[0];
      expect(item).toMatchObject({ word: "止める", answer: "と" });
      expect(item.options).not.toContain("や");
    });
  });

  it("全量选择题资格和选项闸门，手写连线仍为 520 字", () => {
    const lineChars = new Set(allKanjiReadingQuestionChars());
    expect(lineChars.size).toBe(520);
    const chars = new Set(allKanjiUnits().filter((unit) => unit.unitType === "char").map((unit) => unit.char));
    let choiceChars = 0;
    let soundChangeChars = 0;
    let itemCount = 0;
    let distractorCount = 0;
    for (const char of chars) {
      if (lineChars.has(char)) continue;
      const question = kanjiChoiceQuestion(char);
      if (!question) continue;
      choiceChars += 1;
      soundChangeChars += Number(question.items.some((item) => item.variant !== "base"));
      expect(question.items.length).toBeGreaterThanOrEqual(1);
      expect(question.items.length).toBeLessThanOrEqual(2);
      for (const item of question.items) {
        expect(item.word).not.toMatch(/[\[\]]/u);
        expect(item.word.slice(item.start, item.start + item.length)).toBe(char);
        expect(["base", "rendaku", "sokuon", "handaku", "rendaku-handaku", "on-drop"]).toContain(item.variant);
        expect(item.options.length).toBeGreaterThanOrEqual(2);
        expect(item.options.length).toBeLessThanOrEqual(4);
        expect(new Set(item.options).size).toBe(item.options.length);
        expect(item.options.filter((option) => option === item.answer)).toHaveLength(1);
        expect(item.options.every((option) => /^[ぁ-ゖ]+$/u.test(option))).toBe(true);
        if (item.variant !== "base") expect(item.options).toContain(item.base);
        itemCount += 1;
        distractorCount += item.options.length - 1;
      }
    }
    console.log({ choiceChars, soundChangeChars, itemCount, distractorCount, averageDistractors: distractorCount / itemCount, lineChars: lineChars.size });
    expect(choiceChars).toBeGreaterThan(900);
    expect(kanjiChoiceQuestion("不存在")).toBeNull();
  });
});
