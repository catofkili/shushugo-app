import { beforeEach, expect, it, vi } from "vitest";
import { byKind } from "./model";
import { applyBudgetMorning, budgetOrder } from "./budget-policy";
import * as allocator from "../plan/budget-allocator";
import type { StudyPreferences } from "../studyPreferences";

const fixture = vi.hoisted(() => ({
  prefs: {} as StudyPreferences, mandatory: 0, history: [] as { d: string; minutes: number }[],
  prior: [] as number[], kanaPending: false, paused: false, intakeDays: 50,
  capAware: false, kanaMinutes: 0, historySql: "", headroom: undefined as number | undefined,
  save: vi.fn((next: StudyPreferences) => { fixture.prefs = { ...next }; return fixture.prefs; })
}));
vi.mock("../plan/budget-allocator", async importOriginal => {
  const actual = await importOriginal<typeof import("../plan/budget-allocator")>();
  return { ...actual, get BUDGET_HEADROOM() { return fixture.headroom ?? actual.BUDGET_HEADROOM; } };
});
vi.mock("../daily-plan", () => ({
  SECONDS_PER_CARD: { words: 12, grammar: 25, kanji: 10, confusion: 40 },
  remainingPlanWords: () => 100,
  dailyPlanView: (prefs: StudyPreferences) => ({ wordExtras: 0, priorExtras: {}, segments: ["words", "grammar", "kanji", "confusion"].map((kind, i) => {
    const cap = prefs[["reviewCap", "grammarReviewCap", "kanjiReviewCap", "confusionReviewCap"][i] as keyof StudyPreferences];
    return { kind, review: fixture.capAware && Number(cap) > 0 ? Math.min(fixture.mandatory, Number(cap)) : fixture.mandatory,
      pool: { unseen: 100 }, suggest: { fresh: 2 } };
  }) })
}));
vi.mock("../database/db-utils", () => ({
  today: () => "2026-11-03", studyDayEnd: () => new Date("2026-11-03T20:00:00Z"),
  rowsFor: (sql: string) => {
    fixture.historySql = sql;
    return [...fixture.history, ...(fixture.kanaMinutes && sql.includes("FROM kana_reviews")
      ? [{ d: "2026-11-02", minutes: fixture.kanaMinutes }] : [])];
  },
  firstValue: (sql: string) => sql.includes("grammar_progress p JOIN grammar_points") ? 100 : 0
}));
vi.mock("../grammar-quiz", () => ({ PLAN_GRAMMAR_LEVEL: "plan", scopeLevels: () => ["N5", "N4", "N3"], grammarReviewEntity: () => ({ eligible: "1" }) }));
vi.mock("../jlpt/status", () => ({ getJlptPlanStatus: () => ({ plan: { intakeDaysLeft: fixture.intakeDays } }) }));
vi.mock("../fsrs-store", () => ({ WORD_FSRS: { eligible: "1" } }));
vi.mock("../prior-pacing", () => ({
  pendingPriorSql: () => "0", forecastPriorReleases: (k: string, ends: Date[]) => k === "words" && fixture.prior.length ? fixture.prior : ends.map(() => 0),
  PRIOR_ENTITIES: { words: { table: "progress", idColumn: "word_id", reviews: "reviews" },
    grammar: { table: "grammar_progress", idColumn: "grammar_id", reviews: "grammar_reviews" },
    kanji: { table: "kanji_char_memory", idColumn: "char", reviews: "kanji_char_reviews" },
    confusion: { table: "confusion_progress", idColumn: "group_key", reviews: "confusion_reviews" } }
}));
vi.mock("../studyPreferences", () => ({
  getStudyPreferences: () => ({ ...fixture.prefs }), getEffectiveStudyPreferences: () => ({ ...fixture.prefs }),
  kanaGatePending: () => fixture.kanaPending, levelAdvanceNewCap: (kind: string) => kind === "words" && fixture.paused ? 12 : null,
  levelAdvanceTarget: () => "N3",
  PLAN_REVIEW_DISABLED: -1, saveStudyPreferences: (next: StudyPreferences) => fixture.save(next)
}));

beforeEach(() => {
  vi.restoreAllMocks(); fixture.headroom = undefined;
  fixture.mandatory = 0; fixture.prior = []; fixture.save.mockClear();
  fixture.capAware = false; fixture.kanaMinutes = 0; fixture.historySql = "";
  fixture.kanaPending = false; fixture.paused = false; fixture.intakeDays = 50;
  fixture.history = [{ d: "2026-11-02", minutes: 100 }];
  fixture.prefs = { dailyGoal: 40, grammarDailyGoal: 5, kanjiDailyGoal: 5, confusionDailyGoal: 2,
    reviewCap: 0, grammarReviewCap: 0, kanjiReviewCap: 0, confusionReviewCap: 0,
    jlptPlanEnabled: true, includeOptionalExpressions: false, theme: "dark" } as StudyPreferences;
});

it("0/0段也不关闭复习cap，非过载仅写未钉住新学，其余偏好逐字段不变", () => {
  const before = { ...fixture.prefs };
  const out = applyBudgetMorning({ locked: { words: { fresh: 40 } }, baseline: before, days: [] });
  expect(out.overloaded).toBe(false);
  expect(fixture.save).toHaveBeenCalledOnce();
  expect(fixture.prefs).toEqual({ ...before, grammarDailyGoal: 3, kanjiDailyGoal: 3, confusionDailyGoal: 3 });
  expect(out.appliedFresh).toEqual({ ...byKind(() => 3), words: 40 });
});

it("过载才写普通复习cap，钉住的复习/新学与非额度字段保持原值", () => {
  fixture.mandatory = 100;
  fixture.prefs.grammarReviewCap = 20;
  const before = { ...fixture.prefs };
  const out = applyBudgetMorning({ locked: { words: { fresh: 40 }, grammar: { review: 20 } }, baseline: before, days: [] });
  expect(out.overloaded).toBe(true);
  expect(fixture.prefs.dailyGoal).toBe(40);
  expect(fixture.prefs.grammarReviewCap).toBe(20);
  expect(fixture.prefs.reviewCap).toBeGreaterThan(0);
  expect(fixture.prefs.theme).toBe("dark");
  expect(fixture.prefs.grammarDailyGoal).toBe(0);
});

it("按完成比例而非已做张数选类，平手固定单词→语法→汉字→辨析", () => {
  expect(budgetOrder(byKind(() => 10), byKind(() => 0))).toEqual(["words", "grammar", "kanji", "confusion"]);
  expect(budgetOrder({ words: 100, grammar: 10, kanji: 20, confusion: 4 },
    { words: 30, grammar: 2, kanji: 10, confusion: 0 })).toEqual(["confusion", "grammar", "words", "kanji"]);
});

it("只有观测到的完成日能触发预算增长，不能把已有答题历史当成完成清单", () => {
  fixture.history = Array.from({ length: 7 }, (_, i) => ({ d: `2026-10-${31 - i}`, minutes: 20 }));
  const baseline = { ...fixture.prefs };
  expect(applyBudgetMorning({ locked: {}, baseline, days: [] }).B).toBe(20);
  const days = fixture.history.slice(0, 4).map(row => ({ date: row.d, completed: true }));
  expect(applyBudgetMorning({ locked: {}, baseline, days }).B).toBe(24);
  expect(applyBudgetMorning({ locked: {}, baseline, days: days.slice(0, 3) }).B).toBe(20);
});

it("冷启动预算使用计划量的28天峰值，不能因自己的新额度写回而递归变小", () => {
  fixture.history = [];
  const baseline = { ...fixture.prefs };
  const firstBudget = applyBudgetMorning({ locked: {}, baseline, days: [] }).B;
  expect(firstBudget).toBeCloseTo(23.40714285714285);
  expect(fixture.prefs.dailyGoal).toBeLessThan(baseline.dailyGoal);
  expect(applyBudgetMorning({ locked: {}, baseline, days: [] }).B).toBe(firstBudget);
});

it("ρ只在推断完成后乘给分配器；冷启动和保存的B保持原值，今日仍占放大预算的0.6", () => {
  fixture.history = [];
  const solve = vi.spyOn(allocator, "allocateDay");
  const baseline = { ...fixture.prefs };
  const out = applyBudgetMorning({ locked: {}, baseline, days: [] });
  expect(out.B).toBeCloseTo(23.40714285714285);
  expect(solve.mock.calls[0][0]).toMatchObject({ budgetMinutes: 1e9, maxScale: 1, previousFresh: undefined });
  expect(solve.mock.calls[0][0].todayBudgetMinutes).toBeUndefined();
  expect(solve.mock.calls[1][0]).toMatchObject({ budgetMinutes: out.B * allocator.BUDGET_HEADROOM,
    todayBudgetMinutes: out.B * allocator.BUDGET_HEADROOM * 0.6 });
  fixture.history = [{ d: "2026-11-02", minutes: 20 }];
  const next = applyBudgetMorning({ locked: {}, baseline,
    days: [{ date: "2026-11-02", completed: true, budget: { ...out, B: 40, scale: 0.5 } }] });
  expect(next.B).toBe(40); // 只有一个完成日，不增长；不能把40×ρ写回再叠乘。
  expect(solve.mock.calls[3][0].budgetMinutes).toBe(40 * allocator.BUDGET_HEADROOM);
});

it("ρ=1时沿用d的两个预算入参；未来峰值恰好等于B的边界不添新也不过载", () => {
  fixture.headroom = 1;
  fixture.history = [{ d: "2026-11-02", minutes: 20 }];
  fixture.prior = [999, ...Array(27).fill(0), 100];
  const solve = vi.spyOn(allocator, "allocateDay");
  const out = applyBudgetMorning({ locked: {}, baseline: { ...fixture.prefs }, days: [] });
  expect(solve.mock.calls[1][0]).toMatchObject({ budgetMinutes: 20, todayBudgetMinutes: 12 });
  expect(out).toMatchObject({ B: 20, M0: 0, overloaded: false,
    peakMinutes: 20, fresh: byKind(() => 0), appliedFresh: byKind(() => 0), need: byKind(() => 2),
    contentLeft: byKind(() => 100), paused: byKind(() => false) });
});

it("同一应用输入下ρ单调放宽两个限额；不能放大need、冷启动、锁定40或进新窗口", () => {
  fixture.history = [{ d: "2026-11-02", minutes: 20 }];
  const solve = vi.spyOn(allocator, "allocateDay");
  const baseline = { ...fixture.prefs };
  for (const rho of [1, 1.25, 1.5, 2]) {
    fixture.headroom = rho; fixture.prefs = { ...baseline };
    const out = applyBudgetMorning({ locked: { words: { fresh: 40 } }, baseline, days: [] });
    expect(out.B).toBe(20);
    expect(out.need).toEqual(byKind(() => 2));
    expect(out.appliedFresh.words).toBe(40);
    expect(solve.mock.calls[solve.mock.calls.length - 1][0]).toMatchObject({
      budgetMinutes: 20 * rho, todayBudgetMinutes: 12 * rho });
  }
  fixture.intakeDays = 0;
  expect(applyBudgetMorning({ locked: {}, baseline, days: [] }).fresh).toEqual(byKind(() => 0));
});

it("缺席日不能重复消费上次完成证据让B继续增长", () => {
  fixture.history = Array.from({ length: 7 }, (_, i) => ({ d: `2026-10-${31 - i}`, minutes: 20 }));
  const baseline = { ...fixture.prefs };
  const previous = { ...applyBudgetMorning({ locked: {}, baseline, days: [] }), B: 40, scale: 0.5 };
  const days = fixture.history.slice().reverse().map(row => ({ date: row.d, completed: true, budget: previous }));
  expect(applyBudgetMorning({ locked: {}, baseline, days }).B).toBeGreaterThan(40);
  expect(applyBudgetMorning({ locked: {}, baseline,
    days: [...days, { date: "2026-11-02", completed: false, budget: previous }] }).B).toBe(40);
});

it("先验预测去掉今天、保留第28天，不能把同一批先验重复算到明天", () => {
  fixture.history = [{ d: "2026-11-02", minutes: 20 / allocator.BUDGET_HEADROOM }];
  // 今日999张不进入未来；第28天100张单词恰好用满20分钟，必须挡住额外新学。
  fixture.prior = [999, ...Array(27).fill(0), 100];
  const out = applyBudgetMorning({ locked: {}, baseline: { ...fixture.prefs }, days: [] });
  expect(out.M0).toBe(0);
  expect(out.peakMinutes).toBe(20);
  expect(out.overloaded).toBe(false);
  expect(out.fresh).toEqual(byKind(() => 0));
});

it.each(["五十音门槛", "用户先不加"])("%s阻止自动新词，不能因范围仍有未学内容就重新打开", reason => {
  fixture.kanaPending = reason === "五十音门槛";
  fixture.paused = reason === "用户先不加";
  const out = applyBudgetMorning({ locked: {}, baseline: { ...fixture.prefs }, days: [] });
  expect(out.contentLeft.words).toBe(100);
  expect(out.need.words).toBe(0);
  expect(out.fresh.words).toBe(0);
  expect(fixture.prefs.dailyGoal).toBe(0);
  expect(out.need.grammar).toBe(2);
  expect(out.fresh.grammar).toBeGreaterThan(0);
});

it("备考进新窗口结束后四类不再自动添新，无考期则沿用原强度", () => {
  fixture.intakeDays = 0;
  const baseline = { ...fixture.prefs };
  const exam = applyBudgetMorning({ locked: {}, baseline, days: [] });
  expect(exam.contentLeft).toEqual(byKind(() => 100));
  expect(exam.need).toEqual(byKind(() => 0));
  expect(exam.fresh).toEqual(byKind(() => 0));
  fixture.prefs.jlptPlanEnabled = false;
  const casual = applyBudgetMorning({ locked: {}, baseline, days: [] });
  expect(casual.need).toEqual({ words: 40, grammar: 5, kanji: 5, confusion: 2 });
  expect(casual.fresh.words).toBeGreaterThan(0);
});

it("非过载日恢复基线cap，用户钉住的复习上限仍保持原值", () => {
  const baseline = { ...fixture.prefs };
  Object.assign(fixture.prefs, { reviewCap: 9, grammarReviewCap: 20, kanjiReviewCap: 6, confusionReviewCap: 1 });
  const out = applyBudgetMorning({ locked: { grammar: { review: 20 } }, baseline, days: [] });
  expect(out.overloaded).toBe(false);
  expect([fixture.prefs.reviewCap, fixture.prefs.grammarReviewCap, fixture.prefs.kanjiReviewCap, fixture.prefs.confusionReviewCap])
    .toEqual([0, 20, 0, 0]);
});

it("先按将恢复的cap计算M0，不能按昨日低cap求解后突然放大真实清单", () => {
  const baseline = { ...fixture.prefs };
  fixture.capAware = true; fixture.mandatory = 100;
  fixture.history = [{ d: "2026-11-02", minutes: 20 / allocator.BUDGET_HEADROOM }];
  Object.assign(fixture.prefs, { reviewCap: 1, grammarReviewCap: 1, kanjiReviewCap: 1, confusionReviewCap: 1 });
  const out = applyBudgetMorning({ locked: {}, baseline, days: [] });
  expect(out.M0).toBeCloseTo(145);
  expect(out.overloaded).toBe(true);
  expect(out.fresh).toEqual(byKind(() => 0));
  expect([fixture.prefs.reviewCap, fixture.prefs.grammarReviewCap, fixture.prefs.kanjiReviewCap, fixture.prefs.confusionReviewCap])
    .toEqual([8, 8, 8, 8]); // 放大后预算20，今日限额12分钟，普通复习不再乘1.2。
});

it("仅做五十音的日子也进入预算历史，不再退回冷启动", () => {
  fixture.history = []; fixture.kanaMinutes = 24;
  const out = applyBudgetMorning({ locked: {}, baseline: { ...fixture.prefs }, days: [] });
  expect(fixture.historySql).toContain("FROM kana_reviews WHERE reviewed_on < ?");
  expect(out.B).toBe(24);
});

it("过载分到零张时单词cap仍最低为1，其它类使用关闭哨兵", () => {
  fixture.mandatory = 100;
  fixture.history = [{ d: "2026-11-02", minutes: 0.01 }];
  applyBudgetMorning({ locked: {}, baseline: { ...fixture.prefs }, days: [] });
  expect(fixture.prefs.reviewCap).toBe(1);
  expect([fixture.prefs.grammarReviewCap, fixture.prefs.kanjiReviewCap, fixture.prefs.confusionReviewCap]).toEqual([-1, -1, -1]);
});
