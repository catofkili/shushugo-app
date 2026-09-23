import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { applyExamPreset } from "../lib/daily-plan";
import { formatExamDate, nextExamDate, parseExamDate, upcomingExamDates } from "../lib/jlpt/exam-dates";
import { JLPT_TARGETS, type JlptTarget } from "../lib/jlpt/plan";
import { previewLevelPlan } from "../lib/plan/content-matrix";
import {
  familiarityDefaults,
  getLevelPlanSettings,
  saveLevelPlanSettings,
  type Familiarity,
  type StartingLevel
} from "../lib/level-plan";
import { claimLevelPlanTrial } from "../lib/sync-api";
import { getEntitlements } from "../lib/entitlements";
import { saveStudyMode } from "../lib/studyMode";
import { refreshTodayWordPlan } from "../lib/api";
import { refreshMixedCardTasks } from "../lib/mixed-cards";
import { getDatabase } from "../lib/database";
import { notifyProgressUpdated } from "../lib/progress-events";
import { deferWordPlanUntilKanaComplete } from "../lib/kana-progress";
import { MascotSay } from "./MascotSay";
import { Sticker } from "./CapybaraMascot";
import { ExamDateWheel } from "./ExamDateWheel";

const STARTS: Array<{ value: StartingLevel; label: string }> = [
  { value: "kana-none", label: "不懂五十音" },
  { value: "kana", label: "会五十音" },
  ...JLPT_TARGETS.map((value) => ({ value, label: value }))
];
const FAMILIARITY_LABELS: Record<keyof Familiarity, string> = {
  words: "单词", grammar: "语法", kanji: "汉字", confusion: "辨析"
};
const SLIDER_TEXT: Record<number, string> = { 0: "没学过", 25: "有点印象", 50: "学过一些", 75: "比较熟", 100: "很熟" };

interface Props {
  open: boolean;
  dismissible?: boolean;
  onComplete: (message: string) => void;
  onClose?: () => void;
}

export function LevelSetup({ open, dismissible = false, onComplete, onClose }: Props) {
  const existing = getLevelPlanSettings();
  const examOptions = upcomingExamDates().map(formatExamDate);
  const [startingLevel, setStartingLevel] = useState<StartingLevel>(existing?.startingLevel ?? "kana");
  const [target, setTarget] = useState<JlptTarget>(existing?.target ?? "N3");
  const [examDate, setExamDate] = useState(existing?.examDate && examOptions.includes(existing.examDate) ? existing.examDate : formatExamDate(nextExamDate()));
  const [familiarity, setFamiliarity] = useState<Familiarity>(existing?.familiarity ?? familiarityDefaults("kana"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;

  const samePlan = existing?.startingLevel === startingLevel && existing.target === target
    && existing.examDate === examDate && JSON.stringify(existing.familiarity) === JSON.stringify(familiarity);
  const preview = previewLevelPlan({
    startingLevel, target, familiarity,
    examDate: parseExamDate(examDate) ?? nextExamDate(),
    startedOn: samePlan ? parseExamDate(existing?.startedOn ?? "") ?? undefined : undefined
  });

  const chooseStart = (value: StartingLevel) => {
    setStartingLevel(value);
    setFamiliarity(familiarityDefaults(value));
  };
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await saveLevelPlanSettings({ startingLevel, familiarity, target, examDate });
      const preset = applyExamPreset(target);
      if (startingLevel === "kana-none") deferWordPlanUntilKanaComplete(preset.plan.words.fresh);
      let entitlement = getEntitlements();
      if (!entitlement.isPro) {
        try { entitlement = await claimLevelPlanTrial() ?? entitlement; } catch { /* 领取失败就按现有权益继续。 */ }
      }
      saveStudyMode(entitlement?.isPro ? "mixed" : "classic");
      refreshTodayWordPlan();
      refreshMixedCardTasks(getDatabase());
      notifyProgressUpdated();
      const accessText = entitlement?.source === "trial" ? "7 天完整计划试用已开始。" : entitlement?.isPro ? "完整计划已启用。" : "计划已创建；当前先安排单词。";
      onComplete(`${accessText} 先完成今天的任务。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "计划创建失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-start justify-center overflow-hidden bg-black/65 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="设定学习计划">
      <div className="level-setup flex h-full min-h-0 w-full max-w-2xl flex-col bg-[#FFF9ED] shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-3xl">
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Sticker name="mood-wave" size={64} className="shrink-0" />
              <div><p className="text-xs font-bold text-[#746250]">建立学习计划</p><h2 className="mt-1 text-2xl font-black leading-tight">先选起点，再定目标</h2></div>
            </div>
            {dismissible && <button className="level-setup-option focus-ring h-11 w-11 shrink-0 rounded-full" onClick={onClose} aria-label="关闭"><X size={18} /></button>}
          </div>

          <p className="mt-7 text-base font-black">你现在学到哪里？</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {STARTS.slice(0, 2).map((item) => <button key={item.value} aria-pressed={startingLevel === item.value} onClick={() => chooseStart(item.value)} className="level-setup-option focus-ring min-h-12 rounded-2xl px-2 text-sm font-bold">{item.label}</button>)}
          </div>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {STARTS.slice(2).map((item) => <button key={item.value} aria-pressed={startingLevel === item.value} onClick={() => chooseStart(item.value)} className="level-setup-option focus-ring min-h-12 rounded-2xl text-sm font-bold">{item.label}</button>)}
          </div>
          <button disabled className="level-setup-option mt-2 min-h-11 w-full rounded-2xl px-3 text-left text-sm font-bold">专业进阶 · 内容准备中</button>

          <p className="mt-7 text-base font-black">准备考哪级？</p>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {JLPT_TARGETS.map((level) => <button key={level} aria-pressed={target === level} onClick={() => setTarget(level)} className="level-setup-option focus-ring min-h-12 rounded-2xl text-sm font-bold">{level}</button>)}
          </div>
          <p className="mt-6 text-base font-black">选一场 JLPT 考试</p>
          <p className="mt-1 text-xs text-[#71685c]">上下滚动或点选日期；尚未公布的考期标为“预计”。</p>
          <div className="mt-3"><ExamDateWheel value={examDate} onChange={setExamDate} /></div>

          <p className="mt-6 text-base font-black">这些内容你有多熟？</p>
          <div className="level-setup-details mt-3 space-y-4 rounded-2xl p-4">
            {(Object.keys(FAMILIARITY_LABELS) as Array<keyof Familiarity>).map((kind) => <label key={kind} className="block">
              <span className="flex justify-between text-sm font-bold"><span>{FAMILIARITY_LABELS[kind]}</span><span className="text-[#746250]">{SLIDER_TEXT[familiarity[kind]]}</span></span>
              <input className="mt-2 w-full accent-[#78AD52]" type="range" min={0} max={100} step={25} value={familiarity[kind]} onChange={(event) => setFamiliarity({ ...familiarity, [kind]: Number(event.target.value) })} />
            </label>)}
          </div>

          {/* 估算：吉祥物说出来。来得及是攥拳，来不及是吓一跳 + 琥珀底 */}
          <MascotSay sticker={preview.feasible ? "mood-fired-up" : "mood-shocked"} tone={preview.feasible ? "info" : "warn"} size={64} className="mt-5">
            按这个起点，一共要学 <b>{preview.content.words}</b> 个词。考前约 {preview.intakeDays} 天能进新词，
            每天要 <b>{preview.required.words}</b> 个，现在最多排 {preview.daily.words} 个。
            另有语法 {preview.content.grammar} 条、汉字 {preview.content.kanji} 张、辨析 {preview.content.confusion} 组。
            {!preview.feasible && <><br /><b>照每天的上限，这场考前学不完。</b>换一场考期或者降一级目标吧。</>}
            {startingLevel === "kana-none" && <><br />五十音按真的学会了多少来算，没学完就往后顺延。</>}
          </MascotSay>
          {error && <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
        <div className="shrink-0 border-t border-[#E8DDCD] bg-[#FFF9ED] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl sm:px-7 sm:py-5">
          <button disabled={saving || !examDate} onClick={submit} className="level-setup-submit focus-ring h-12 w-full rounded-2xl text-base font-black disabled:opacity-50">{saving ? "正在建立计划…" : "保存并查看今天怎么学 →"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
