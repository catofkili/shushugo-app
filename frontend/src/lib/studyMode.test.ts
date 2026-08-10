import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStudyMode, getStudyMode, saveStudyMode, STUDY_MODES, studyModeInfo } from "./studyMode";

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
    for (const mode of STUDY_MODES) {
      expect(saveStudyMode(mode.id)).toBe(mode.id);
      expect(getStudyMode()).toBe(mode.id);
    }
  });

  it("已删的 vocabulary 读出来归到经典(它和经典本来就是同一条路径)", () => {
    store.set("mn-active-study-mode", "vocabulary");
    expect(getStudyMode()).toBe(defaultStudyMode);
  });

  it("非法值回落到默认模式", () => {
    store.set("mn-active-study-mode", "wat");
    expect(getStudyMode()).toBe(defaultStudyMode);
  });

  it("每个模式都有文案,只有快速复习自己有一页", () => {
    for (const mode of STUDY_MODES) {
      expect(studyModeInfo(mode.id).title.length).toBeGreaterThan(0);
      expect(studyModeInfo(mode.id).short.length).toBeGreaterThan(0);
    }
    expect(STUDY_MODES.filter((mode) => mode.page).map((mode) => mode.id)).toEqual(["quick"]);
  });
});
