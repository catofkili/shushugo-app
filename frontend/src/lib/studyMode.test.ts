import { beforeEach, describe, expect, it, vi } from "vitest";
import { activateMistakesForToday, defaultStudyMode, getStudyMode, saveStudyMode, STUDY_MODES, studyModeInfo, VISIBLE_STUDY_MODES } from "./studyMode";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); }
  });
});

describe("学习模式的记忆", () => {
  it("每个模式都记得住 —— 大按钮要按上次那种开学", () => {
    for (const mode of VISIBLE_STUDY_MODES) {
      expect(saveStudyMode(mode.id)).toBe(mode.id);
      expect(getStudyMode()).toBe(mode.id);
    }
  });

  it("自选清单只启动、不记账 —— 下次开应用不该停在一份旧清单上", () => {
    saveStudyMode("kanji");
    expect(saveStudyMode("picked")).toBe("picked");
    expect(getStudyMode()).toBe("kanji");
  });

  it("已删的 vocabulary 读出来归到经典(它和经典本来就是同一条路径)", () => {
    store.set("mn-active-study-mode", "vocabulary");
    expect(getStudyMode()).toBe(defaultStudyMode);
  });

  it("非法值回落到默认模式", () => {
    store.set("mn-active-study-mode", "wat");
    expect(getStudyMode()).toBe(defaultStudyMode);
  });

  it("模式列表里摆的是那五个,自选清单藏起来(它得先从词库带一批词进来)", () => {
    expect(VISIBLE_STUDY_MODES.map((mode) => mode.id)).toEqual(["classic", "mistakes", "quick", "reverse", "kanji"]);
    expect(STUDY_MODES.filter((mode) => mode.hidden).map((mode) => mode.id)).toEqual(["picked"]);
  });

  it("每个模式都有文案,只有快速复习自己有一页", () => {
    for (const mode of STUDY_MODES) {
      expect(studyModeInfo(mode.id).title.length).toBeGreaterThan(0);
      expect(studyModeInfo(mode.id).short.length).toBeGreaterThan(0);
    }
    expect(STUDY_MODES.filter((mode) => mode.page).map((mode) => mode.id)).toEqual(["quick"]);
  });

  it("当天完成后临时切到错题本,凌晨四点跨学习日后恢复原模式", () => {
    const beforeFour = new Date(2026, 7, 10, 3, 59);
    const afterFour = new Date(2026, 7, 10, 4, 1);

    saveStudyMode("classic");
    expect(activateMistakesForToday("classic", beforeFour)).toBe("mistakes");
    expect(getStudyMode(beforeFour)).toBe("mistakes");
    expect(getStudyMode(afterFour)).toBe("classic");
    expect(getStudyMode(afterFour)).toBe("classic");
  });

  it("自动错题本期间手动换模式时尊重用户选择", () => {
    const now = new Date(2026, 7, 10, 12, 0);
    activateMistakesForToday("classic", now);

    saveStudyMode("reverse", now);

    expect(getStudyMode(now)).toBe("reverse");
  });

  it("手动否决之后,当天不会被第二次自动切走", () => {
    const now = new Date(2026, 7, 10, 12, 0);
    activateMistakesForToday("classic", now);
    saveStudyMode("classic", now);

    // 再进一次已完成的经典模式:WordStudy 会再报一次完成,但今天已经切过了。
    expect(activateMistakesForToday("classic", now)).toBe("classic");
    expect(getStudyMode(now)).toBe("classic");
  });

  it("手动否决只管当天,次日完成后照常自动切", () => {
    const today = new Date(2026, 7, 10, 12, 0);
    const tomorrow = new Date(2026, 7, 11, 12, 0);

    activateMistakesForToday("classic", today);
    saveStudyMode("classic", today);
    expect(getStudyMode(today)).toBe("classic");

    expect(getStudyMode(tomorrow)).toBe("classic");
    expect(activateMistakesForToday("classic", tomorrow)).toBe("mistakes");
    expect(getStudyMode(tomorrow)).toBe("mistakes");
  });
});
