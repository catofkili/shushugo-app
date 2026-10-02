import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SPELLING_PREFS, getSpellingPrefs, saveSpellingPrefs, SPELLING_PREFS_EVENT } from "./prefs";

const data = new Map<string, string>();
const dispatchEvent = vi.fn();
beforeEach(() => {
  data.clear(); dispatchEvent.mockClear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  vi.stubGlobal("window", { dispatchEvent });
  vi.stubGlobal("CustomEvent", class { constructor(public type: string, public options: unknown) {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("拼写偏好", () => {
  it.each([undefined, "{", "null", "false", "[]", '"x"'])("缺失或无效存储取默认：%s", (raw) => {
    if (raw) data.set("shushugo-spelling-prefs", raw);
    expect(getSpellingPrefs()).toEqual(DEFAULT_SPELLING_PREFS);
  });
  it("所有字段分别验证，不接受数字字符串、未知选项或布尔字符串", () => {
    data.set("shushugo-spelling-prefs", JSON.stringify({ modes: [], modeStrategy: "fixed", dailyCap: "10", minStabilityDays: -7,
      inlineDailyCap: 0, inlineAfterGraduation: "true", showMeaningInAudio: 1, clozeShowTranslation: null }));
    expect(getSpellingPrefs()).toEqual(DEFAULT_SPELLING_PREFS);
    data.set("shushugo-spelling-prefs", JSON.stringify({ modes: ["audio", "audio", "bad"], dailyCap: 20, inlineAfterGraduation: true }));
    expect(getSpellingPrefs()).toEqual({ ...DEFAULT_SPELLING_PREFS, modes: ["audio"], dailyCap: 20, inlineAfterGraduation: true });
  });
  it("部分保存保留已有字段，广播归一后的偏好", () => {
    saveSpellingPrefs({ modes: ["audio", "cloze"], modeStrategy: "rotate", inlineDailyCap: 3 });
    const saved = saveSpellingPrefs({ dailyCap: 0, minStabilityDays: 21, showMeaningInAudio: true, clozeShowTranslation: false });
    expect(saved).toEqual({ ...DEFAULT_SPELLING_PREFS, modes: ["audio", "cloze"], modeStrategy: "rotate", inlineDailyCap: 3,
      dailyCap: 0, minStabilityDays: 21, showMeaningInAudio: true, clozeShowTranslation: false });
    expect(getSpellingPrefs()).toEqual(saved);
    expect(dispatchEvent.mock.calls[1][0]).toMatchObject({ type: SPELLING_PREFS_EVENT, options: { detail: saved } });
  });
  it("默认 modes 不和返回值共享数组；存储和事件抛错不阻塞", () => {
    getSpellingPrefs().modes.push("audio");
    expect(getSpellingPrefs().modes).toEqual(["meaning"]);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error(); }, setItem: () => { throw new Error(); } });
    dispatchEvent.mockImplementationOnce(() => { throw new Error(); });
    expect(getSpellingPrefs()).toEqual(DEFAULT_SPELLING_PREFS);
    expect(saveSpellingPrefs({ dailyCap: 10 }).dailyCap).toBe(10);
  });
});
