import type { PlanKind } from "../plan-level-order";
import type { StartingLevel } from "../level-plan";
import type { JlptTarget } from "../jlpt/plan";

export const KINDS: PlanKind[] = ["words", "grammar", "kanji", "confusion"];
export const byKind = <T>(make: (kind: PlanKind) => T): Record<PlanKind, T> =>
  Object.fromEntries(KINDS.map(kind => [kind, make(kind)])) as Record<PlanKind, T>;
export const median = (values: number[]) => percentile(values, 0.5);
export const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * p;
  return sorted[Math.floor(position)] + (sorted[Math.ceil(position)] - sorted[Math.floor(position)]) * (position % 1);
};
export const round = (n: number) => Math.round(n * 1e6) / 1e6;
export const ratio = (a: number, b: number): number | null => b > 0 ? round(a / b) : null;
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const DAY_MS = 86_400_000;
// 所有日期固定，不用执行机器的当前日；D1 为冻结副本最后作答日的次日。
export const dateAt = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const mulberry32 = (seed: number) => () => {
  let t = seed += 0x6D2B79F5;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
export const seedFor = (id: string, seed: number, stream: string) => {
  let hash = 2166136261;
  for (const ch of `${id}:${seed}:${stream}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return hash >>> 0;
};
export const logNormal = (random: () => number) =>
  Math.exp(0.3 * Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random()))) * Math.cos(2 * Math.PI * random()));
export const burdenProbability = (base: number, should: number, minutes: number) =>
  Math.min(0.6, base + (minutes > 0 ? 0.15 * Math.max(0, should / minutes - 1) : 0));
export const reviewProbability = (r: number, coefficient: number, minutes: number) =>
  clamp(r * coefficient * (1 - 0.1 * Math.min(1, minutes / 60)), 0.02, 0.99);

export interface Persona {
  id: string; name: string; start: StartingLevel; target: JlptTarget; days: number;
  minutes: number; absence: number; coefficient: Record<PlanKind, number>;
  first: Record<PlanKind, number>; prior: number; examDays: number;
}
const person = (id: string, name: string, start: StartingLevel, target: JlptTarget,
  days: number, minutes: number, absence: number, coefficient: number, first: number, examDays: number): Persona =>
  ({ id, name, start, target, days, minutes, absence, coefficient: byKind(() => coefficient), first: byKind(() => first), prior: 0.8, examDays });
export const PERSONAS: Persona[] = [
  person("self", "作者本人", "N4", "N3", 60, 0, 0, 1, 0.4, 0),
  { ...person("zero", "零基础，从五十音开始", "kana-none", "N4", 90, 25, 0.15, 0.95, 0.35, 180),
    first: { words: 0.35, grammar: 0.40, kanji: 0.30, confusion: 0.30 } },
  person("cram", "考前60天冲刺", "N4", "N3", 60, 75, 0.05, 1, 0.45, 60),
  person("office", "上班族", "N5", "N3", 90, 15, 0.10, 0.95, 0.40, 240),
  person("break", "断两周再回来", "N5", "N3", 90, 30, 0.10, 0.95, 0.40, 180),
  person("fast", "正确率高、想快进", "N4", "N2", 90, 40, 0.05, 1.1, 0.60, 180),
  person("struggle", "正确率低、吃力", "N5", "N4", 90, 25, 0.20, 0.80, 0.25, 180),
  person("light", "考完N3不再备考", "N3", "N3", 90, 15, 0.25, 0.95, 0.45, 0)
];
export const baseMinutes = (p: Persona, day: number, at: number) =>
  p.id === "office" && [0, 6].includes(new Date(at).getDay()) ? 0
    : p.minutes * (p.id === "break" && day >= 35 && day <= 37 ? 0.7 : 1);

export interface CardDay {
  planned: number; plannedFresh: number; releasedPrior: number;
  answers: number; fresh: number; prior: number; review: number; relearn: number;
  backlog: number; pendingPrior: number; scheduledRemaining: number;
}
export interface Quota {
  savedFresh: number; effectiveFresh: number; savedReview: number; effectiveReview: number;
  reasons: string[];
}
export interface Daily {
  seed: number; day: number; date: string; baseMinutes: number; availableMinutes: number;
  absenceProbability: number; active: boolean; absence: "none" | "base" | "burden" | "weekend" | "holiday";
  shouldMinutes: number; actualMinutes: number; cards: Record<PlanKind, CardDay>;
  quotas: Record<PlanKind, Quota>; feasible: boolean | null;
  kana: { planned: number; taught: number; wordTaught: number; answers: number; mastered: number };
  relief: number; tail: number;
}
export interface Transition { seed: number; day: number; kind: PlanKind; type: "prompt" | "content"; from: string; to: string; choice?: string }
export interface Coverage { seen: number; total: number; percent: number; stateSeen: number; statePercent: number }
export interface Run {
  seed: number; days: Daily[]; transitions: Transition[]; events: { day: number; type: string; value: string | number }[];
  coverage: { day: number; date: string; reason: string; cards: Record<PlanKind, Coverage> };
  selfGap: { initiallyLearnedN4: number; neverScheduled: number; neverShown: number; backfill: string } | null;
}
export interface Stats { median: number; p90: number; worst: number; samples: number }
export const stats = (values: (number | null)[], lowerIsWorse = false): Stats | null => {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? { median: round(median(v)), p90: round(percentile(v, 0.9)),
    worst: lowerIsWorse ? Math.min(...v) : Math.max(...v), samples: v.length } : null;
};
export const totalBacklog = (d: Daily) => KINDS.reduce((s, k) => s + d.cards[k].backlog, 0);

export const metricsFor = (runs: Run[]) => {
  const transitions = runs.flatMap(run => run.transitions.map(event => {
    const before = run.days.filter(d => d.day >= event.day - 7 && d.day < event.day);
    const after = run.days.filter(d => d.day >= event.day && d.day <= event.day + 14);
    const minutes = (d: Daily) => d.cards[event.kind].planned;
    return { ...event, beforeDays: before.length, afterDays: after.length,
      ratio: ratio(Math.max(...after.map(minutes)), median(before.map(minutes))),
      noFreshDays: after.filter(d => d.quotas[event.kind].effectiveFresh > 0 && d.cards[event.kind].fresh === 0).length,
      availableButNoFreshDays: after.filter(d => d.quotas[event.kind].effectiveFresh > 0 && d.cards[event.kind].plannedFresh > 0 && d.cards[event.kind].fresh === 0).length,
      truncated: before.length < 7 || after.length < 15 };
  }));
  const recoveries = runs.flatMap(run => run.days.flatMap((d, i) => {
    if (!d.active || !i || run.days[i - 1].active) return [];
    let start = i - 1;
    while (start > 0 && !run.days[start - 1].active) start--;
    const before = run.days.slice(Math.max(0, start - 7), start);
    const baseline = before.length ? median(before.map(totalBacklog)) : null;
    // 观察到后续再次缺席也继续计日历天；截尾单独计，绝不把未恢复填成0。
    const rest = run.days.slice(i);
    const recovered = baseline === null ? -1 : rest.findIndex(day => totalBacklog(day) <= baseline * 1.2);
    return [{ seed: run.seed, absentFrom: start + 1, absentTo: i, returnDay: d.day,
      baseline, days: recovered < 0 ? null : recovered,
      observedDays: rest.length, peakMinutes: Math.max(...rest.map(day => day.shouldMinutes)),
      scripted: run.days.slice(start, i).some(day => day.absence === "holiday") }];
  }));
  const perSeedM2 = byKind(k => runs.map(run => {
    const events = transitions.filter(e => e.seed === run.seed && e.kind === k);
    return { ratio: events.some(e => e.ratio !== null) ? Math.max(...events.flatMap(e => e.ratio === null ? [] : [e.ratio])) : null,
      noFreshDays: events.length ? Math.max(...events.map(e => e.noFreshDays)) : null };
  }));
  const reasons = [...new Set(runs.flatMap(run => run.days.flatMap(d => KINDS.flatMap(k => d.quotas[k].reasons))))].sort();
  return {
    M1: {
      peakToBase: stats(runs.map(run => Math.max(...run.days.filter(d => d.baseMinutes > 0).map(d => d.shouldMinutes / d.baseMinutes)))),
      peakToMedian: stats(runs.map(run => ratio(Math.max(...run.days.map(d => d.shouldMinutes)), median(run.days.map(d => d.shouldMinutes))))),
      peakMinutes: stats(runs.map(run => Math.max(...run.days.map(d => d.shouldMinutes))))
    },
    M2: { byKind: byKind(k => ({ ratio: stats(perSeedM2[k].map(e => e.ratio)), noFreshDays: stats(perSeedM2[k].map(e => e.noFreshDays)) })), events: transitions },
    M3: { recoveryDays: stats(runs.map(run => {
      const episodes = recoveries.filter(e => e.seed === run.seed);
      return episodes.some(e => e.days !== null) ? Math.max(...episodes.flatMap(e => e.days === null ? [] : [e.days])) : null;
    })), unrecovered: stats(runs.map(run => recoveries.filter(e => e.seed === run.seed && e.days === null).length)),
      returnPeakMinutes: stats(runs.map(run => {
        const episodes = recoveries.filter(e => e.seed === run.seed);
        return episodes.length ? Math.max(...episodes.map(e => e.peakMinutes)) : null;
      })), episodes: recoveries },
    M4: { coverage: byKind(k => stats(runs.map(run => run.coverage.cards[k].percent), true)),
      stateCoverage: byKind(k => stats(runs.map(run => run.coverage.cards[k].statePercent), true)),
      infeasibleDays: stats(runs.map(run => run.days.filter(d => d.feasible === false).length)),
      hint: runs.some(run => run.days.some(d => d.feasible !== null)) ? "previewCurrentLevelPlan.feasible（只测字段，未验证界面是否展示）" : "无提示",
      evaluation: runs.map(run => ({ seed: run.seed, ...run.coverage })) },
    M5: { days: stats(runs.map(run => run.days.filter(d => KINDS.some(k => d.quotas[k].reasons.length)).length)),
      byReason: Object.fromEntries(reasons.map(reason => [reason, stats(runs.map(run => run.days.filter(d => KINDS.some(k => d.quotas[k].reasons.includes(reason))).length))])) },
    M6: { burdenAbsences: stats(runs.map(run => run.days.filter(d => d.absence === "burden").length)) },
    selfGap: runs[0]?.selfGap ? {
      initiallyLearnedN4: runs[0].selfGap.initiallyLearnedN4,
      neverScheduled: stats(runs.map(run => run.selfGap!.neverScheduled)), neverShown: stats(runs.map(run => run.selfGap!.neverShown)),
      backfill: runs.map(run => ({ seed: run.seed, status: run.selfGap!.backfill }))
    } : null
  };
};
