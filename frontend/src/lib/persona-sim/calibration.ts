import type { Database } from "sql.js";
import type { WordAnswer } from "../../types/vocabulary";
import { recordReview, retrievability, type FsrsState, type StepMode } from "../fsrs-scheduler";
import { SECONDS_PER_CARD } from "../daily-plan";
import { PRIOR_ENTITIES } from "../prior-pacing";
import { byKind, dateAt, DAY_MS, KINDS, median, percentile, round } from "./model";

const rows = (db: Database, sql: string): Record<string, unknown>[] => {
  const s = db.prepare(sql);
  const out: Record<string, unknown>[] = [];
  try { while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
};
interface Sample { count: number; correct: number; sumR: number }
const sample = (): Sample => ({ count: 0, correct: 0, sumR: 0 });
const add = (s: Sample, correct: boolean, r = 0) => { s.count++; s.correct += Number(correct); s.sumR += r; };
const rate = (s: Sample) => s.count ? s.correct / s.count : null;

/** 仅返回聚合数；不读取词面，不输出汉字/辨析键或语法原文。 */
export const calibrate = (db: Database) => {
  const last = String(rows(db, `SELECT MAX(d) AS d FROM (
    ${KINDS.map(k => `SELECT MAX(reviewed_on) AS d FROM ${PRIOR_ENTITIES[k].reviews}`).join(" UNION ALL ")}
  )`)[0].d);
  const start = new Date(`${last}T09:00:00`).getTime() + DAY_MS;
  // 快照最后一天可能尚未学完，用之前60个完整日，缺席与非缺席分别建模。
  const endAt = new Date(`${last}T09:00:00`).getTime() - DAY_MS;
  const beginAt = endAt - 59 * DAY_MS;
  const begin = dateAt(beginAt), end = dateAt(endAt);
  const minutes = new Map(Array.from({ length: 60 }, (_, i) => [dateAt(beginAt + i * DAY_MS), 0]));
  const first = byKind(sample), review = byKind(sample), prior = byKind(sample);
  const missingR = byKind(() => 0), inferredModes = byKind(() => 0), replayed = byKind(() => 0);
  const bins = byKind(() => Object.fromEntries(["<1", "1-3", "3-7", "7-14", "14-30", ">=30"].map(b => [b, sample()])));
  const excludedDirections = rows(db, "SELECT COUNT(*) AS n FROM reviews WHERE direction <> 'forward'")[0].n;
  const baselines = new Map(rows(db, "SELECT * FROM level_prior_baselines").map(b => [`${b.entity}:${b.entity_key}`, b]));
  for (const kind of KINDS) {
    const { reviews, idColumn } = PRIOR_ENTITIES[kind];
    for (const d of rows(db, `SELECT reviewed_on AS d, COUNT(*) AS n FROM ${reviews} GROUP BY reviewed_on`)) {
      if (minutes.has(String(d.d))) minutes.set(String(d.d), minutes.get(String(d.d))! + Number(d.n) * SECONDS_PER_CARD[kind] / 60);
    }
    const events = rows(db, `SELECT * FROM ${reviews} ${kind === "words" ? "WHERE direction = 'forward'" : ""}
      ORDER BY ${idColumn}, ${kind === "grammar" ? "created_at" : "COALESCE(reviewed_at, strftime('%s', created_at)*1000)"}, id`);
    let key = "", state: FsrsState | null = null, previousDay = "", lastAt = 0, wrong = 0, seen = false;
    for (const event of events) {
      const nextKey = String(event[idColumn]), day = String(event.reviewed_on);
      const answer = String(event.answer) as WordAnswer;
      if (nextKey !== key) { key = nextKey; state = null; previousDay = ""; lastAt = 0; wrong = 0; seen = false; }
      let at = Number(event.reviewed_at) || Date.parse(String(event.created_at).replace(" ", "T"));
      if (!Number.isFinite(at)) at = new Date(`${day}T12:00:00`).getTime();
      at = Math.max(at, lastAt + 1000);
      const baseline = baselines.get(`${kind}:${key}`);
      const isPrior = !seen && !!baseline && Date.parse(String(baseline.updated_at)) <= at;
      if (isPrior) state = {
        stability: Number(baseline.stability), difficulty: Number(baseline.difficulty), due: String(baseline.due),
        lastReview: String(baseline.last_review), state: Number(baseline.state), steps: Number(baseline.steps), reps: Number(baseline.reps), lapses: Number(baseline.lapses)
      };
      const firstToday = day !== previousDay;
      if (firstToday) wrong = 0;
      const correct = answer === "know" || answer === "known_forever";
      if (day >= begin && day <= end && firstToday) {
        if (!seen) add(isPrior ? prior[kind] : first[kind], correct);
        else {
          const r = state ? retrievability(state, new Date(at)) : NaN;
          if (Number.isFinite(r)) add(review[kind], correct, r);
          else missingR[kind]++;
          const gap = (at - lastAt) / DAY_MS;
          const bin = gap < 1 ? "<1" : gap < 3 ? "1-3" : gap < 7 ? "3-7" : gap < 14 ? "7-14" : gap < 30 ? "14-30" : ">=30";
          add(bins[kind][bin], correct);
        }
      }
      if (answer === "forgot" || answer === "fuzzy") wrong++;
      const storedMode = String(event.scheduler_mode ?? "legacy");
      const mode: StepMode = ["normal", "stubborn", "known"].includes(storedMode) ? storedMode as StepMode
        : firstToday && correct ? "known" : wrong >= 3 ? "stubborn" : "normal";
      if (!["normal", "stubborn", "known"].includes(storedMode)) inferredModes[kind]++;
      // 语法的熟知入口不写 FSRS；另三类将熟知当 know 后退出调度。
      if (!(kind === "grammar" && answer === "known_forever")) state = recordReview(state, answer === "known_forever" ? "know" : answer, new Date(at), { mode });
      previousDay = day; lastAt = at; seen = true; replayed[kind]++;
    }
  }
  const pooledFirst = KINDS.reduce((s, k) => ({ ...s, count: s.count + first[k].count, correct: s.correct + first[k].correct }), sample());
  const pooledPrior = KINDS.reduce((s, k) => ({ ...s, count: s.count + prior[k].count, correct: s.correct + prior[k].correct }), sample());
  const activeMinutes = [...minutes.values()].filter(n => n > 0);
  if (!activeMinutes.length) throw new Error("近60个完整日没有真实作答，self不能标定");
  const coefficients = byKind(k => review[k].sumR > 0 ? review[k].correct / review[k].sumR : 0.95);
  const firstAccuracy = byKind(k => rate(first[k]) ?? rate(pooledFirst) ?? 0.4);
  const summarize = (s: Sample) => ({ count: s.count, accuracy: rate(s) === null ? null : round(rate(s)!), meanR: s.count && s.sumR ? round(s.sumR / s.count) : null });
  return {
    start, lastSnapshotDay: last, window: { begin, end, days: 60, active: activeMinutes.length, absent: 60 - activeMinutes.length },
    absence: (60 - activeMinutes.length) / 60, baseMinutes: median(activeMinutes), activeMinutes: activeMinutes.map(round),
    minuteDistribution: { median: round(median(activeMinutes)), p10: round(percentile(activeMinutes, 0.1)), p90: round(percentile(activeMinutes, 0.9)), min: round(Math.min(...activeMinutes)), max: round(Math.max(...activeMinutes)) },
    coefficients, firstAccuracy, priorAccuracy: rate(pooledPrior) ?? 0.8,
    first: byKind(k => summarize(first[k])), review: byKind(k => summarize(review[k])), prior: byKind(k => summarize(prior[k])),
    bins: byKind(k => Object.fromEntries(Object.entries(bins[k]).map(([b, s]) => [b, summarize(s)]))),
    method: KINDS.some(k => missingR[k] > 0) ? "interval-buckets" : "replay-R",
    missingR, inferredModes, replayed, excludedDirections,
    fallbacks: KINDS.flatMap(k => [
      ...(!first[k].count ? [`${k}: 首答样本为空，用四类合并首答正确率`] : []),
      ...(!review[k].count ? [`${k}: 复习样本为空，系数0.95`] : [])
    ])
  };
};
export type Calibration = ReturnType<typeof calibrate>;
