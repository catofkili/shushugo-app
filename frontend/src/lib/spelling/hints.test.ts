import { describe, expect, it } from "vitest";
import { spellingHints } from "./hints";
import type { SpellingTarget } from "./types";

const target: SpellingTarget = {
  wordId: 1,
  kana: "たべる",
  surface: "食べる",
  forms: [{ surface: "食べる", tag: "standard" }],
  altReadings: [],
  isLoanword: false
};

describe("spellingHints", () => {
  it("meaning 与 cloze 保留原三阶提示", () => {
    expect(spellingHints(target)).toEqual([
      { level: 1, moraCount: 3, first: "た" },
      { level: 2, kana: "たべる", romaji: "taberu" },
      { level: 3, surface: "食べる" }
    ]);
    expect(spellingHints({ ...target, kana: "たべた", surface: "食べた", forms: [{ surface: "食べた", tag: "standard" }] }, "cloze"))
      .toEqual([
        { level: 1, moraCount: 3, first: "た" },
        { level: 2, kana: "たべた", romaji: "tabeta" },
        { level: 3, surface: "食べた" }
      ]);
  });

  it("audio 先给意思，再给原三阶提示", () => {
    expect(spellingHints(target, "audio", "吃；进食")).toEqual([
      { level: 0, meaning: "吃；进食" },
      { level: 1, moraCount: 3, first: "た" },
      { level: 2, kana: "たべる", romaji: "taberu" },
      { level: 3, surface: "食べる" }
    ]);
  });
});
