import { ArrowLeft, BellRing, CalendarDays, Target } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getJlptPlanStatus, type JlptPlanStatus } from "../lib/jlpt/status";
import { JLPT_TARGETS, shortfallText, type JlptTarget } from "../lib/jlpt/plan";
import { formatExamDate, formatExamDateHuman, nextExamDate } from "../lib/jlpt/exam-dates";
import { getStudyPreferences, saveStudyPreferences } from "../lib/studyPreferences";
import {
  loadReminderSettings,
  syncJlptPlanNotifications,
  type ReminderSettings
} from "../lib/notifications";
import { saveReminderSettings } from "../lib/notifications";
import { PROGRESS_UPDATED_EVENT } from "../lib/progress-events";
import { DailyPlanPanel } from "../components/DailyPlanPanel";

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
  const [status, setStatus] = useState<JlptPlanStatus | null>(null);
  const [reminder, setReminder] = useState<ReminderSettings | null>(null);
  const [error, setError] = useState("");

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
    loadReminderSettings().then(setReminder).catch(() => setReminder(null));
  }, []);

  // 计划一变就把未来两周的通知重排一遍,不然改完目标/考期,提醒还在报旧数
  useEffect(() => {
    if (!status) return;
    syncJlptPlanNotifications(status.enabled ? {
      target: status.target,
      daysLeft: status.plan.daysLeft,
      todayText: shortfallText(status.shortfall),
      todayClear: status.shortfall.clear,
      newWordsPerDay: status.plan.newWords,
      newGrammarPerDay: status.plan.newGrammar,
      feasible: status.plan.feasible
    } : null).catch(() => undefined);
  }, [status]);

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

  return (
    <div className="mx-auto max-w-3xl pb-6">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl jp-card p-2">
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
          {/* 倒计时 + 今天还差什么 */}
          <div className="mb-4 rounded-3xl jp-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] jp-muted">
              {formatExamDateHuman(status.examDate)} · {status.target}
            </p>
            <p className="mt-2 text-4xl font-black tabular-nums jp-ink">
              {status.plan.daysLeft < 0 ? "已考完" : `还有 ${status.plan.daysLeft} 天`}
            </p>
            <p className="mt-2 text-sm jp-muted">{PHASE_TEXT[status.plan.phase]}</p>
            <p className="mt-3 rounded-2xl jp-inset px-3 py-2 text-sm font-bold jp-ink">
              {shortfallText(status.shortfall)}
            </p>
            {!status.plan.feasible && (
              <p className="mt-3 rounded-2xl border border-[#F0B67F]/60 bg-[#F0B67F]/15 px-3 py-2 text-xs leading-5 jp-ink">
                按每天的上限也吃不完:全部覆盖大约要 {status.plan.daysNeeded} 天,现在只剩 {status.plan.daysLeft} 天。
                要么把目标降一级,要么把考期改到下一场——继续按现在的排法只会天天欠账。
              </p>
            )}
          </div>

          {/* 每日学习量：圆环 / 数字表单 / 备考一键（DailyPlanPanel，和设置页同一个组件、同一份状态）。
              「下次考 N几」就是下面「目标级别」那一个，面板不再有第二个选择框。 */}
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.2em] jp-muted">每日学习量</p>
          <div className="mb-4"><DailyPlanPanel /></div>

          {/* 今天的最低量 */}
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.2em] jp-muted">今天最少要做</p>
          <div className="mb-4 rounded-3xl jp-card p-4">
            <Row
              label="单词 · 复习到期"
              need={status.plan.reviewWords}
              done={status.done.reviewWordsDone}
              hint="积压已经摊到一周里还了"
            />
            <Row label="单词 · 新词" need={status.plan.newWords} done={status.done.newWordsDone} />
            <Row label="语法 · 复习到期" need={status.plan.reviewGrammar} done={status.done.reviewGrammarDone} />
            <Row label="语法 · 新语法" need={status.plan.newGrammar} done={status.done.newGrammarDone} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                onClick={onStartWords}
                className="focus-ring h-12 rounded-2xl jp-accent text-sm font-bold"
              >
                去背词 →
              </button>
              <button
                onClick={onStartGrammar}
                className="focus-ring h-12 rounded-2xl jp-btn text-sm font-bold jp-ink"
              >
                去学语法 →
              </button>
            </div>
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
              <input
                type="date"
                value={formatExamDate(status.examDate)}
                onChange={(event) => patchPrefs({ jlptExamDate: event.target.value })}
                className="focus-ring h-11 w-full rounded-2xl jp-btn px-3 text-sm font-bold jp-ink"
              />
              <p className="mt-2 text-xs jp-muted">
                {status.examDateSource === "auto"
                  ? `自动：下一场 ${formatExamDate(auto)}`
                  : "手填。清空即回到自动。"}
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
    </div>
  );
}
