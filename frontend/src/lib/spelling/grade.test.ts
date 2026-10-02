import { describe, expect, it } from "vitest";
import { gradeRound, MAX_TRIES, roundOutcome } from "./grade";
import type { SpellingAttempt, SpellingProblem, SpellingRound, SpellingVerdict } from "./types";

const verdict = (correct: boolean, problems: SpellingProblem[] = []): SpellingVerdict => ({
  correct, form: "kana", readingOk: correct, nearMiss: false, problems
});
const right: SpellingAttempt = { typed: "たべる", verdict: verdict(true) };
const wrong: SpellingAttempt = { typed: "たべろ", verdict: verdict(false, [{ code: "wrong_reading", moraIndex: 2 }]) };
const peer: SpellingAttempt = { typed: "警察官", verdict: verdict(false, [{ code: "peer_word" }]) };
const round = (attempts: SpellingAttempt[], extra: Partial<SpellingRound> = {}): SpellingRound => ({
  attempts, hintsUsed: 0, gaveUp: false, elapsedMs: 4000, ...extra
});

describe("拼写评分", () => {
  it("第一次提交就对且没用提示 → know", () => {
    expect(roundOutcome(round([right]))).toEqual({ done: true, answer: "know", triesLeft: 0, tries: 1 });
  });

  it("用过提示、或第二次才对 → fuzzy", () => {
    expect(gradeRound(round([right], { hintsUsed: 1 }))).toBe("fuzzy");
    expect(gradeRound(round([right], { hintsUsed: 2 }))).toBe("fuzzy");
    expect(gradeRound(round([wrong, right]))).toBe("fuzzy");
  });

  it("揭晓级提示之后再对也是 forgot", () => {
    expect(gradeRound(round([right], { hintsUsed: 3 }))).toBe("forgot");
  });

  it("放弃、或提交用完仍没对 → forgot；没用完时还没结束", () => {
    expect(gradeRound(round([], { gaveUp: true }))).toBe("forgot");
    expect(roundOutcome(round([wrong]))).toEqual({ done: false, answer: null, triesLeft: MAX_TRIES - 1, tries: 1 });
    expect(gradeRound(round([wrong, wrong]))).toBe("forgot");
  });

  it("peer_word 不占提交次数，但每轮只豁免第一次", () => {
    expect(gradeRound(round([peer, right]))).toBe("know");
    expect(roundOutcome(round([peer])).done).toBe(false);
    expect(roundOutcome(round([peer])).triesLeft).toBe(MAX_TRIES);
    // 第二次还写同义词就算一次提交
    expect(roundOutcome(round([peer, peer])).tries).toBe(1);
    expect(gradeRound(round([peer, peer, wrong]))).toBe("forgot");
  });

  it("没结束的一轮不能评分", () => {
    expect(() => gradeRound(round([wrong]))).toThrow();
    expect(() => gradeRound(round([]))).toThrow();
  });

  it("maxTries 可调", () => {
    expect(roundOutcome(round([wrong, wrong]), 3).done).toBe(false);
    expect(gradeRound(round([wrong, wrong, right]), 3)).toBe("fuzzy");
  });
});
