import { describe, expect, it, vi } from "vitest";
import { loadJlptBank } from "./bank";
import { JLPT_LEVELS } from "./types";

const state = vi.hoisted(() => ({ failures: 1, reads: 0 }));
vi.mock("../../data/jlpt/n3.json", () => ({
  // 让导入的兑现阶段失败，验证同一模块实例真的清掉了 rejected promise。
  get default() {
    state.reads += 1;
    if (state.failures-- > 0) throw new Error("bank unavailable");
    return { version: "fixture", level: "N3", sets: [], passages: {}, questions: [] };
  }
}));

describe("按等级懒加载", () => {
  it("并发共享请求；失败后重试，成功后缓存", async () => {
    const failed = loadJlptBank("N3");
    expect(loadJlptBank("N3")).toBe(failed);
    await expect(failed).rejects.toThrow("bank unavailable");
    const retry = loadJlptBank("N3");
    expect(retry).not.toBe(failed);
    const loaded = await retry;
    expect(loaded.level).toBe("N3");
    expect(loadJlptBank("N3")).toBe(retry);
    expect(state.reads).toBe(2);
  });

  it("五个静态路径都能按等级加载", async () => {
    const banks = await Promise.all(JLPT_LEVELS.map(loadJlptBank));
    expect(banks.map((bank) => bank.level)).toEqual(JLPT_LEVELS);
  });
});
