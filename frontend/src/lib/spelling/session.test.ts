import { vi, beforeEach, describe, expect, it } from "vitest";

const fixtures = vi.hoisted(() => ({
  id: 777001,
  row: {
    id: 777001,
    kanji: "食べる",
    kana: "たべる",
    meaning: "吃；进食",
    pos: "动词",
    jlpt_level: "N5",
    example_jp: "彼は食べた。",
    example_meaning: "他吃了。",
    example_furigana: JSON.stringify([[2, 1, "た"]]),
    example_tokens: "1,-1,3,1",
    example_lemmas: JSON.stringify({ 2: { lemma: "食べる" } })
  },
  rowsFor: vi.fn(),
  record: vi.fn()
}));

vi.mock("../database/db-utils", () => ({ rowsFor: fixtures.rowsFor }));
vi.mock("./store", () => ({ recordSpellingAnswer: fixtures.record }));

import { checkCardInput, recordSpellingRound, spellingCard } from "./session";
import type { SpellingCard, SpellingLookup, SpellingRound, SpellingTarget, SpellingVerdict } from "./types";

beforeEach(() => {
  fixtures.rowsFor.mockReturnValue([fixtures.row]);
  fixtures.record.mockReset();
});

describe("拼写会话", () => {
  it("audio 和 cloze 仍填释义；cloze 卡用句中形态", () => {
    const audio = spellingCard(fixtures.id, "audio");
    expect(audio).toMatchObject({ mode: "audio", meaning: "吃（普通中性）", target: { surface: "食べる" } });

    const cloze = spellingCard(fixtures.id, "cloze");
    expect(cloze).toMatchObject({
      mode: "cloze",
      meaning: "吃（普通中性）",
      cloze: { before: "彼は", surface: "食べた", reading: "たべた", after: "。" },
      target: { surface: "食べた", kana: "たべた" }
    });
  });

  it("听写和释义题对同音词的诊断一样（都是 homophone，对错档位由用户选）", () => {
    const target: SpellingTarget = {
      wordId: 7, kana: "はし", surface: "橋", forms: [{ surface: "橋", tag: "standard" }], altReadings: [], isLoanword: false
    };
    const card = (mode: SpellingCard["mode"]): SpellingCard => ({
      wordId: 7, meaning: "桥", pos: "名词", moraCount: 2, jlptLevel: "N5", mode, target
    });
    const lookup: SpellingLookup = {
      bySurface: (surface) => surface === "箸" ? [{ wordId: 8, surface: "箸", kana: "はし", meaning: "筷子" }] : [],
      peers: () => []
    };
    for (const mode of ["audio", "meaning"] as const) {
      expect(checkCardInput(card(mode), "箸", lookup)).toMatchObject({ correct: false, problems: [{ code: "homophone" }] });
    }
  });

  it("流水保存用户选的档位、本轮题面形式和来源；引擎诊断只是附带", () => {
    const verdict: SpellingVerdict = {
      correct: false,
      form: "kana",
      readingOk: false,
      problems: [{ code: "wrong_reading", moraIndex: 1 }]
    };
    const round: SpellingRound = { typed: "たびる", verdict, hintsUsed: 1, grade: "know", mode: "audio", elapsedMs: 125.4 };

    recordSpellingRound(fixtures.id, round, "inline", new Date("2026-10-03T00:00:00.000Z"));
    expect(fixtures.record).toHaveBeenCalledWith(fixtures.id, "know", {
      typed: "たびる", form: "kana", hints: 1, ms: 125, problem: "wrong_reading", mode: "audio", source: "inline"
    }, expect.any(Date));
  });
});
