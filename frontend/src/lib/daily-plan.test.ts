/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear()
};
(globalThis as any).window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };

let testDb: Database;
vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { applyExamPreset, dailyPlanView, examPreset, saveDailyPlan, segmentWeight, PLAN_KINDS } from "./daily-plan";
import { getStudyPreferences } from "./studyPreferences";
import { loadKanjiCharData, materializeKanjiChars } from "./kanji-char-cards";
import { materializeConfusionCards } from "./confusion-cards";

describe("每日学习量：视图 / 写回 / 备考一键", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    await loadKanjiCharData();
    materializeKanjiChars();
    materializeConfusionCards();
  });

  it("四段各有新学 / 复习 / 池子 / 建议；总量是四段之和；用时按固定秒数", () => {
    const view = dailyPlanView();
    expect(view.segments.map((segment) => segment.kind)).toEqual(PLAN_KINDS);
    const total = view.segments.reduce((sum, segment) => sum + segment.fresh + segment.review, 0);
    expect(view.total).toBe(total);
    // 出厂库没学过任何东西：到期 0，池子里全是没学过的
    expect(view.segments.every((segment) => segment.pool.due === 0 && segment.pool.unseen > 0)).toBe(true);
    expect(view.segments.every((segment) => segment.suggest.review === 0)).toBe(true);
    expect(view.minutes).toBe(Math.round((15 * 12 + 5 * 25 + 5 * 10 + 3 * 40) / 60));
  });

  it("段长权重按 √池子：大池子每张卡更细", () => {
    const view = dailyPlanView();
    const words = view.segments[0];
    const grammar = view.segments[1];
    expect(words.pool.unseen).toBeGreaterThan(grammar.pool.unseen);
    expect(segmentWeight(words)).toBeLessThan(segmentWeight(grammar));
    // 400 词 vs 20 语法：√ 后大约 4.5 : 1 而不是 20 : 1
    const ratio = (400 * segmentWeight({ pool: { due: 0, unseen: 400 } })) / (20 * segmentWeight({ pool: { due: 0, unseen: 20 } }));
    expect(ratio).toBeCloseTo(4.47, 1);
  });

  it("写回落进偏好；某一段可以是 0；单词复习 0 存成 1（0 是「自动」）", () => {
    saveDailyPlan({
      words: { fresh: 0, review: 0 },
      grammar: { fresh: 7, review: 12 },
      kanji: { fresh: 9, review: 0 },
      confusion: { fresh: 2, review: 4 }
    });
    const prefs = getStudyPreferences();
    expect(prefs.dailyGoal).toBe(0);
    expect(prefs.reviewCap).toBe(1);
    expect(prefs.grammarDailyGoal).toBe(7);
    expect(prefs.grammarReviewCap).toBe(12);
    expect(prefs.kanjiDailyGoal).toBe(9);
    expect(prefs.confusionDailyGoal).toBe(2);
    expect(dailyPlanView().segments[2].fresh).toBe(9);
  });

  it("备考一键：只算 (现在, 目标] 那几级的剩余，按可进新内容的天数摊，封顶", () => {
    const preset = examPreset("N5", "N3");
    expect(preset.remaining.words).toBeGreaterThan(0);
    expect(preset.remaining.grammar).toBeGreaterThan(0);
    expect(preset.plan.words.fresh).toBeLessThanOrEqual(50);
    expect(preset.plan.grammar.fresh).toBeLessThanOrEqual(12);
    expect(preset.plan.words.fresh).toBeGreaterThan(0);
    // 现在 N3 考 N3：没有可进的等级，新学全 0
    const none = examPreset("N3", "N3");
    expect(none.remaining.words).toBe(0);
    expect(none.plan.words.fresh).toBe(0);
    applyExamPreset("N5", "N2");
    expect(getStudyPreferences().jlptTarget).toBe("N2");
    expect(getStudyPreferences().dailyGoal).toBe(examPreset("N5", "N2").plan.words.fresh);
  });
});
