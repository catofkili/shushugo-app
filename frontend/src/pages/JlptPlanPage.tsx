import { ArrowLeft, BellRing, CalendarDays, Target } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getJlptPlanStatus, type JlptPlanStatus } from "../lib/jlpt/status";
import { availableShortfall, JLPT_TARGETS, shortfallText, type JlptTarget } from "../lib/jlpt/plan";
import { formatExamDate, formatExamDateHuman, nextExamDate, parseExamDate } from "../lib/jlpt/exam-dates";
import { getStudyPreferences, saveStudyPreferences } from "../lib/studyPreferences";
import {
  loadReminderSettings,
  syncJlptPlanNotifications,
  type ReminderSettings
} from "../lib/notifications";
import { saveReminderSettings } from "../lib/notifications";
import { PROGRESS_UPDATED_EVENT } from "../lib/progress-events";
import { DailyPlanPanel } from "../components/DailyPlanPanel";
import { LevelSetup } from "../components/LevelSetup";
import { LoadCurve } from "../components/LoadCurve";
import { KanaPrimer } from "../components/KanaPrimer";
import { ExamDateWheel } from "../components/ExamDateWheel";
import { getLevelPlanSettings, recalibrateLevelStartingPoint } from "../lib/level-plan";
import { kanaComplete } from "../lib/kana-progress";
import { previewLevelPlan } from "../lib/plan/content-matrix";
import { useEntitlements } from "../hooks/useEntitlements";

/**
 * 备考计划页。
 *
 * 只回答一个问题:**今天最少做多少才不掉队**。
 * 所有数量都来自 lib/jlpt/(纯计算 + 取数),这里不再自己算一遍。
 */

interface Props {
  onBack: () => void;
  /** 直接去背词 / 去学语法 */
  onStartWords: () => void;
  onStartGrammar: () => void;
}

const PHASE_TEXT: Record<string, string> = {
  intake: "推进期 · 进新 + 复习",
  consolidate: "巩固期 · 只复习",
  "exam-week": "考前一周 · 只清到期",
  past: "这一场已经考完了"
};

const Row = ({
  label,
  need,
  done,
  hint
}: { label: string; need: number; done: number; hint?: string }) => {
  const left = Math.max(need - done, 0);
  const pct = need > 0 ? Math.min(100, Math.round((done / need) * 100)) : 100;
  return (
    <div className="mb-3 rounded-2xl jp-inset p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold jp-ink">{label}</p>
        <p className="text-sm font-bold tabular-nums jp-ink">
          {done} <span className="jp-muted">/ {need}</span>
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full jp-track">
        <div
          className={`h-full rounded-full ${left === 0 ? "jp-accent" : "bg-[#F0B67F]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs jp-muted">
        {need === 0 ? "今天这一项不需要做" : left === 0 ? "已完成 ✓" : `还差 ${left}${hint ? ` · ${hint}` : ""}`}
      </p>
    </div>
  );
};

export function JlptPlanPage({ onBack, onStartWords, onStartGrammar }: Props) {
  const entitlements = useEntitlements();
  const [status, setStatus] = useState<JlptPlanStatus | null>(null);
  const [reminder, setReminder] = useState<ReminderSettings | null>(null);
  const [error, setError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);

  const refresh = useCallback(() => {
    try {
      setStatus(getJlptPlanStatus());
      setError("");
    } catch {
      setError("词库还没加载好,回首页转一圈再进来。");
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(PROGRESS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROGRESS_UPDATED_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    void recalibrateLevelStartingPoint().then((changed) => { if (changed) refresh(); }).catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    loadReminderSettings().then(setReminder).catch(() => setReminder(null));
  }, []);

  // 计划一变就把未来两周的通知重排一遍,不然改完目标/考期,提醒还在报旧数
  useEffect(() => {
    if (!status) return;
    const pending = getLevelPlanSettings()?.startingLevel === "kana-none" && !kanaComplete();
    if (pending) { void syncJlptPlanNotifications(null); return; }
    const available = availableShortfall(status.shortfall, entitlements.isPro);
    syncJlptPlanNotifications(status.enabled ? {
      target: status.target,
      daysLeft: status.plan.daysLeft,
      todayText: shortfallText(available),
      todayClear: available.clear,
      newWordsPerDay: status.plan.newWords,
      newGrammarPerDay: entitlements.isPro ? status.plan.newGrammar : 0,
      feasible: status.plan.feasible
    } : null).catch(() => undefined);
  }, [status, entitlements.isPro]);

  const patchPrefs = (patch: Partial<ReturnType<typeof getStudyPreferences>>) => {
    saveStudyPreferences({ ...getStudyPreferences(), ...patch });
    refresh();
  };

  const patchReminder = async (patch: Partial<ReminderSettings>) => {
    const next = { ...(reminder ?? await loadReminderSettings()), ...patch };
    setReminder(next);
    await saveReminderSettings(next);
    refresh();
  };

  const auto = nextExamDate(new Date());
  const kanaPending = getLevelPlanSettings()?.startingLevel === "kana-none" && !kanaComplete();
  const available = status ? availableShortfall(status.shortfall, entitlements.isPro, kanaPending) : null;
  const quotas = getStudyPreferences();
  const planSettings = getLevelPlanSettings();
  const estimate = status && planSettings ? previewLevelPlan({
    startingLevel: planSettings.startingLevel,
    familiarity: planSettings.familiarity,
    target: status.target,
    examDate: status.examDate,
    startedOn: parseExamDate(planSettings.startedOn) ?? undefined,
    kanaCompleted: planSettings.startingLevel === "kana-none" && kanaComplete()
  }) : null;
  const wordQuotaShort = !kanaPending && status?.plan.phase === "intake" && status.plan.newWords > quotas.dailyGoal;
  const grammarQuotaShort = entitlements.isPro && status?.plan.phase === "intake" && status.plan.newGrammar > quotas.grammarDailyGoal;

  return (
    <div className="mx-auto max-w-3xl pb-6">
      <div className="page-backbar mb-4 flex items-center justify-between gap-3 rounded-2xl jp-card p-2">
        <button
          onClick={onBack}
          className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold jp-ink"
        >
          <ArrowLeft size={17} />
          返回
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold jp-muted">备考计划</p>
      </div>

      {error && (
        <p className="mb-4 rounded-2xl jp-inset p-4 text-sm jp-muted">{error}</p>
      )}

      {status && (
        <>
          <div className="mb-4 rounded-3xl jp-card p-5">
            <p className="text-xs font-bold tracking-[0.14em] jp-muted">下一步 · 今天先做</p>
            <p className="mt-2 text-xl font-black jp-ink">{kanaPending ? "从五十音开始" : shortfallText(available!)}</p>
            {kanaPending ? <p className="mt-2 text-sm jp-muted">从下方第一个假名开始选读音，学完再进入新词。</p> : !available!.clear && <div className="mt-4 flex flex-wrap gap-2">
              {(available!.newWords + available!.reviewWords > 0) && <button onClick={onStartWords} className="focus-ring min-h-12 flex-1 rounded-2xl jp-accent px-4 text-sm font-bold">开始今天的单词 →</button>}
              {(available!.newGrammar + available!.reviewGrammar > 0) && <button onClick={onStartGrammar} className="focus-ring min-h-12 flex-1 rounded-2xl jp-btn px-4 text-sm font-bold jp-ink">开始今天的语法 →</button>}
            </div>}
          </div>
          {kanaPending && <KanaPrimer />}
          {/* 倒计时 + 今天还差什么 */}
          <div className="mb-4 rounded-3xl jp-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] jp-muted">
              {formatExamDateHuman(status.examDate)} · {status.target}
            </p>
            <p className="mt-2 text-4xl font-black tabular-nums jp-ink">
              {status.plan.daysLeft < 0 ? "已考完" : `还有 ${status.plan.daysLeft} 天`}
            </p>
            <p className="mt-2 text-sm jp-muted">{PHASE_TEXT[status.plan.phase]}</p>
            {estimate && <p className="mt-3 rounded-2xl jp-inset px-3 py-2 text-sm leading-6 jp-ink">
              按所选起点，预计共要学 {estimate.content.words} 个词；剩余约 {estimate.intakeDays} 个进新日，平均需 {estimate.required.words} 个/天，当前每日计划上限 {estimate.daily.words} 个。今天能安排的任务会根据实际学习记录变化。
            </p>}
            {estimate && !estimate.feasible && <p className="mt-2 rounded-2xl border border-[#F0B67F]/60 bg-[#F0B67F]/15 px-3 py-2 text-xs leading-5 jp-ink">按所选起点估算，本场考前无法覆盖全部内容；可改考期或目标。</p>}
            {!status.plan.feasible && (
              <p className="mt-3 rounded-2xl border border-[#F0B67F]/60 bg-[#F0B67F]/15 px-3 py-2 text-xs leading-5 jp-ink">
                按当前学习记录，每天做到上限仍需约 {status.plan.daysNeeded} 天，距考试只剩 {status.plan.daysLeft} 天。
                要么把目标降一级,要么把考期改到下一场——继续按现在的排法只会天天欠账。
              </p>
            )}
            {status.plan.feasible && (wordQuotaShort || grammarQuotaShort) && (
              <p className="mt-3 rounded-2xl border border-[#F0B67F]/60 bg-[#F0B67F]/15 px-3 py-2 text-xs leading-5 jp-ink">
                按当前固定额度，考前无法覆盖全部新内容。
                {wordQuotaShort && ` 单词每天需约 ${status.plan.newWords} 个，当前安排 ${quotas.dailyGoal} 个。`}
                {grammarQuotaShort && ` 语法每天需约 ${status.plan.newGrammar} 个，当前安排 ${quotas.grammarDailyGoal} 个。`}
                可以调整每日学习量或改考期；额度不会自动增加。
              </p>
            )}
          </div>

          {/* 每日学习量：圆环 / 数字表单 / 备考一键（DailyPlanPanel，和设置页同一个组件、同一份状态）。
              「下次考 N几」就是下面「目标级别」那一个，面板不再有第二个选择框。 */}
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.2em] jp-muted">每日学习量</p>
          <div className="mb-4"><DailyPlanPanel /></div>
          {!entitlements.isPro && <p className="-mt-2 mb-4 px-1 text-xs leading-5 jp-muted">当前只安排单词；语法、汉字和辨析的原定额度已保留，开通 Pro 后恢复。</p>}
          <LoadCurve />

          {/* 今天的最低量 */}
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.2em] jp-muted">今天最少要做</p>
          <div className="mb-4 rounded-3xl jp-card p-4">
            <Row
              label="单词 · 复习到期"
              need={status.plan.reviewWords}
              done={status.done.reviewWordsDone}
              hint="积压已经摊到一周里还了"
            />
            <Row label="单词 · 新词" need={kanaPending ? 0 : status.plan.newWords} done={status.done.newWordsDone} />
            {entitlements.isPro && <>
              <Row label="语法 · 复习到期" need={status.plan.reviewGrammar} done={status.done.reviewGrammarDone} />
              <Row label="语法 · 新语法" need={status.plan.newGrammar} done={status.done.newGrammarDone} />
            </>}
          </div>

          {/* 覆盖进度 */}
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.2em] jp-muted">
            {status.target} 范围覆盖
          </p>
          <div className="mb-4 grid grid-cols-2 gap-3">
            {([
              ["单词", status.coverage.words],
              ["语法", status.coverage.grammar]
            ] as const).map(([label, data]) => {
              const pct = data.total > 0 ? Math.round((data.seen / data.total) * 100) : 0;
              return (
                <div key={label} className="rounded-2xl jp-card p-4">
                  <p className="text-xs font-bold jp-muted">{label}</p>
                  <p className="mt-1 text-2xl font-black tabular-nums jp-ink">{pct}%</p>
                  <p className="mt-1 text-xs tabular-nums jp-muted">{data.seen} / {data.total}</p>
                </div>
              );
            })}
          </div>

          {/* 设置 */}
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.2em] jp-muted">计划设置</p>
          <div className="rounded-3xl jp-card p-4">
            <button onClick={() => setSetupOpen(true)} className="focus-ring mb-4 h-11 w-full rounded-2xl jp-btn text-sm font-bold jp-ink">重新设定起点与目标</button>
            <label className="mb-3 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-sm font-bold jp-ink">
                <Target size={16} /> 开启备考计划
              </span>
              <input
                type="checkbox"
                checked={status.enabled}
                onChange={(event) => patchPrefs({ jlptPlanEnabled: event.target.checked })}
                className="h-5 w-5 accent-[color:var(--zoo-primary)]"
              />
            </label>

            <div className="mb-3">
              <p className="mb-2 text-sm font-bold jp-ink">目标级别</p>
              <div className="grid grid-cols-5 gap-2">
                {JLPT_TARGETS.map((level) => (
                  <button
                    key={level}
                    onClick={() => patchPrefs({ jlptTarget: level as JlptTarget })}
                    className={`focus-ring h-11 rounded-2xl text-sm font-bold ${
                      status.target === level
                        ? "jp-accent"
                        : "jp-btn jp-muted"
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs jp-muted">
                累计范围：N3 含 N5/N4。
              </p>
            </div>

            <div className="mb-3">
              <p className="mb-2 inline-flex items-center gap-2 text-sm font-bold jp-ink">
                <CalendarDays size={16} /> 考试日期
              </p>
              <ExamDateWheel value={formatExamDate(status.examDate)} onChange={(value) => patchPrefs({ jlptExamDate: value })} />
              <p className="mt-2 text-xs jp-muted">
                {status.examDateSource === "auto"
                  ? `自动：下一场 ${formatExamDate(auto)}`
                  : "已选考期；未公布的日期按惯例预计。"}
              </p>
              {status.examDateSource === "manual" && (
                <button
                  onClick={() => patchPrefs({ jlptExamDate: "" })}
                  className="focus-ring mt-2 rounded-2xl jp-btn px-3 py-2 text-xs font-bold jp-muted"
                >
                  恢复自动({formatExamDate(auto)})
                </button>
              )}
            </div>

            <label className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-sm font-bold jp-ink">
                <BellRing size={16} /> 每日提醒
              </span>
              <span className="inline-flex items-center gap-2">
                <input
                  type="time"
                  value={reminder?.jlptTime ?? "20:30"}
                  onChange={(event) => patchReminder({ jlptTime: event.target.value })}
                  className="focus-ring h-10 rounded-2xl jp-btn px-2 text-sm font-bold jp-ink"
                />
                <input
                  type="checkbox"
                  checked={reminder?.jlptReminder ?? true}
                  onChange={(event) => patchReminder({ jlptReminder: event.target.checked })}
                  className="h-5 w-5 accent-[color:var(--zoo-primary)]"
                />
              </span>
            </label>
            <p className="mt-2 text-xs jp-muted">
              到点提醒今天还差多少，做完了就不发。
            </p>
          </div>
        </>
      )}
      {setupOpen && <LevelSetup open dismissible onClose={() => setSetupOpen(false)} onComplete={() => { setSetupOpen(false); refresh(); }} />}
    </div>
  );
}
