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

import { applyExamPreset, arrangedPlan, dailyPlanView, examPreset, learnedLevel, previewCurrentLevelPlan, saveDailyPlan, segmentLength, PLAN_KINDS } from "./daily-plan";
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
    expect(view.minutes).toBe(Math.round((15 * 12 + 5 * 25 + 5 * 10 + 5 * 40) / 60));
  });

  it("段长按 log(1+数量) 压：517 / 31 / 8 / 19 不是 90/5/1/3，最小那段也占一成多", () => {
    const counts = [517, 31, 8, 19];
    const lengths = counts.map(segmentLength);
    const sum = lengths.reduce((total, length) => total + length, 0);
    const shares = lengths.map((length) => length / sum);
    expect(shares[0]).toBeLessThan(0.5);
    expect(Math.min(...shares)).toBeGreaterThan(0.1);
    expect(segmentLength(0)).toBe(0);
  });

  it("写回落进偏好；复习数没动的段 cap 原样留着（0 = 自动 / 到期全出 不被写死）；动了才存", () => {
    // 出厂库到期全是 0，所以复习 0 = 「没动」：三种 cap 都该保持出厂的 0
    saveDailyPlan({
      words: { fresh: 0, review: 0 },
      grammar: { fresh: 7, review: 12 },
      kanji: { fresh: 9, review: 0 },
      confusion: { fresh: 2, review: 4 }
    });
    const prefs = getStudyPreferences();
    expect(prefs.dailyGoal).toBe(0);
    expect(prefs.reviewCap).toBe(0);
    expect(prefs.grammarDailyGoal).toBe(7);
    expect(prefs.grammarReviewCap).toBe(12);
    expect(prefs.kanjiDailyGoal).toBe(9);
    expect(prefs.kanjiReviewCap).toBe(0);
    expect(prefs.confusionDailyGoal).toBe(2);
    expect(prefs.confusionReviewCap).toBe(4);
    expect(dailyPlanView().segments[2].fresh).toBe(9);
    saveDailyPlan({ ...(Object.fromEntries(PLAN_KINDS.map((kind) => [kind, { fresh: 1, review: 0 }])) as any), words: { fresh: 1, review: 3 } });
    expect(getStudyPreferences().reviewCap).toBe(3);
  });

  it("写回按用户看到的那份 view 比对，不重算：view 之后多出 extras / 到期数变了，没拖的段 cap 不动", () => {
    saveDailyPlan({ words: { fresh: 15, review: 400 }, grammar: { fresh: 5, review: 0 }, kanji: { fresh: 5, review: 0 }, confusion: { fresh: 5, review: 0 } });
    expect(getStudyPreferences().reviewCap).toBe(400);
    // 面板挂载时看到 353（341 + 12 减负），之后库里的数怎么变都不关它事
    const seen = dailyPlanView();
    seen.wordExtras = 12;
    seen.segments[0].review = 353;
    const plan = { words: { fresh: 15, review: 353 }, grammar: { fresh: 5, review: 0 }, kanji: { fresh: 5, review: 0 }, confusion: { fresh: 5, review: 0 } };
    saveDailyPlan({ ...plan, grammar: { fresh: 6, review: 0 } }, false, seen);
    expect(getStudyPreferences().reviewCap).toBe(400);
    saveDailyPlan({ ...plan, words: { fresh: 15, review: 360 } }, false, seen);
    expect(getStudyPreferences().reviewCap).toBe(348);
  });

  it("一键安排：复习 = 到期全部，新学 = 平时额度（表单定的算，拖圆环不算；没定过是默认档）", () => {
    store.delete("mn-daily-plan-baseline");
    expect(PLAN_KINDS.map((kind) => arrangedPlan(dailyPlanView())[kind].fresh)).toEqual([15, 5, 5, 5]);
    saveDailyPlan({ words: { fresh: 30, review: 1 }, grammar: { fresh: 5, review: 1 }, kanji: { fresh: 5, review: 1 }, confusion: { fresh: 5, review: 1 } }, true);
    saveDailyPlan({ words: { fresh: 0, review: 1 }, grammar: { fresh: 0, review: 1 }, kanji: { fresh: 0, review: 1 }, confusion: { fresh: 0, review: 1 } });
    const arranged = arrangedPlan(dailyPlanView());
    expect(PLAN_KINDS.map((kind) => arranged[kind].fresh)).toEqual([30, 5, 5, 5]);
    expect(PLAN_KINDS.map((kind) => arranged[kind].review)).toEqual(dailyPlanView().segments.map((segment) => segment.pool.due));
  });

  it("「现在 N几」从数据算：出厂库一个词没学 → 从零；辨析组按最难成员分级", () => {
    expect(learnedLevel()).toBeNull();
    const byLevel = [0, 1, 2, 3, 4].map((rank) => examPreset(["N5", "N4", "N3", "N2", "N1"][rank] as any).remaining.confusion);
    expect(byLevel[0]).toBeGreaterThan(0);
    expect(byLevel).toEqual([...byLevel].sort((a, b) => a - b));
    expect(byLevel[4]).toBeGreaterThan(byLevel[0]);
  });

  it("备考一键：按目标范围内实际未学的行计算，自报本级熟悉度为 0 仍需新学", () => {
    const preset = examPreset("N3");
    expect(preset.remaining.words).toBeGreaterThan(0);
    expect(preset.remaining.grammar).toBeGreaterThan(0);
    expect(preset.plan.words.fresh).toBeLessThanOrEqual(50);
    expect(preset.plan.grammar.fresh).toBeLessThanOrEqual(12);
    expect(preset.plan.words.fresh).toBeGreaterThan(0);
    expect(preset.load.perWeek).toHaveLength(8);
    expect(preset.load.peakWeek).toBeGreaterThanOrEqual(1);
    // 自报 N3 但熟悉度设为 0 时，N3 行仍是未学，不能被「当前 N3」排除。
    expect(examPreset("N3").remaining.words).toBe(preset.remaining.words);
    const wordId = Number(testDb.exec("SELECT id FROM words WHERE jlpt_level='N3' LIMIT 1")[0].values[0][0]);
    testDb.run("UPDATE progress SET seen_count=1 WHERE word_id=?", [wordId]);
    expect(examPreset("N3").remaining.words).toBe(preset.remaining.words - 1);
    testDb.run("UPDATE progress SET seen_count=0 WHERE word_id=?", [wordId]);
    applyExamPreset("N2");
    expect(getStudyPreferences().jlptTarget).toBe("N2");
    expect(getStudyPreferences().dailyGoal).toBe(examPreset("N2").plan.words.fresh);
  });

  it("起点估算每天重算目标范围里的真实未学词，批量标认识也会立即扣除", () => {
    const input = {
      startingLevel: "N4" as const, target: "N3" as const,
      familiarity: { words: 75, grammar: 75, kanji: 75, confusion: 75 },
      today: new Date(2026, 8, 26), examDate: new Date(2026, 11, 6), startedOn: new Date(2026, 8, 22)
    };
    const before = previewCurrentLevelPlan(input);
    const ids = testDb.exec(`
      SELECT p.word_id FROM progress p JOIN words w ON w.id = p.word_id
      WHERE w.jlpt_level = 'N3' AND p.seen_count = 0 AND p.known_forever = 0
      ORDER BY p.word_id LIMIT 100
    `)[0].values.map(([id]) => Number(id));
    expect(ids).toHaveLength(100);
    try {
      testDb.run(`UPDATE progress SET known_forever = 1 WHERE word_id IN (${ids.join(",")})`);
      const after = previewCurrentLevelPlan(input);
      expect(after.content.words).toBe(before.content.words - ids.length);
      expect(after.required.words).toBeLessThan(before.required.words);
    } finally {
      testDb.run(`UPDATE progress SET known_forever = 0 WHERE word_id IN (${ids.join(",")})`);
    }
  });

  it("一键安排之后不会被自己标成「低于建议」：到期超过 500 也照数存（旧上限 500 会截）", () => {
    // 作者 09-26：到期五百多，一键安排完显示「复 511 · 低于建议」—— 存的时候被截成了 500。
    // ⚠️ 放最后：这里把 600 个词改成已学、到期，后面的用例会被它影响。
    testDb.run(
      "UPDATE progress SET seen_count=3, fsrs_lapses=0, fsrs_due='2026-01-01T00:00:00.000Z' WHERE word_id IN (SELECT id FROM words ORDER BY id LIMIT 600)"
    );
    const view = dailyPlanView();
    const words = () => dailyPlanView().segments.find((segment) => segment.kind === "words")!;
    expect(words().suggest.review).toBeGreaterThan(500);
    saveDailyPlan(arrangedPlan(view), false, view);
    expect(words().review).toBe(words().suggest.review);
  });
});
