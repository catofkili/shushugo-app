import { describe, expect, it } from "vitest";
import { roundOutcome } from "../../lib/spelling/grade";
import type { SpellingVerdict } from "../../lib/spelling";
import { confirmsInput, createRoundState, giveUp, lastVerdict, submit, toRound, useHint as addHint, visibleHintCount } from "./round-state";

const right: SpellingVerdict = {
  correct: true, form: "romaji", readingOk: true, nearMiss: false, problems: [],
  matched: { kind: "reading", text: "たべる", preferred: true }
};
const wrong: SpellingVerdict = {
  correct: false, form: "kana", readingOk: false, nearMiss: false,
  problems: [{ code: "wrong_reading", moraIndex: 2 }]
};
const near: SpellingVerdict = { ...wrong, nearMiss: true, problems: [{ code: "long_vowel" }] };
const peer: SpellingVerdict = { ...wrong, nearMiss: true, problems: [{ code: "peer_word" }] };

describe("拼写一轮状态机", () => {
  it("新卡不带上一张的提交、提示或放弃状态", () => {
    const state = createRoundState(1000);
    expect(state).toEqual({ attempts: [], hintsUsed: 0, gaveUp: false, startedAt: 1000 });
    expect(visibleHintCount(state)).toBe(0);
    expect(lastVerdict(state)).toBeNull();
    expect(roundOutcome(toRound(state, 1000)).done).toBe(false);
  });

  it("记录原始输入，返回新状态，不改已有数组", () => {
    const state = createRoundState(1000);
    Object.freeze(state.attempts);
    Object.freeze(state);
    const next = submit(state, " ＴＡＢＥＲＵ ", right);
    expect(next.attempts).toEqual([{ typed: " ＴＡＢＥＲＵ ", verdict: right }]);
    expect(state.attempts).toEqual([]);
    expect(lastVerdict(next)).toBe(right);
    expect(roundOutcome(toRound(next, 3000)).answer).toBe("know");
  });

  it("逐级累加到 3，不因揭晓提示自动结束", () => {
    let state = createRoundState(0);
    for (const count of [1, 2, 3]) {
      const previous = state;
      state = addHint(state);
      expect(state).not.toBe(previous);
      expect(visibleHintCount(state)).toBe(count);
      expect(roundOutcome(toRound(state, 10)).done).toBe(false);
    }
    expect(addHint(state)).toBe(state);
    expect(roundOutcome(toRound(submit(state, "taberu", right), 20)).answer).toBe("forgot");
  });

  it("一次 nearMiss 后仍可改，第二次才对记 fuzzy", () => {
    const state = submit(createRoundState(0), "taberoo", near);
    expect(roundOutcome(toRound(state, 10))).toMatchObject({ done: false, tries: 1, triesLeft: 1 });
    expect(lastVerdict(state)).toBe(near);
    const next = submit(state, "taberu", right);
    expect(roundOutcome(toRound(next, 20))).toMatchObject({ done: true, answer: "fuzzy", tries: 2 });
  });

  it("peer_word 留在流水里，第一次不占次数，重复之后照真实 grade 计算", () => {
    let state = submit(createRoundState(0), "警察官", peer);
    expect(state.attempts).toHaveLength(1);
    expect(roundOutcome(toRound(state, 10))).toMatchObject({ done: false, tries: 0, triesLeft: 2 });
    expect(roundOutcome(toRound(submit(state, "taberu", right), 20)).answer).toBe("know");
    state = submit(state, "警察官", peer);
    expect(roundOutcome(toRound(state, 20))).toMatchObject({ done: false, tries: 1, triesLeft: 1 });
    state = submit(state, "たべろ", wrong);
    expect(roundOutcome(toRound(state, 30))).toMatchObject({ done: true, answer: "forgot", tries: 2 });
    expect(state.attempts).toHaveLength(3);
  });

  it("结束后忽略提交、提示和放弃，保留第一次结算依据", () => {
    const start = createRoundState(100);
    const exhausted = submit(submit(start, "たべろ", wrong), "たべれ", wrong);
    for (const ended of [submit(start, "taberu", right), giveUp(start), exhausted]) {
      expect(roundOutcome(toRound(ended, 200)).done).toBe(true);
      expect(submit(ended, "taberu", right)).toBe(ended);
      expect(addHint(ended)).toBe(ended);
      expect(giveUp(ended)).toBe(ended);
    }
  });

  it("用过提示再对记 fuzzy；放弃不伪造一次提交", () => {
    const start = createRoundState(0);
    expect(roundOutcome(toRound(submit(addHint(start), "taberu", right), 10)).answer).toBe("fuzzy");
    const abandoned = giveUp(addHint(start));
    expect(abandoned.attempts).toEqual([]);
    expect(roundOutcome(toRound(abandoned, 10))).toMatchObject({ done: true, answer: "forgot", tries: 0 });
  });

  it("计时用传入的时钟；时钟回拨不能产生负用时，转换不共享数组", () => {
    const state = createRoundState(1000);
    expect(toRound(state, 2700).elapsedMs).toBe(1700);
    expect(toRound(state, 500).elapsedMs).toBe(0);
    expect(toRound(state, 2700).attempts).not.toBe(state.attempts);
  });
});

describe("两端确认键", () => {
  it("网页 Enter 和 Taro confirm 可以提交", () => {
    expect(confirmsInput({ type: "keydown", key: "Enter", nativeEvent: {} })).toBe(true);
    expect(confirmsInput({ type: "confirm" })).toBe(true);
    expect(confirmsInput({ type: "keydown", key: "a" })).toBe(false);
  });

  it("组合输入、229 和长按重复的 Enter 都不提交", () => {
    expect(confirmsInput({ type: "keydown", key: "Enter", nativeEvent: { isComposing: true } })).toBe(false);
    expect(confirmsInput({ type: "keydown", key: "Enter", keyCode: 229 })).toBe(false);
    expect(confirmsInput({ type: "keydown", key: "Enter", nativeEvent: { keyCode: 229 } })).toBe(false);
    expect(confirmsInput({ type: "keydown", key: "Enter" }, true)).toBe(false);
    expect(confirmsInput({ type: "confirm" }, true)).toBe(false);
    expect(confirmsInput({ type: "keydown", key: "Enter", repeat: true })).toBe(false);
  });
});
