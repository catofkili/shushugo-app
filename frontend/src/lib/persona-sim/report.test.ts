import { expect, it } from "vitest";
import { renderComparison, type Summary } from "./report";
import { byKind, metricsFor, PERSONAS, type Daily, type Run } from "./model";

const summary = (policy: "current" | "budget"): Summary => ({
  gitHead: "same-head", sourceHash: "same-source", simulationHash: `hash-${policy}`, policy, liveHash: "same-db", factoryHash: "same-factory", smoke: false,
  generatedAt: "2026-11-03", wallSecondsThisCommand: 0, calibration: {} as Summary["calibration"],
  personas: ["break", "cram-lock"].map(id => {
    const parameters = PERSONAS.find(p => p.id === id)!;
    const days: Daily[] = Array.from({ length: 20 }, (_, i) => ({ seed: i + 1, day: 1, date: "2026-11-03", baseMinutes: 30,
      availableMinutes: 30, actualMinutes: 10, shouldMinutes: 20, active: true, absence: "none", absenceProbability: 0.1,
      cards: byKind(() => ({ planned: 1, plannedFresh: 1, releasedPrior: 0, answers: 1, fresh: 1, prior: 0, review: 0, relearn: 0, reviewCorrect: 0,
        backlog: 0, pendingPrior: 0, scheduledRemaining: 0 })),
      quotas: byKind(k => ({ savedFresh: 40, effectiveFresh: 40, savedReview: 0, effectiveReview: 1, reasons: [],
        ...(id === "cram-lock" && k === "words" ? { lockedFresh: 40 } : {}) })),
      feasible: true, kana: { planned: 0, taught: 0, wordTaught: 0, answers: 0, mastered: 0 }, relief: 0, tail: 0,
      ...(policy === "budget" ? { budget: { B: 20, M0: 10, scale: 1, overloaded: false, peakMinutes: 20,
        fresh: byKind(() => 1), appliedFresh: byKind(() => 1), need: byKind(() => 1), contentLeft: byKind(() => 10), paused: byKind(() => false) } } : {}) }));
    const runs: Run[] = days.map(d => ({ seed: d.seed, days: [d], transitions: [], events: [], selfGap: null,
      coverage: { day: 1, date: d.date, reason: "lastDay", cards: byKind(() => ({ seen: 1, total: 2, percent: 50, stateSeen: 1, statePercent: 50 })) } }));
    return { id, name: parameters.name, seeds: 20, days: 1, parameters, initial: {} as Summary["personas"][number]["initial"], elapsedSeconds: 0,
      daily: days, metrics: metricsFor(runs) };
  })
});

it("输出逐人设M1–M6、B推断和全部验收线，缺事件不能伪装通过", () => {
  const report = renderComparison(summary("current"), summary("budget"));
  for (const text of ["## 验收线", "✅", "❌", "B 日中位数/人设基准", "M1", "M2", "M3", "M4", "M5", "M6", "PRIOR_QUOTA_MAX", "cram-lock"]) expect(report).toContain(text);
  expect(report).toContain("共同代码指纹");
  expect(report).toContain("安排少→观测作答少→B偏低");
  expect(report).toContain("非过载日保留前日存值，不自动恢复自动档");
  expect(report).toContain("不读取人设脚本预知未来会点哪个按钮");
});

it("代码、库、种子或逐日数据不一致时拒绝生成", () => {
  for (const mutate of [
    (s: Summary) => { s.sourceHash = "different"; },
    (s: Summary) => { s.liveHash = "different"; },
    (s: Summary) => { s.factoryHash = "different"; },
    (s: Summary) => { s.gitHead = "different"; },
    (s: Summary) => { s.smoke = true; },
    (s: Summary) => { s.calibration = { changed: true } as unknown as Summary["calibration"]; },
    (s: Summary) => { s.personas[0].parameters = { ...s.personas[0].parameters, absence: 0.99 }; },
    (s: Summary) => { s.personas[0].initial = { changed: true } as unknown as typeof s.personas[0]["initial"]; },
    (s: Summary) => { s.personas[0].daily[0].date = "2026-11-04"; },
    (s: Summary) => { s.personas[0].daily[0].availableMinutes++; },
    (s: Summary) => { delete s.personas[0].daily[0].budget; },
    (s: Summary) => { s.personas[0].seeds--; },
    (s: Summary) => { s.personas[0].daily.pop(); },
    (s: Summary) => { s.personas[0].daily[0].seed = 999; }
  ]) {
    const budget = summary("budget"); mutate(budget);
    expect(() => renderComparison(summary("current"), budget)).toThrow();
  }
});

it("M5分别统计锁定值在存值和生效层被覆盖的天数", () => {
  const saved = summary("current").personas[1];
  const runs = saved.daily.slice(0, 3).map((day, i) => {
    const d = structuredClone(day);
    if (i === 0) d.quotas.words.savedFresh = 39;
    if (i === 1) d.quotas.words.effectiveFresh = 0;
    return { seed: d.seed, days: [d], transitions: [], events: [], selfGap: null,
      coverage: { day: 1, date: d.date, reason: "lastDay", cards: byKind(() => ({ seen: 0, total: 1, percent: 0, stateSeen: 0, statePercent: 0 })) } };
  });
  expect(metricsFor(runs).M5.lockedChangedDays).toMatchObject({ median: 1, worst: 1 });
});

const transitionSummary = (policy: "current" | "budget", eventDays: number[]): Summary => {
  const result = summary(policy);
  for (const p of result.personas) {
    const runs: Run[] = p.daily.map(template => ({ seed: template.seed,
      days: Array.from({ length: 22 }, (_, i) => ({ ...structuredClone(template), day: i + 1,
        date: `2026-11-${String(i + 1).padStart(2, "0")}` })),
      transitions: eventDays.map(day => ({ seed: template.seed, day, kind: "words", type: "content", from: "N4", to: "N3" })),
      events: [], selfGap: null,
      coverage: { day: 22, date: "2026-11-22", reason: "lastDay", cards: byKind(() => ({ seen: 1, total: 2, percent: 50, stateSeen: 1, statePercent: 50 })) }
    }));
    p.days = 22; p.daily = runs.flatMap(run => run.days); p.metrics = metricsFor(runs);
  }
  return result;
};

it("M2按题型前7天中位数及当天起15天峰值计算，预算归零仍计继续却零新学", () => {
  const template = summary("budget").personas[0].daily[0];
  const days = Array.from({ length: 23 }, (_, i) => {
    const d = structuredClone(template);
    d.day = i + 1;
    d.cards.words.planned = i < 7 ? [2, 4, 6, 8, 10, 12, 100][i] : i === 17 ? 24 : i === 22 ? 999 : 9;
    d.budget!.B = 9999; d.shouldMinutes = 5000;
    if (d.day === 9 || d.day === 10) {
      d.cards.words.fresh = 0;
      d.quotas.words.effectiveFresh = 0;
    }
    return d;
  });
  const result = metricsFor([{ seed: template.seed, days, events: [], selfGap: null,
    transitions: [{ seed: template.seed, day: 8, kind: "words", type: "content", from: "N4", to: "N3" },
      { seed: template.seed, day: 8, kind: "grammar", type: "prompt", from: "N3", to: "N3", choice: "pause" }],
    coverage: { day: 23, date: days[22].date, reason: "lastDay", cards: byKind(() => ({ seen: 1, total: 2, percent: 50, stateSeen: 1, statePercent: 50 })) }
  }]);
  expect(result.M2.events).toHaveLength(2);
  expect(result.M2.events[0]).toMatchObject({ ratio: 3, beforeDays: 7, afterDays: 15, truncated: false,
    noFreshDays: 0, continuingNoFreshDays: 2 });
  expect(result.M2.events[1].continuingNoFreshDays).toBeNull();
  expect(result.M2.byKind.words.continuingNoFreshDays).toMatchObject({ median: 2, worst: 2, samples: 1 });
});

it.each([[22], [7], [9], [8, 22]])("20种子也不能凭截尾交接窗口验收M2：交接日%s", (...eventDays) => {
  const report = renderComparison(transitionSummary("current", eventDays), transitionSummary("budget", eventDays));
  const rows = report.split("\n").filter(line => line.startsWith("| M2 break/单词"));
  expect(rows).toHaveLength(2);
  for (const row of rows) { expect(row).toContain("❌"); expect(row).toContain("未验收"); }
});

it("完整7天前窗和15天后窗、20种子均达线时，两项M2才能通过", () => {
  const report = renderComparison(transitionSummary("current", [8]), transitionSummary("budget", [8]));
  const rows = report.split("\n").filter(line => line.startsWith("| M2 break/单词"));
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row).toContain("✅");
});

it("M1基准、推断B及M2前7后15天分开说明，交接事件与完整窗口分别计数", () => {
  const report = renderComparison(transitionSummary("current", [8, 22]), transitionSummary("budget", [8, 22]));
  expect(report).toContain("M2不以时间预算作分母");
  expect(report).toContain("交接当天起15天该题型的最大晨间清单");
  expect(report).toContain("交接前7天该题型清单的中位数");
  expect(report.split("\n").filter(row => row === "| M2 单词交接观测（事件/完整窗口/有比值种子） | 40 / 20 / 20 | 40 / 20 / 20 |")).toHaveLength(2);
  expect(report.split("\n").filter(row => row === "| M2 语法交接观测（事件/完整窗口/有比值种子） | 0 / 0 / 0 | 0 / 0 / 0 |")).toHaveLength(2);
});

it("M2的有效交接种子少于20也须标未验收", () => {
  const budget = transitionSummary("budget", [8]);
  budget.personas[0].metrics.M2.events = budget.personas[0].metrics.M2.events.filter(e => e.seed !== 20);
  for (const key of ["ratio", "continuingNoFreshDays"] as const) budget.personas[0].metrics.M2.byKind.words[key]!.samples = 19;
  const report = renderComparison(transitionSummary("current", [8]), budget);
  const rows = report.split("\n").filter(line => line.startsWith("| M2 break/单词"));
  expect(rows).toHaveLength(2);
  for (const row of rows) { expect(row).toContain("❌"); expect(row).toContain("未验收"); }
});

it("保持率只算跨日首答，新学数和积压按种子汇总；少跑天数须在开头写明", () => {
  const current = summary("current"), budget = summary("budget");
  for (const result of [current, budget]) for (const p of result.personas) for (const d of p.daily) {
    d.cards.words.review = 4;
    d.cards.words.reviewCorrect = result.policy === "current" ? 3 : 2;
    d.cards.words.relearn = 20;
    d.cards.words.backlog = 9;
  }
  const report = renderComparison(current, budget);
  expect(report.split("\n")[2]).toContain("规模未达到完整设计");
  expect(report).toContain("| 单词跨日复习首答保持率 | 75% / 75% / 75% | 50% / 50% / 50% |");
  expect(report).toContain("| 单词跨日复习首答样本数 | 4 / 4 / 4 | 4 / 4 / 4 |");
  expect(report).toContain("| 单词全期新学数（去先验） | 1 / 1 / 1 | 1 / 1 / 1 |");
  expect(report).toContain("| 最后一天到期积压（四类合计） | 9 / 9 / 9 | 9 / 9 / 9 |");
  expect(report).toContain("| 单词日终到期积压峰值 | 9 / 9 / 9 | 9 / 9 / 9 |");
  expect(report).toContain("| 单词最后一天到期积压 | 9 / 9 / 9 | 9 / 9 / 9 |");
  expect(report).toContain("current最重单日：seed 20，D1（2026-11-03），应做20分钟、可用30、实做10；日终积压（单词/语法/汉字/辨析）9 / 0 / 0 / 0。");
  expect(report).toContain("| 每日应做/可用（可用>0，每种子日中位数） | 0.67倍 / 0.67倍 / 0.67倍 | 0.67倍 / 0.67倍 / 0.67倍 |");
  expect(report).toContain("| 应做超可用天数（可用>0，含缺席日潜在清单） | 0 / 0 / 0 | 0 / 0 / 0 |");
});

it("逐日数组倒序也按最后模拟日统计积压，不能把数组尾部当末日", () => {
  const current = transitionSummary("current", [8]), budget = transitionSummary("budget", [8]);
  for (const result of [current, budget]) for (const p of result.personas) for (const d of p.daily) d.cards.words.backlog = d.day === 22 ? 3 : 9;
  for (const p of budget.personas) p.daily.reverse();
  expect(renderComparison(current, budget)).toContain("| 最后一天到期积压（四类合计） | 3 / 3 / 3 | 3 / 3 / 3 |");
});

it("真实晨间清单和含重学的实做分别对比推断B，不能拿预测峰值冒充实际用时", () => {
  const current = summary("current"), budget = summary("budget");
  for (const p of budget.personas) for (const d of p.daily) {
    d.budget!.B = 10;
    d.budget!.peakMinutes = 10;
    d.shouldMinutes = 20;
    d.actualMinutes = 15;
  }
  const report = renderComparison(current, budget);
  expect(report).toContain("| B 每日晨间应做/推断预算（日中位数） | — | 2倍 / 2倍 / 2倍 |");
  expect(report).toContain("| B 每日实做（有学日）/推断预算（日中位数） | — | 1.5倍 / 1.5倍 / 1.5倍 |");
  expect(report).toContain("| B 晨间应做超推断预算×1.2天数 | — | 1 / 1 / 1 |");
});

it("没有跨日复习的种子不填零保持率，也不能隐去有效种子数", () => {
  const current = summary("current"), budget = summary("budget");
  for (const p of budget.personas) {
    p.daily[0].cards.words.review = 1;
    p.daily[0].cards.words.reviewCorrect = 1;
  }
  const report = renderComparison(current, budget);
  expect(report).toContain("| 单词保持率有样本种子数 | 0/20 | 1/20 |");
  expect(report).toContain("| 单词跨日复习首答保持率 | 不适用（无事件或分母为0） | 100% / 100% / 100% |");
});

it("重复人设不能冒充有效样本", () => {
  const current = summary("current"), budget = summary("budget");
  for (const result of [current, budget]) result.personas.push(result.personas[0]);
  expect(() => renderComparison(current, budget)).toThrow("人设集合");
});

it("20个种子只跑一天，不能验收全期峰值、缺席、覆盖或锁定值", () => {
  const report = renderComparison(summary("current"), summary("budget"));
  const rows = report.split("\n").filter(line => line.startsWith("| M1 break") || line.startsWith("| M6 break")
    || line.startsWith("| M4 break/") || line.startsWith("| cram-lock 单词新学"));
  expect(rows).toHaveLength(7);
  for (const row of rows) { expect(row).toContain("❌"); expect(row).toContain("未验收"); }
});

it("完整跑完也不能把未设验收线的覆盖项标成通过", () => {
  const current = summary("current"), budget = summary("budget");
  for (const result of [current, budget]) for (const p of result.personas) {
    p.days = p.parameters.days;
    p.daily = p.daily.flatMap(template => Array.from({ length: p.days }, (_, i) => ({ ...structuredClone(template), day: i + 1,
      date: new Date(Date.UTC(2026, 10, i + 1)).toISOString().slice(0, 10) })));
  }
  const rows = renderComparison(current, budget).split("\n").filter(line => line.startsWith("| M4 break/"));
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row).toContain("—（不设验收线）");
    expect(row).not.toContain("✅");
  }
});

it("全期样本齐全但漏记一天先验或锁定观测，仍不能验收", () => {
  const current = summary("current"), budget = summary("budget");
  for (const result of [current, budget]) {
    const self = structuredClone(result.personas[1]);
    self.id = "self"; self.parameters = PERSONAS.find(p => p.id === "self")!;
    result.personas.push(self);
    for (const p of result.personas) {
      p.days = p.parameters.days;
      p.daily = p.daily.flatMap(template => Array.from({ length: p.days }, (_, i) => ({ ...structuredClone(template), day: i + 1,
        date: new Date(Date.UTC(2026, 10, i + 1)).toISOString().slice(0, 10), n4GrammarPriorReleased: 5 })));
    }
  }
  const rows = (report: string) => report.split("\n").filter(line => line.startsWith("| 作者本人N4语法先验") || line.startsWith("| cram-lock 单词新学"));
  const complete = rows(renderComparison(current, budget));
  expect(complete).toHaveLength(2);
  for (const row of complete) expect(row).toContain("✅");
  delete budget.personas.find(p => p.id === "self")!.daily[0].n4GrammarPriorReleased;
  delete budget.personas.find(p => p.id === "cram-lock")!.daily[0].quotas.words.lockedFresh;
  const incomplete = rows(renderComparison(current, budget));
  expect(incomplete).toHaveLength(2);
  for (const row of incomplete) {
    expect(row).toContain("❌");
    expect(row).toContain("未覆盖完整观察期，未验收");
  }
});

it("验收小结区分数值失败、观察不足和无验收线，不能把完整运行当成达标", () => {
  const current = summary("current"), budget = summary("budget");
  for (const result of [current, budget]) for (const p of result.personas) {
    p.days = p.parameters.days;
    p.daily = p.daily.flatMap(template => Array.from({ length: p.days }, (_, i) => ({ ...structuredClone(template), day: i + 1,
      date: new Date(Date.UTC(2026, 10, i + 1)).toISOString().slice(0, 10) })));
  }
  budget.personas[0].metrics.M1.peakToBase!.median = 2;
  const report = renderComparison(current, budget);
  expect(report).toContain("验收小结：数值通过3项，数值未达线1项，事件/窗口/观察不足而未验收102项");
  expect(report).toContain("仅报告、不设线的覆盖项不计入通过数");
  expect(report).toContain("设计验收尚未全部通过");
});
