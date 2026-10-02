import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askedToday, inlineSpellingDecision, markAskedToday } from "./inline";
import { DEFAULT_SPELLING_PREFS } from "./prefs";
import { today } from "../study-core";

const data = new Map<string, string>();
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 3, 3)); data.clear();
  vi.stubGlobal("localStorage", {
    get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key)
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("拼写插播决定", () => {
  const defaults = () => ({ lastEncounterToday: vi.fn(() => true), askedToday: vi.fn(() => false),
    spellingInlineToday: vi.fn(() => 0), spellingDoneToday: vi.fn(() => 0), seed: vi.fn(() => true) });
  it.each([
    ["disabled", { inlineAfterGraduation: false }, {}],
    ["not-graduated", {}, { lastEncounterToday: () => false }],
    ["asked-today", {}, { askedToday: () => true }],
    ["inline-cap", {}, { spellingInlineToday: () => 5 }],
    ["daily-cap", {}, { spellingDoneToday: () => 30 }],
    ["ineligible", { minStabilityDays: 21 }, { seed: (): boolean => false }],
    ["ineligible", {}, { seed: (): boolean => false }],
    ["eligible", {}, {}]
  ])("%s", (reason, patch, depsPatch) => {
    const deps = { ...defaults(), ...depsPatch };
    const prefs = { ...DEFAULT_SPELLING_PREFS, inlineAfterGraduation: true, ...patch };
    expect(inlineSpellingDecision(12, prefs, deps)).toEqual({ show: reason === "eligible", reason });
    if (reason === "disabled") expect(deps.lastEncounterToday).not.toHaveBeenCalled();
  });
  it("不限不检查总额度，播种接收正向稳定度", () => {
    const deps = defaults(); deps.spellingDoneToday.mockReturnValue(99);
    expect(inlineSpellingDecision(8, { ...DEFAULT_SPELLING_PREFS, inlineAfterGraduation: true, dailyCap: 0, minStabilityDays: 60 }, deps).show).toBe(true);
    expect(deps.seed).toHaveBeenCalledWith(8, { minStabilityDays: 60 });
  });
});

describe("今日问过记录", () => {
  it("跳过只记本地，同学习日幂等，跨四点清除旧日并保留其它存储", () => {
    data.set("other", "keep");
    markAskedToday(7); markAskedToday(7);
    expect(askedToday(7)).toBe(true);
    expect(data.get(`shushugo-spelling-asked-${today()}`)).toBe("[7]");
    vi.setSystemTime(new Date(2026, 9, 3, 4));
    expect(askedToday(7)).toBe(false);
    expect([...data.entries()]).toEqual([["other", "keep"]]);
  });
  it("坏内容和异常存储不阻塞，不接受非正整数 id", () => {
    data.set(`shushugo-spelling-asked-${today()}`, '[7,"8",null,-1,1.5]');
    expect(askedToday(7)).toBe(true); expect(askedToday(8)).toBe(false);
    markAskedToday(-1);
    data.set(`shushugo-spelling-asked-${today()}`, "{");
    expect(askedToday(7)).toBe(false);
    vi.stubGlobal("localStorage", { get length() { throw new Error(); }, setItem: () => { throw new Error(); } });
    expect(() => markAskedToday(7)).not.toThrow();
    expect(askedToday(7)).toBe(false);
  });
});
