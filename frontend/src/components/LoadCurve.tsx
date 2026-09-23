import { firstValue } from "../lib/database/db-utils";
import { getJlptPlanStatus } from "../lib/jlpt/status";
import { predictLoad, type LoadKind } from "../lib/plan/load-model";
import { getStudyPreferences } from "../lib/studyPreferences";
import { useEntitlements } from "../hooks/useEntitlements";

const TABLES: Record<LoadKind, string> = {
  words: "progress", grammar: "grammar_progress", kanji: "kanji_char_memory", confusion: "confusion_progress"
};

const prediction = (isPro: boolean) => {
  const firstReview = firstValue<string>(`
    SELECT MIN(reviewed_on) FROM (
      SELECT reviewed_on FROM reviews UNION ALL SELECT reviewed_on FROM grammar_reviews
      UNION ALL SELECT reviewed_on FROM kanji_char_reviews UNION ALL SELECT reviewed_on FROM confusion_reviews
    )
  `, [], "");
  if (!firstReview || Date.now() - Date.parse(firstReview) < 7 * 86_400_000) return null;
  const prefs = getStudyPreferences();
  const status = getJlptPlanStatus();
  const existingDuePerWeek = Array.from({ length: 8 }, (_, index) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + index * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return Object.fromEntries((Object.keys(TABLES) as LoadKind[]).map((kind) => [kind, !isPro && kind !== "words" ? 0 : firstValue<number>(
      `SELECT COUNT(*) FROM ${TABLES[kind]} WHERE known_forever = 0 AND fsrs_due >= ? AND fsrs_due < ?`,
      [start.toISOString(), end.toISOString()], 0
    )])) as Record<LoadKind, number>;
  });
  return predictLoad({
    dailyNew: { words: prefs.dailyGoal, grammar: isPro ? prefs.grammarDailyGoal : 0, kanji: isPro ? prefs.kanjiDailyGoal : 0, confusion: isPro ? prefs.confusionDailyGoal : 0 },
    existingDuePerWeek,
    intakeDaysLeft: status.plan.intakeDaysLeft,
    weeks: 8
  });
};

const TIER = { light: "轻松", steady: "稳妥", heavy: "压力不小", aggressive: "激进" } as const;

export function LoadCurve() {
  const entitlements = useEntitlements();
  let load;
  try { load = prediction(entitlements.isPro); } catch { return null; }
  if (!load) return null;
  const max = Math.max(1, ...load.perWeek.map((week) => week.minutes));
  const peak = load.perWeek[load.peakWeek - 1];
  return <div className="mb-4 rounded-3xl jp-card p-5">
    <div className="flex items-baseline justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] jp-muted">未来 8 周预计压力</p><h3 className="mt-1 text-lg font-black jp-ink">{TIER[load.tier]}</h3></div><b className="text-sm jp-ink">峰值约 {peak.minutes} 分钟/天</b></div>
    <div className="mt-5 flex h-32 items-end gap-2" aria-label="未来八周每日预计分钟">
      {load.perWeek.map((week) => <div key={week.week} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
        <small className="text-[10px] font-bold jp-muted">{week.week === load.peakWeek ? "最重" : week.minutes}</small>
        <div className={`w-full rounded-t-lg ${week.week === load.peakWeek ? "bg-[#E59D5F]" : "bg-[#81D8CF]"}`} style={{ height: `${Math.max(4, week.minutes / max * 90)}px` }} />
        <small className="text-[10px] jp-muted">{week.week}周</small>
      </div>)}
    </div>
    <p className="mt-3 text-xs leading-5 jp-muted">第 {load.peakWeek} 周最重，约 {peak.minutes} 分钟/天。它是按标准答题速度和当前到期量算的估计，不是承诺时间。</p>
  </div>;
}
