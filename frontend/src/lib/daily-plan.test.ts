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

import { applyExamPreset, arrangedPlan, dailyPlanView, examPreset, hasPendingPlanTotal, learnedLevel, previewCurrentLevelPlan, saveDailyPlan, segmentLength, stampPlanCaps, PLAN_KINDS } from "./daily-plan";
import { getStudyPreferences } from "./studyPreferences";
import { loadKanjiCharData, materializeKanjiChars } from "./kanji-char-cards";
import { materializeConfusionCards } from "./confusion-cards";
import { autoPlanReviewCap, dailyReviewCap } from "./review-budget";
import { fsrsDueWordIds } from "./fsrs-store";
import { studyDayEnd, today } from "./database/db-utils";

describe("每日学习量：视图 / 写回 / 备考一键", () => {
  it("只在每日总量数字和当前值不同时显示保存入口", () => {
    expect(hasPendingPlanTotal(null, 44)).toBe(false);
    expect(hasPendingPlanTotal("44", 44)).toBe(false);
    expect(hasPendingPlanTotal("45", 44)).toBe(true);
    expect(hasPendingPlanTotal("", 44)).toBe(true);
  });

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

  it("一键安排：复习回自动档，新学 = 平时额度（表单定的算，拖圆环不算；没定过是默认档）", () => {
    store.delete("mn-daily-plan-baseline");
    expect(PLAN_KINDS.map((kind) => arrangedPlan(dailyPlanView())[kind].fresh)).toEqual([15, 5, 5, 5]);
    saveDailyPlan({ words: { fresh: 30, review: 1 }, grammar: { fresh: 5, review: 1 }, kanji: { fresh: 5, review: 1 }, confusion: { fresh: 5, review: 1 } }, true);
    saveDailyPlan({ words: { fresh: 0, review: 1 }, grammar: { fresh: 0, review: 1 }, kanji: { fresh: 0, review: 1 }, confusion: { fresh: 0, review: 1 } });
    const arranged = arrangedPlan(dailyPlanView());
    expect(PLAN_KINDS.map((kind) => arranged[kind].fresh)).toEqual([30, 5, 5, 5]);
    expect(PLAN_KINDS.map((kind) => arranged[kind].review)).toEqual(dailyPlanView().segments.map(({ kind, pool }) => Math.min(pool.due, kind === "words" ? dailyReviewCap(0) : autoPlanReviewCap(kind))));
  });

  it("四段安排都回自动档，显示值恰好没变也要重置；先验和减负压轴另算，手动数仍优先", () => {
    const before = getStudyPreferences();
    try {
      store.set("mn-study-preferences", JSON.stringify({ ...before, reviewCap: 621, grammarReviewCap: 20, kanjiReviewCap: 15, confusionReviewCap: 8 }));
      const shown = dailyPlanView();
      shown.wordExtras = 4;
      shown.priorExtras = { words: 8, grammar: 5, kanji: 5, confusion: 5 };
      shown.segments.forEach(segment => { segment.pool.due = 600; });
      const arranged = arrangedPlan(shown);
      expect(PLAN_KINDS.map(kind => arranged[kind].review)).toEqual([dailyReviewCap(0) + 12, 25, 20, 13]);
      shown.segments.forEach(segment => { segment.review = arranged[segment.kind].review; });
      saveDailyPlan(arranged, false, shown);
      const caps = () => {
        const p = getStudyPreferences();
        return [p.reviewCap, p.grammarReviewCap, p.kanjiReviewCap, p.confusionReviewCap];
      };
      expect(caps()).toEqual([0, 0, 0, 0]);
      saveDailyPlan(Object.fromEntries(PLAN_KINDS.map((kind, i) => [kind, { ...arranged[kind], review: [412, 75, 55, 35][i] }])) as typeof arranged, false, shown);
      expect(caps()).toEqual([400, 70, 50, 30]);
    } finally {
      store.set("mn-study-preferences", JSON.stringify(before));
    }
  });

  it.each([0, -1, 600])("只把新学降为 0，保留原复习 cap=%s，不把先验或压轴重复计入", reviewCap => {
    const before = getStudyPreferences();
    store.set("mn-study-preferences", JSON.stringify({ ...before, dailyGoal: 25, reviewCap }));
    const shown = dailyPlanView();
    shown.wordExtras = 4;
    shown.priorExtras = { words: 8 };
    shown.segments[0].fresh = 25;
    shown.segments[0].review = 612;
    const plan = Object.fromEntries(shown.segments.map(segment => [segment.kind, { fresh: segment.fresh, review: segment.review }])) as Parameters<typeof saveDailyPlan>[0];
    saveDailyPlan({ ...plan, words: { fresh: 0, review: 612 } }, false, shown);
    expect(getStudyPreferences().dailyGoal).toBe(0);
    expect(getStudyPreferences().reviewCap).toBe(reviewCap);
    store.set("mn-study-preferences", JSON.stringify(before));
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

  it("一键安排不把 600 个到期词写成长期上限：自动档最多 150，手动 400 仍优先", () => {
    const before = getStudyPreferences();
    dailyPlanView(); // 先完成首次回填，避免它改写受控到期集。
    testDb.run("SAVEPOINT arrange_cap");
    try {
      testDb.run("UPDATE progress SET known_forever=1");
      testDb.run("UPDATE progress SET known_forever=0, seen_count=3, fsrs_lapses=0, fsrs_due='2026-01-01T00:00:00.000Z' WHERE word_id IN (SELECT id FROM words ORDER BY id LIMIT 600)");
      testDb.run("DELETE FROM reviews");
      testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at) SELECT id, 'know', 0, date(?, '-1 day'), datetime(?, '-1 day') FROM words ORDER BY id LIMIT 400", [today(), today()]);
      expect(dailyReviewCap(0)).toBe(150);
      for (const reviewCap of [0, 621]) {
        store.set("mn-study-preferences", JSON.stringify({ ...before, reviewCap }));
        const shown = dailyPlanView();
        expect(shown.segments[0].pool.due).toBe(600);
        const arranged = arrangedPlan(shown);
        saveDailyPlan(arranged, false, shown);
        expect(getStudyPreferences().reviewCap).toBe(0);
        expect(arranged.words.review).toBe(150);
        expect(dailyPlanView().segments[0].review).toBe(150);
        expect(fsrsDueWordIds(dailyReviewCap(getStudyPreferences().reviewCap), studyDayEnd())).toHaveLength(150);
        // 保留一键安排返回值上的字段再拖动，也必须识别为手动 400。
        saveDailyPlan({ ...arranged, words: { ...arranged.words, review: 400 } }, false, dailyPlanView());
        expect(getStudyPreferences().reviewCap).toBe(400);
      }
    } finally {
      testDb.run("ROLLBACK TO arrange_cap");
      testDb.run("RELEASE arrange_cap");
      store.set("mn-study-preferences", JSON.stringify(before));
    }
  });

  it("到期超过 500，一键安排也只显示自动档名额，不再把全到期数存成固定上限", () => {
    // 09-26 曾要求五百多照存；11-12 改成自动档，仍允许用户另行手动保存 400 等固定值。
    // ⚠️ 放最后：这里把 600 个词改成已学、到期，后面的用例会被它影响。
    testDb.run(
      "UPDATE progress SET seen_count=3, fsrs_lapses=0, fsrs_due='2026-01-01T00:00:00.000Z' WHERE word_id IN (SELECT id FROM words ORDER BY id LIMIT 600)"
    );
    const view = dailyPlanView();
    const words = () => dailyPlanView().segments.find((segment) => segment.kind === "words")!;
    expect(words().pool.due).toBeGreaterThan(500);
    // 建议复习数也是自动档的数，不是全部到期：否则面板标「偏少」、「补到建议值」又把全到期数写成固定上限。
    expect(words().suggest.review).toBe(Math.min(words().pool.due, dailyReviewCap(0)));
    saveDailyPlan(arrangedPlan(view), false, view);
    expect(getStudyPreferences().reviewCap).toBe(0);
    expect(words().review).toBe(Math.min(words().pool.due, dailyReviewCap(0)));
    expect(words().review).toBe(words().suggest.review);
  });

  it("撤回一键安排：快照带着当时的 cap，撤回后四类上限原样回来（接上一个用例的 600 个到期词）", () => {
    const before = getStudyPreferences();
    const caps = () => {
      const p = getStudyPreferences();
      return [p.reviewCap, p.grammarReviewCap, p.kanjiReviewCap, p.confusionReviewCap];
    };
    try {
      store.set("mn-study-preferences", JSON.stringify({ ...before, reviewCap: 400, grammarReviewCap: 20, kanjiReviewCap: 15, confusionReviewCap: 8 }));
      const shown = dailyPlanView();
      const plan = Object.fromEntries(shown.segments.map((segment) => [segment.kind, { fresh: segment.fresh, review: segment.review }])) as ReturnType<typeof arrangedPlan>;
      const snapshot = stampPlanCaps(plan); // 面板在落盘之前压栈
      saveDailyPlan(arrangedPlan(shown), false, shown);
      expect(caps()).toEqual([0, 0, 0, 0]);
      saveDailyPlan(snapshot, false, shown); // 撤回
      expect(caps()).toEqual([400, 20, 15, 8]);
      // 撤回之后在这份快照上手动改单词复习：数字对不上 keep[0]，按手动值存，不会被旧 cap 盖回去
      saveDailyPlan({ ...snapshot, words: { ...snapshot.words, review: 300 } }, false, dailyPlanView());
      expect(getStudyPreferences().reviewCap).toBe(300);
      // 没带 keep 的旧式撤回（只有数字）还原不了 cap —— 这就是要 stampPlanCaps 的原因
      saveDailyPlan(arrangedPlan(shown), false, shown);
      saveDailyPlan(plan, false, shown);
      expect(getStudyPreferences().reviewCap).toBe(0);
    } finally {
      store.set("mn-study-preferences", JSON.stringify(before));
    }
  });
});
