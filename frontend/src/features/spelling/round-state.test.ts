import { describe, expect, it } from "vitest";
import type { SpellingVerdict } from "../../lib/spelling";
import { confirmsInput, createRoundState, reveal, submit, toRound, addHint } from "./round-state";

const wrong: SpellingVerdict = {
  correct: false, form: "kana", readingOk: false, problems: [{ code: "wrong_reading", moraIndex: 2 }]
};

describe("拼写一轮状态机", () => {
  it("新卡不带上一张的任何状态", () => {
    expect(createRoundState(1000)).toEqual({ startedAt: 1000, hintsUsed: 0, revealed: false, typed: "", verdict: null });
  });

  it("提交一次就露出答案，原样记下输入；之后不再改", () => {
    const state = createRoundState(1000);
    Object.freeze(state);
    const next = submit(state, " ＴＡＢＥＲＵ ", wrong);
    expect(next).toMatchObject({ revealed: true, typed: " ＴＡＢＥＲＵ ", verdict: wrong });
    expect(state.revealed).toBe(false);
    expect(submit(next, "other", wrong)).toBe(next);
    expect(reveal(next)).toBe(next);
  });

  it("不写直接看答案：typed 空、没有判定", () => {
    const next = reveal(createRoundState(0));
    expect(next).toMatchObject({ revealed: true, typed: "", verdict: null });
  });

  it("提示逐级累加到 3；露出答案后不再加", () => {
    let state = createRoundState(0);
    for (let i = 0; i < 5; i += 1) state = addHint(state);
    expect(state.hintsUsed).toBe(3);
    const shown = reveal(createRoundState(0));
    expect(addHint(shown)).toBe(shown);
  });

  it("评分就是用户选的档位，和引擎判定无关；计时用传入的时钟，回拨不会出负数", () => {
    const state = submit(createRoundState(1000), "たびる", wrong);
    expect(toRound(state, "know", 2700)).toEqual({
      typed: "たびる", verdict: wrong, hintsUsed: 0, grade: "know", elapsedMs: 1700
    });
    expect(toRound(state, "forgot", 500).elapsedMs).toBe(0);
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
