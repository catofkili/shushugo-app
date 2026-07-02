import { describe, expect, it } from "vitest";
import type { WordCard } from "../../types/vocabulary";
import {
  answerReadingText,
  cardLabel,
  formatDuration,
  isLoanwordSourceCard,
  kanaToRomaji,
  monthDays,
  primaryAnswerText,
  secondaryAnswerText
} from "./word-study-utils";
import { honorificLabel, promptMeaning } from "../../lib/models/word-card";

const card = (patch: Partial<WordCard>): WordCard => ({
  id: 1,
  meaning: "",
  primaryMeaning: "",
  promptMeaning: "",
  kana: "すし",
  kanji: "寿司",
  pos: "名词",
  jlptLevel: "N5",
  score: 0,
  importance: 3,
  importanceScore: 3,
  isFavorite: false,
  note: "",
  example: { jp: "", meaning: "" },
  kanjiComponents: [],
  conjugations: [],
  confusions: [],
  ...patch
});

describe("word-study-utils", () => {
  it("uses kana as the primary answer for loanwords stored with an ASCII source", () => {
    const loanword = card({ kanji: "coffee", kana: "コーヒー" });

    expect(isLoanwordSourceCard(loanword)).toBe(true);
    expect(primaryAnswerText(loanword)).toBe("コーヒー");
    expect(secondaryAnswerText(loanword)).toBe("coffee");
    expect(cardLabel(loanword)).toBe("コーヒー / coffee");
  });

  it("keeps kanji first for ordinary Japanese cards", () => {
    const japaneseCard = card({ kanji: "学校", kana: "がっこう" });

    expect(isLoanwordSourceCard(japaneseCard)).toBe(false);
    expect(primaryAnswerText(japaneseCard)).toBe("学校");
    expect(secondaryAnswerText(japaneseCard)).toBe("がっこう");
  });

  it("shows the Japanese reading for mixed kanji and loanword cards", () => {
    const mixedCard = card({
      kanji: "生産コスト",
      kana: "せいさんこすと",
      englishOrigin: "cost"
    });

    expect(answerReadingText(mixedCard)).toBe("せいさんこすと");
  });

  it("does not show the English source as a Japanese reading", () => {
    const loanword = card({ kanji: "coffee", kana: "コーヒー", englishOrigin: "coffee" });

    expect(answerReadingText(loanword)).toBe("");
  });

  it("romanizes small kana and doubled consonants", () => {
    expect(kanaToRomaji("きゃっこう")).toBe("kya kko u");
  });

  it("formats short and long study durations", () => {
    expect(formatDuration(-1)).toBe("0秒");
    expect(formatDuration(65)).toBe("1分05秒");
    expect(formatDuration(3661)).toBe("1小时01分");
  });

  it("keeps short letter+CJK prompts such as T恤", () => {
    expect(promptMeaning("T恤", 2276, "Ｔシャツ")).toBe("T恤");
    expect(promptMeaning("shirt 衬衫", 287, "shirt")).toBe("衬衫");
  });

  it("labels honorific and humble words without tagging ordinary respect meanings", () => {
    expect(honorificLabel("吃喝（对外敬语）")).toBe("敬语");
    expect(honorificLabel("（「言う」の謙譲語）说，讲")).toBe("谦语");
    expect(honorificLabel("（对自己公司的谦称）敝公司")).toBe("谦称");
    expect(honorificLabel("尊敬，敬仰")).toBe("");
    expect(honorificLabel("谦虚")).toBe("");
  });

  it("builds a complete calendar month", () => {
    const calendar = monthDays("2026-06-19");

    expect(calendar.title).toBe("2026年6月");
    expect(calendar.cells).toHaveLength(31);
    expect(calendar.cells[0]).toBeNull();
    expect(calendar.cells[1]).toEqual({ day: 1, date: "2026-06-01" });
    expect(calendar.cells[30]).toEqual({ day: 30, date: "2026-06-30" });
  });
});
