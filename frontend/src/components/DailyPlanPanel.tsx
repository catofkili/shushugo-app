import { useEffect, useMemo, useRef, useState } from "react";
import { DailyPlanRing, RING_COLORS, type RingValue } from "./DailyPlanRing";
import {
  applyExamPreset, arrangedPlan, dailyPlanView, examPreset, learnedLevel, saveDailyPlan, PLAN_KINDS, PLAN_LABELS, SECONDS_PER_CARD,
  type DailyPlanView, type PlanKind
} from "../lib/daily-plan";
import { JLPT_TARGETS, type JlptTarget } from "../lib/jlpt/plan";
import { getStudyPreferences, PREFERENCES_EVENT } from "../lib/studyPreferences";
import { refreshTodayWordPlan } from "../lib/api";
import { notifyProgressUpdated } from "../lib/progress-events";
import { refreshMixedCardTasks } from "../lib/mixed-cards";
import { getDatabase } from "../lib/database";

/**
 * 每日学习量的三个入口放在一起：圆环（随手拖）、数字表单（朴实无华，八个框）、备考一键。
 * 三者改的是同一份 studyPreferences（daily-plan.saveDailyPlan），改完重排今天的计划。
 * 主页和设置页都渲染这一个组件，`compact` 只影响布局。
 */
interface Props {
  compact?: boolean;
}

type Plan = Record<PlanKind, RingValue>;

const toPlan = (view: DailyPlanView): Plan => Object.fromEntries(
  view.segments.map((segment) => [segment.kind, { fresh: segment.fresh, review: segment.review }])
) as Plan;

const minutesFor = (plan: Plan) => Math.round(PLAN_KINDS.reduce((sum, kind) => sum + (plan[kind].fresh + plan[kind].review) * SECONDS_PER_CARD[kind], 0) / 60);

export const DailyPlanPanel = ({ compact = false }: Props) => {
  const [view, setView] = useState<DailyPlanView | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const planRef = useRef<Plan | null>(null);
  planRef.current = plan;
  const [focus, setFocus] = useState<PlanKind | null>(null);
  const [showForm, setShowForm] = useState(false);
  // 「现在 N几」从数据算出来当默认（词过半的最高一级），用户改了就按用户的
  const [currentLevel, setCurrentLevel] = useState<JlptTarget | null>(() => { try { return learnedLevel(); } catch { return null; } });
  // 「下次考 N几」只有一个：备考页 / 设置页的目标级别（jlptTarget），这里不再摆第二个选择框
  const targetLevel = getStudyPreferences().jlptTarget;
  const [presetNote, setPresetNote] = useState("");
  // 撤回栈：会话内每次改动前的快照。退出页面就没了 —— 它是「手滑了退一步」，不是历史记录。
  const [history, setHistory] = useState<Plan[]>([]);
  const dragStartRef = useRef<Plan | null>(null);

  const reload = () => {
    try {
      const next = dailyPlanView();
      setView(next);
      setPlan(toPlan(next));
    } catch {
      // 词库还没就绪：面板先空着，PROGRESS/PREFERENCES 事件到了再算
    }
  };
  useEffect(() => {
    reload();
    window.addEventListener(PREFERENCES_EVENT, reload);
    return () => window.removeEventListener(PREFERENCES_EVENT, reload);
  }, []);

  const preset = useMemo(() => { try { return examPreset(currentLevel, targetLevel); } catch { return null; } }, [currentLevel, targetLevel, view]);

  if (!view || !plan) return null;

  /**
   * 落盘 + 重排今天的计划。⚠️ 这一步很重（refreshTodayWordPlan 是几十条 SQL，重排清单要删表重建），
   * 拖圆环时**每帧只能改状态**（preview），松手那一下再 persist —— 第一版每帧都 persist，掉帧严重。
   */
  const persist = (next: Plan, standing = false) => {
    saveDailyPlan(next, standing);
    try { refreshTodayWordPlan(); refreshMixedCardTasks(getDatabase()); } catch { /* 词库没就绪，下次进页面自然会排 */ }
    notifyProgressUpdated();
  };
  /** 拖动中：只改本地状态，不写盘。第一帧记下起点，松手时压进撤回栈。 */
  const preview = (next: Plan) => {
    if (!dragStartRef.current) dragStartRef.current = plan;
    setPlan(next);
  };
  const commitDrag = () => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start || !planRef.current) return;
    setHistory((stack) => [...stack, start].slice(-30));
    persist(planRef.current);
  };
  /** 一次性改动（表单、总量、补建议、一键安排）：立刻落盘。表单填的数字是「平时额度」（standing）。 */
  const commit = (next: Plan, standing = false) => {
    setHistory((stack) => [...stack, plan].slice(-30));
    setPlan(next);
    persist(next, standing);
  };

  const total = PLAN_KINDS.reduce((sum, kind) => sum + plan[kind].fresh + plan[kind].review, 0);

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((stack) => stack.slice(0, -1));
    setPlan(previous);
    persist(previous);
  };

  /** 一键安排：复习 = 今天到期的全部，新学 = 平时的额度（daily-plan.arrangedPlan）。 */
  const arrange = () => commit(arrangedPlan(view));

  /** 改总量：四段等比缩放，四舍五入后的差额记到单词上。 */
  const setTotal = (nextTotal: number) => {
    const clean = Math.max(0, Math.min(2000, Math.floor(nextTotal) || 0));
    if (total === 0) { commit({ ...plan, words: { fresh: clean, review: 0 } }); return; }
    const ratio = clean / total;
    const next = Object.fromEntries(PLAN_KINDS.map((kind) => [kind, { fresh: Math.round(plan[kind].fresh * ratio), review: Math.round(plan[kind].review * ratio) }])) as Plan;
    const drift = clean - PLAN_KINDS.reduce((sum, kind) => sum + next[kind].fresh + next[kind].review, 0);
    next.words = { ...next.words, review: Math.max(0, next.words.review + drift) };
    commit(next);
  };

  const focused = focus ? view.segments.find((segment) => segment.kind === focus)! : null;
  const focusedCount = focus ? plan[focus].fresh + plan[focus].review : 0;

  return (
    <div className={`zoo-plan ${compact ? "zoo-plan-compact" : ""}`}>
      <div className="zoo-plan-main">
        <DailyPlanRing value={plan} onChange={preview} onCommit={commitDrag} focus={focus} onFocus={setFocus} size={compact ? 200 : 240} />
        <div className="zoo-plan-side">
          <label className="zoo-plan-total">
            <span>今天总量</span>
            <input type="number" min={0} max={2000} value={total} onChange={(event) => setTotal(Number(event.target.value))} />
          </label>
          <p className="zoo-plan-minutes">预计 {minutesFor(plan)} 分钟 · 按标准节奏算，不看你的历史</p>
          <ul className="zoo-plan-legend">
            {view.segments.map((segment) => {
              const count = plan[segment.kind].fresh + plan[segment.kind].review;
              const below = plan[segment.kind].review < segment.suggest.review || plan[segment.kind].fresh < segment.suggest.fresh;
              return (
                <li key={segment.kind} className={focus === segment.kind ? "on" : ""} onClick={() => setFocus(focus === segment.kind ? null : segment.kind)}>
                  <i style={{ background: RING_COLORS[segment.kind] }} />
                  <span>{segment.label}</span>
                  <b>{count}</b>
                  <small>新 {plan[segment.kind].fresh} · 复 {plan[segment.kind].review}{below ? " · 低于建议" : ""}</small>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {focus && focused && (
        <div className="zoo-plan-zoom" style={{ borderColor: RING_COLORS[focus] }}>
          <p className="zoo-plan-zoom-title">
            {PLAN_LABELS[focus]} · {focusedCount} 项 —— 左边新学，右边复习
          </p>
          <input
            type="range"
            min={0}
            max={focusedCount}
            value={plan[focus].fresh}
            onChange={(event) => {
              const fresh = Number(event.target.value);
              preview({ ...plan, [focus]: { fresh, review: focusedCount - fresh } });
            }}
            onPointerUp={commitDrag}
            onKeyUp={commitDrag}
            onBlur={commitDrag}
            style={{ accentColor: RING_COLORS[focus] }}
          />
          <p className="zoo-plan-zoom-meta">
            新学 <b>{plan[focus].fresh}</b>（建议 ≥ {focused.suggest.fresh}，剩 {focused.pool.unseen} 没学）
            <i aria-hidden="true">·</i>
            复习 <b>{plan[focus].review}</b>（建议 ≥ {focused.suggest.review}，今天到期 {focused.pool.due}）
          </p>
          {(plan[focus].review < focused.suggest.review || plan[focus].fresh < focused.suggest.fresh) && (
            <button
              className="zoo-plan-suggest"
              onClick={() => commit({ ...plan, [focus]: { fresh: Math.max(plan[focus].fresh, focused.suggest.fresh), review: Math.max(plan[focus].review, focused.suggest.review) } })}
            >
              补到建议值 →
            </button>
          )}
        </div>
      )}

      <div className="zoo-plan-row">
        <span className="zoo-plan-actions">
          <button className="zoo-plan-link" onClick={() => setShowForm((open) => !open)}>{showForm ? "收起数字" : "直接改数字"}</button>
          <button className="zoo-plan-link" disabled={history.length === 0} onClick={undo}>撤回</button>
          <button className="zoo-plan-link" onClick={arrange}>一键安排</button>
        </span>
        <span className="zoo-plan-dim">距下次 JLPT {view.daysLeft} 天</span>
      </div>
      {showForm && (
        <table className="zoo-plan-form">
          <thead><tr><th /><th>新学</th><th>复习</th></tr></thead>
          <tbody>
            {PLAN_KINDS.map((kind) => (
              <tr key={kind}>
                <th><i style={{ background: RING_COLORS[kind] }} />{PLAN_LABELS[kind]}</th>
                <td><input type="number" min={0} value={plan[kind].fresh} onChange={(event) => commit({ ...plan, [kind]: { ...plan[kind], fresh: Math.max(0, Number(event.target.value) || 0) } }, true)} /></td>
                <td><input type="number" min={0} value={plan[kind].review} onChange={(event) => commit({ ...plan, [kind]: { ...plan[kind], review: Math.max(0, Number(event.target.value) || 0) } })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="zoo-plan-preset">
        <span>备考一键：现在</span>
        <select value={currentLevel ?? ""} onChange={(event) => setCurrentLevel((event.target.value || null) as JlptTarget | null)}>
          <option value="">从零</option>
          {JLPT_TARGETS.map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
        <span>下次考 {targetLevel}</span>
        <button
          className="zoo-plan-apply"
          disabled={!preset}
          onClick={() => {
            const result = applyExamPreset(currentLevel, targetLevel);
            setPresetNote(`已按 ${targetLevel} 设好：每天约 ${result.minutes} 分钟，还能进新内容 ${result.intakeDays} 天`);
            try { refreshTodayWordPlan(); refreshMixedCardTasks(getDatabase()); } catch { /* 同上 */ }
            notifyProgressUpdated();
            reload();
          }}
        >
          {preset ? `设为每天约 ${preset.minutes} 分钟` : "算不出"}
        </button>
        {presetNote && <small>{presetNote}</small>}
      </div>
    </div>
  );
};
