import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { applyExamPreset, previewCurrentLevelPlan } from "../lib/daily-plan";
import { examLabel, EXAM_TYPES, formatExamDate, parseExamDate, suggestedExamDate, type ExamKind } from "../lib/jlpt/exam-dates";
import { JLPT_TARGETS, type JlptTarget } from "../lib/jlpt/plan";
import {
  familiarityDefaults,
  getLevelPlanSettings,
  saveLevelPlanSettings,
  type Familiarity,
  type StartingLevel
} from "../lib/level-plan";
import { getEntitlements } from "../lib/entitlements";
import { saveStudyMode } from "../lib/studyMode";
import { refreshTodayWordPlan } from "../lib/api";
import { refreshMixedCardTasks } from "../lib/mixed-cards";
import { getDatabase } from "../lib/database";
import { notifyProgressUpdated } from "../lib/progress-events";
import { deferWordPlanUntilKanaComplete } from "../lib/kana-progress";
import { MascotSay } from "./MascotSay";
import { Sticker } from "./CapybaraMascot";
import { ExamDatePicker } from "./ExamDatePicker";

const KANA_STARTS: Array<{ value: StartingLevel; label: string; hint: string }> = [
  { value: "kana-none", label: "不懂五十音", hint: "从假名开始，约一周" },
  { value: "kana", label: "会五十音", hint: "从 N5 单词起步" }
];
const FAMILIARITY_LABELS: Record<keyof Familiarity, string> = {
  words: "单词", grammar: "语法", kanji: "汉字", confusion: "辨析"
};
const SLIDER_TEXT: Record<number, string> = { 0: "没学过", 25: "有点印象", 50: "学过一些", 75: "比较熟", 100: "很熟" };

/** 一步一个问题：左边一枚序号，标题下面放选项 */
const Step = ({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) => (
  <section className="ls-step">
    <h3 className="ls-step-title"><span className="ls-step-n">{n}</span>{title}</h3>
    {hint && <p className="ls-step-hint">{hint}</p>}
    <div className="mt-3">{children}</div>
  </section>
);

interface Props {
  open: boolean;
  dismissible?: boolean;
  onComplete: (message: string) => void;
  onClose?: () => void;
}

export function LevelSetup({ open, dismissible = false, onComplete, onClose }: Props) {
  const existing = getLevelPlanSettings();
  const [startingLevel, setStartingLevel] = useState<StartingLevel>(existing?.startingLevel ?? "kana");
  const [target, setTarget] = useState<JlptTarget>(existing?.target ?? "N3");
  const [examKind, setExamKind] = useState<ExamKind>(existing?.examKind ?? "jlpt");
  const suggestedDate = suggestedExamDate(existing?.examKind ?? "jlpt");
  const savedDate = parseExamDate(existing?.examDate ?? "");
  const [examDate, setExamDate] = useState(savedDate && savedDate >= new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
    ? formatExamDate(savedDate) : suggestedDate ? formatExamDate(suggestedDate) : "");
  const [familiarity, setFamiliarity] = useState<Familiarity>(existing?.familiarity ?? familiarityDefaults("kana"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;

  const samePlan = existing?.startingLevel === startingLevel && existing.target === target && existing.examKind === examKind
    && existing.examDate === examDate && JSON.stringify(existing.familiarity) === JSON.stringify(familiarity);
  const preview = examDate ? previewCurrentLevelPlan({
    startingLevel, target, familiarity,
    examDate: parseExamDate(examDate) ?? new Date(Date.now() + 90 * 86_400_000),
    startedOn: samePlan ? parseExamDate(existing?.startedOn ?? "") ?? undefined : undefined
  }) : null;

  const chooseStart = (value: StartingLevel) => {
    setStartingLevel(value);
    setFamiliarity(familiarityDefaults(value));
  };
  const chooseExam = (value: ExamKind) => {
    setExamKind(value);
    const next = suggestedExamDate(value);
    setExamDate(next ? formatExamDate(next) : "");
  };
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await saveLevelPlanSettings({ startingLevel, familiarity, target, examKind, examDate });
      const preset = applyExamPreset(target);
      if (startingLevel === "kana-none") deferWordPlanUntilKanaComplete(preset.plan.words.fresh);
      const entitlement = getEntitlements();
      saveStudyMode(entitlement?.isPro ? "mixed" : "classic");
      refreshTodayWordPlan();
      refreshMixedCardTasks(getDatabase());
      notifyProgressUpdated();
      const accessText = entitlement.isPro ? "完整计划已启用。" : "计划已创建；当前先安排单词。";
      onComplete(`${accessText} 先完成今天的任务。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "计划创建失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="ls-backdrop" role="dialog" aria-modal="true" aria-label="设定学习计划">
      <div className="ls-sheet">
        <div className="ls-scroll">
          <header className="ls-head">
            <Sticker name="mood-wave" size={84} className="ls-head-mascot" />
            <div className="min-w-0 flex-1">
              <p className="ds-kicker">{dismissible ? "调整学习计划" : "欢迎来到收集日"}</p>
              <h2 className="ls-title">先定个小目标</h2>
              <p className="ls-sub">四件事，选完就排好每天学什么。之后随时能改。</p>
            </div>
            {dismissible && <button className="ds-icon-btn focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-full" onClick={onClose} aria-label="关闭"><X size={18} /></button>}
          </header>

          <Step n={1} title="你现在学到哪里？">
            <div className="grid grid-cols-2 gap-2">
              {KANA_STARTS.map((item) => <button key={item.value} aria-pressed={startingLevel === item.value} onClick={() => chooseStart(item.value)} className="ls-option ls-option-tall focus-ring">
                <b>{item.label}</b><small>{item.hint}</small>
              </button>)}
            </div>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {JLPT_TARGETS.map((level) => <button key={level} aria-pressed={startingLevel === level} onClick={() => chooseStart(level)} className="ls-option focus-ring">{level}</button>)}
            </div>
            <button disabled className="ls-option ls-option-soon mt-2 w-full">专业进阶 · 内容准备中</button>
          </Step>

          <Step n={2} title="准备学到哪一级内容？">
            <div className="grid grid-cols-5 gap-2">
              {JLPT_TARGETS.map((level) => <button key={level} aria-pressed={target === level} onClick={() => setTarget(level)} className="ls-option focus-ring">{level}</button>)}
            </div>
            <p className="mt-2 text-xs jp-muted">N 级只表示本站练习素材范围，不代表其他考试的考纲或分数。</p>
          </Step>

          <Step n={3} title="准备参加哪种考试？" hint="已公布的场次会列出；其他考试可按准考信息选日期。">
            <div className="grid grid-cols-2 gap-2">
              {EXAM_TYPES.map(({ kind, label }) => <button key={kind} type="button" aria-pressed={examKind === kind} onClick={() => chooseExam(kind)} className="ls-option focus-ring">{label}</button>)}
            </div>
            <div className="mt-3"><ExamDatePicker key={examKind} kind={examKind} value={examDate} onChange={setExamDate} /></div>
          </Step>

          <Step n={4} title="这些内容你有多熟？">
            <div className="ls-sliders">
              {(Object.keys(FAMILIARITY_LABELS) as Array<keyof Familiarity>).map((kind) => <label key={kind} className="block">
                <span className="flex items-center justify-between text-sm font-bold"><span>{FAMILIARITY_LABELS[kind]}</span><span className="ds-pill ds-pill-primary">{SLIDER_TEXT[familiarity[kind]]}</span></span>
                <input className="mt-2 w-full" type="range" min={0} max={100} step={25} value={familiarity[kind]} onChange={(event) => setFamiliarity({ ...familiarity, [kind]: Number(event.target.value) })} />
              </label>)}
            </div>
          </Step>

          {/* 估算：吉祥物说出来。来得及是攥拳，来不及是吓一跳 + 琥珀底 */}
          {preview ? <MascotSay sticker={preview.feasible ? "mood-fired-up" : "mood-shocked"} tone={preview.feasible ? "good" : "warn"} size={68} className="mt-6">
            <span className="ls-say-head">每天 <b>{preview.required.words}</b> 个新词</span>
            考前约 {preview.intakeDays} 天能进新，一共 {preview.content.words} 个词（每天最多排 {preview.daily.words} 个）。
            另有语法 {preview.content.grammar} 条、汉字 {preview.content.kanji} 张、辨析 {preview.content.confusion} 组。
            {examKind !== "jlpt" && <><br />按 {examLabel(examKind)} 备考时，这里仍按本站 N 级素材估算，不代表该考试考纲覆盖率。</>}
            {!preview.feasible && <><br /><b>照每天的上限，这场考前学不完。</b>换一场考期或者降一级目标吧。</>}
            {startingLevel === "kana-none" && <><br />五十音按真的学会了多少来算，没学完就往后顺延。</>}
          </MascotSay> : <p className="mt-5 text-sm jp-muted">选择考试日期后，会估算每天的学习量和这场考试前是否来得及。</p>}
          {error && <div role="alert"><MascotSay sticker="mood-dizzy" tone="warn" className="mt-3">{error}</MascotSay></div>}
        </div>
        <div className="ls-foot">
          {/* 估算那段在最底下，选项在上面：底栏常驻一行结果，点哪个都能立刻看到变化 */}
          <p className="ls-foot-sum" aria-live="polite">
            {preview ? <>按这个计划：每天 <b>{preview.required.words}</b> 个新词
              {preview.feasible ? <span className="ds-pill ds-pill-primary">来得及</span> : <span className="ds-pill ds-pill-warn">照上限学不完</span>}</>
              : "选好考试日期后显示每日计划估算"}
          </p>
          <button disabled={saving || !examDate} onClick={submit} className="ds-btn focus-ring w-full disabled:opacity-50">{saving ? "正在建立计划…" : "保存并查看今天怎么学 →"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
