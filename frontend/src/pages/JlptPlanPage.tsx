import { ArrowLeft, BellRing, CalendarDays, Target } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getJlptPlanStatus, type JlptPlanStatus } from "../lib/jlpt/status";
import { availableShortfall, JLPT_TARGETS, shortfallText, type JlptTarget } from "../lib/jlpt/plan";
import { examEndAt, examLabel, EXAM_TYPES, formatExamDate, formatExamDateHuman, parseExamDate, suggestedExamDate } from "../lib/jlpt/exam-dates";
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
import { ExamDatePicker } from "../components/ExamDatePicker";
import { getLevelPlanSettings, recalibrateLevelStartingPoint } from "../lib/level-plan";
import { kanaComplete } from "../lib/kana-progress";
import { previewCurrentLevelPlan } from "../lib/daily-plan";
import { useEntitlements } from "../hooks/useEntitlements";
import { MascotSay } from "../components/MascotSay";
import { Sticker } from "../components/CapybaraMascot";

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
    <div className="ds-inset mb-2 p-3 last:mb-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold jp-ink">{label}</p>
        <p className="ds-num text-sm font-bold jp-ink">
          {done} <span className="jp-muted">/ {need}</span>
        </p>
      </div>
      <div className={`ds-bar mt-2 ${left === 0 ? "" : "warn"}`}><i style={{ width: `${pct}%` }} /></div>
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
    if (pending || status.finished) { void syncJlptPlanNotifications(null); return; }
    const available = availableShortfall(status.shortfall, entitlements.isPro);
    syncJlptPlanNotifications(status.enabled ? {
      target: status.examKind === "jlpt" ? status.target : examLabel(status.examKind),
      examEndAt: examEndAt(status.examKind, status.examDate),
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

  const auto = status ? suggestedExamDate(status.examKind) : null;
  const kanaPending = getLevelPlanSettings()?.startingLevel === "kana-none" && !kanaComplete();
  const available = status ? availableShortfall(status.shortfall, entitlements.isPro, kanaPending) : null;
  const quotas = getStudyPreferences();
  const noDate = Boolean(status && !parseExamDate(quotas.jlptExamDate) && !auto);
  const planSettings = getLevelPlanSettings();
  const estimate = status && planSettings && !noDate && status.plan.phase !== "past" ? previewCurrentLevelPlan({
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

      {error && <MascotSay sticker="empty-network" tone="warn" className="mb-4">{error}</MascotSay>}

      {status && (
        <>
          {/* ① 今天先做什么 —— 首屏第一件事（首次设定保存后直接落到这里） */}
          <div className="ds-card mb-3 p-5">
            <p className="ds-kicker">下一步 · 今天先做</p>
            <p className="mt-1 text-xl font-black jp-ink">{kanaPending ? "从五十音开始" : noDate ? "先选择考试日期" : shortfallText(available!)}</p>
            {kanaPending ? <p className="mt-2 text-sm ds-ink2">从下方第一个假名开始选读音，学完再进入新词。</p> : !noDate && !available!.clear && <div className="mt-4 flex flex-wrap gap-2">
              {(available!.newWords + available!.reviewWords > 0) && <button onClick={onStartWords} className="focus-ring ds-btn flex-1">开始今天的单词 →</button>}
              {(available!.newGrammar + available!.reviewGrammar > 0) && <button onClick={onStartGrammar} className="focus-ring ds-btn-soft flex-1">开始今天的语法 →</button>}
            </div>}
          </div>
          {kanaPending && <KanaPrimer />}

          {/* ② 倒计时：大数字 + 阶段，右边一只按「来不来得及」换表情的吉祥物 */}
          <div className="ds-card relative mb-3 overflow-hidden p-5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <span className="ds-pill ds-pill-primary">{status.examKind === "jlpt" ? status.target : examLabel(status.examKind)} · {noDate ? "日期待选" : formatExamDateHuman(status.examDate)}</span>
                {noDate ? (
                  <p className="mt-3 text-2xl font-black jp-ink">先选择考试日期</p>
                ) : status.finished || status.plan.daysLeft < 0 ? (
                  <p className="mt-3 text-4xl font-black jp-ink">已考完</p>
                ) : (
                  <p className="mt-2 flex items-baseline gap-1 jp-ink">
                    <span className="text-sm font-bold jp-muted">还有</span>
                    <span className="ds-num text-6xl font-black leading-none tracking-tight">{status.plan.daysLeft}</span>
                    <span className="text-lg font-black">天</span>
                  </p>
                )}
                <p className="mt-3 text-sm font-bold ds-ink2">{noDate ? "选好日期后生成倒计时" : PHASE_TEXT[status.plan.phase]}</p>
              </div>
              <Sticker
                name={status.finished || status.plan.daysLeft < 0 ? "mood-cheer" : status.plan.feasible && !(estimate && !estimate.feasible) ? "mood-fired-up" : "mood-shocked"}
                size={108}
                className="-mr-2 shrink-0"
              />
            </div>
          </div>

          {/* ③ 吉祥物说：起点估算、来不及、额度不够、没开会员 —— 以前是四块橙描边的干巴巴色块 */}
          <div className="mb-2 space-y-3">
            {estimate && (
              <MascotSay sticker="mood-ask" className="ds-say-onbg">
                按你选的起点，一共要学 <b>{estimate.content.words}</b> 个词。还剩约 {estimate.intakeDays} 天可以进新，
                平均每天 <b>{estimate.required.words}</b> 个；现在每天最多排 {estimate.daily.words} 个。
              </MascotSay>
            )}
            {estimate && !estimate.feasible && (
              <MascotSay sticker="mood-shocked" tone="warn">
                照这个起点算，<b>这一场考前学不完全部内容</b>。换一场考期、或者把目标降一级，会轻松很多。
              </MascotSay>
            )}
            {!noDate && status.plan.phase !== "past" && !status.plan.feasible && (
              <MascotSay sticker="mood-dizzy" tone="warn">
                按现在的记录，每天做满也要 <b>{status.plan.daysNeeded}</b> 天，可离考试只剩 <b>{status.plan.daysLeft}</b> 天。
                要么目标降一级，要么换到下一场 —— 不然会天天欠账。
              </MascotSay>
            )}
            {status.plan.feasible && (wordQuotaShort || grammarQuotaShort) && (
              <MascotSay sticker="mood-puzzled" tone="warn">
                照现在的额度，考前学不完新内容：
                {wordQuotaShort && <>单词每天要约 <b>{status.plan.newWords}</b> 个，现在排 {quotas.dailyGoal} 个。</>}
                {grammarQuotaShort && <>语法每天要约 <b>{status.plan.newGrammar}</b> 条，现在排 {quotas.grammarDailyGoal} 条。</>}
                在下面把每日学习量调高一点，或者换一场考期 —— 额度不会自己涨。
              </MascotSay>
            )}
            {!entitlements.isPro && (
              <MascotSay sticker="mood-shy" size={48} className="ds-say-onbg">
                现在只给你排单词。语法、汉字和辨析的额度都帮你留着，开通 Pro 就恢复。
              </MascotSay>
            )}
          </div>

          {/* 每日学习量：圆环 / 数字表单 / 备考一键（DailyPlanPanel，和设置页同一个组件、同一份状态）。
              「下次考 N几」就是下面「目标级别」那一个，面板不再有第二个选择框。 */}
          <p className="ds-section">每日学习量</p>
          <div className="mb-4"><DailyPlanPanel /></div>
          <LoadCurve />

          <p className="ds-section">今天最少要做</p>
          <div className="ds-card mb-4 p-3">
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

          <p className="ds-section">{status.examKind === "jlpt" ? `${status.target} 范围覆盖` : `本站 ${status.target} 素材范围覆盖`}</p>
          <div className="mb-4 grid grid-cols-2 gap-3">
            {([
              ["单词", status.coverage.words],
              ["语法", status.coverage.grammar]
            ] as const).map(([label, data]) => {
              const pct = data.total > 0 ? Math.round((data.seen / data.total) * 100) : 0;
              return (
                <div key={label} className="ds-card p-4">
                  <p className="ds-kicker">{label}</p>
                  <p className="ds-num mt-1 text-3xl font-black jp-ink">{pct}<span className="text-base">%</span></p>
                  <div className="ds-bar mt-2"><i style={{ width: `${pct}%` }} /></div>
                  <p className="ds-num mt-2 text-xs jp-muted">{data.seen} / {data.total}</p>
                </div>
              );
            })}
          </div>

          <p className="ds-section">计划设置</p>
          <div className="ds-card p-4">
            <button onClick={() => setSetupOpen(true)} className="focus-ring ds-btn-soft mb-5 w-full">重新设定起点与目标</button>
            <label className="mb-5 flex items-center justify-between gap-3">
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

            <div className="mb-5">
              <p className="mb-2 text-sm font-bold jp-ink">{status.examKind === "jlpt" ? "目标级别" : "本站练习素材范围"}</p>
              <div className="grid grid-cols-5 gap-2">
                {JLPT_TARGETS.map((level) => (
                  <button
                    key={level}
                    onClick={() => patchPrefs({ jlptTarget: level as JlptTarget })}
                    aria-pressed={status.target === level}
                    className="focus-ring ds-chip"
                  >
                    {level}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs jp-muted">累计范围：{status.target} 含更基础等级。{status.examKind !== "jlpt" && "这只是本站素材范围，不代表所选考试考纲覆盖率。"}</p>
            </div>

            <div className="mb-5">
              <p className="mb-2 text-sm font-bold jp-ink">考试类型</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {EXAM_TYPES.map(({ kind, label }) => <button key={kind} type="button" aria-pressed={status.examKind === kind} onClick={() => {
                  const date = suggestedExamDate(kind);
                  patchPrefs({ planExamKind: kind, jlptExamDate: date ? formatExamDate(date) : "" });
                }} className={`focus-ring min-h-10 rounded-xl px-2 text-xs font-bold ${status.examKind === kind ? "jp-accent" : "jp-btn jp-muted"}`}>{label}</button>)}
              </div>
            </div>

            <div className="mb-5">
              <p className="mb-2 inline-flex items-center gap-2 text-sm font-bold jp-ink">
                <CalendarDays size={16} /> 考试日期
              </p>
              <ExamDatePicker key={status.examKind} kind={status.examKind} value={quotas.jlptExamDate || (auto ? formatExamDate(auto) : "")} onChange={(value) => patchPrefs({ jlptExamDate: value })} />
              <p className="mt-2 text-xs jp-muted">
                {status.examDateSource === "auto" ? `自动建议：${auto ? formatExamDate(auto) : "暂无已公布场次"}` : "日期已保存；请以实际考点或准考信息为准。"}
              </p>
              {status.examDateSource === "manual" && auto && (
                <button
                  onClick={() => patchPrefs({ jlptExamDate: status.examKind === "jlpt" ? "" : formatExamDate(auto) })}
                  className="focus-ring ds-chip mt-2"
                >
                  {status.examKind === "jlpt" ? "恢复自动考期" : `恢复建议日期（${formatExamDate(auto)}）`}
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
                  className="focus-ring h-10 w-auto px-3 text-sm font-bold"
                />
                <input
                  type="checkbox"
                  checked={reminder?.jlptReminder ?? true}
                  onChange={(event) => patchReminder({ jlptReminder: event.target.checked })}
                  className="h-5 w-5 accent-[color:var(--zoo-primary)]"
                />
              </span>
            </label>
            <p className="mt-2 text-xs jp-muted">到点提醒今天还差多少，做完了就不发。</p>
          </div>
        </>
      )}
      {setupOpen && <LevelSetup open dismissible onClose={() => setSetupOpen(false)} onComplete={() => { setSetupOpen(false); refresh(); }} />}
    </div>
  );
}
