import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import {
  dayStatusesBetween, repairableStreakDays, streakSnapshot, STREAK_LIT, STREAK_MILESTONES,
  type DayStatus, type StreakSnapshot
} from "../../lib/streak";
import { repairCards, repairDay, repairDayWithCard, repairPrice, yuzuBalance, YUZU, YUZU_EVENT } from "../../lib/yuzu";
import { useProgressUpdates } from "../../lib/use-progress-updates";
import { useCountUp } from "../../hooks/useCountUp";
import { StreakFlame, flameStateOf } from "./StreakFlame";
import "./streak.css";
import "./StreakPageView.css";

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/** 「YYYY-MM」往前后挪 n 个月 */
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** 一个月的格子：周一起排，前面补空 */
const monthCells = (ym: string): (string | null)[] => {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`)
  ];
};

/** 今天还差多少：挑离门槛更近的那一个说 */
const todayLeft = (s: StreakSnapshot) => {
  const answersLeft = Math.max(0, STREAK_LIT.answers - s.todayAnswers);
  const minutesLeft = Math.max(1, Math.ceil((STREAK_LIT.seconds - s.todaySeconds) / 60));
  const byAnswers = s.todayAnswers / STREAK_LIT.answers >= s.todaySeconds / STREAK_LIT.seconds;
  return byAnswers ? `再答 ${answersLeft} 题` : `再学 ${minutesLeft} 分钟`;
};

/** 里程碑之路上的位置：第 i 个里程碑记作 i+1，两站之间按天数线性插值 */
const roadPosition = (streak: number) => {
  let previous = 0;
  for (let i = 0; i < STREAK_MILESTONES.length; i += 1) {
    const m = STREAK_MILESTONES[i];
    if (streak < m) return i + (streak - previous) / (m - previous);
    previous = m;
  }
  return STREAK_MILESTONES.length;
};

/*
 * 连胜详情页（规格 §5）。2026-10-14 作者看了第一版说「丑」「太多二级界面太啰嗦」：
 * 一块卡套一个数、吉祥物气泡把天数再说一遍、里程碑和日历各开一张卡。现在整页只有一条流：
 * 火苗 + 天数 + 一行事实（不开框）→ 里程碑之路（一条线）→ 日历（直接铺在页面底色上）→ 一行规则。
 * 这一页的主角是火苗，不放吉祥物（一屏一个主角，见 docs/FRONTEND_V3_PLAN.md §1.1）。
 */
export function StreakPageView({ onBack }: { onBack: () => void }) {
  const [snap, setSnap] = useState<StreakSnapshot | null>(null);
  const [month, setMonth] = useState("");
  const [statuses, setStatuses] = useState<Record<string, DayStatus>>({});
  const [gaps, setGaps] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const count = useCountUp(snap?.streak ?? 0);

  const refresh = useCallback(() => {
    try {
      const next = streakSnapshot();
      setSnap(next);
      setGaps(repairableStreakDays());
      setMonth((current) => current || next.today.slice(0, 7));
    } catch { /* 库还没就位：保持加载态 */ }
  }, []);
  useEffect(refresh, [refresh]);
  useProgressUpdates(refresh);
  useEffect(() => {
    window.addEventListener(YUZU_EVENT, refresh);
    return () => window.removeEventListener(YUZU_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!month || !snap) return;
    const cells = monthCells(month).filter((d): d is string => !!d);
    try { setStatuses(dayStatusesBetween(cells[0], cells[cells.length - 1])); } catch { setStatuses({}); }
  }, [month, snap]);

  if (!snap) {
    return <div className="stk"><p className="stk-loading">正在数火苗…</p></div>;
  }

  const state = flameStateOf(snap.todayStatus);
  const next = snap.nextMilestone;
  const road = roadPosition(snap.streak) / STREAK_MILESTONES.length;
  const cards = repairCards();
  const price = repairPrice();
  const canAfford = cards > 0 || yuzuBalance() >= price;
  const nowMonth = snap.today.slice(0, 7);
  const status = state === "gold" ? "今天是大火苗"
    : state === "lit" ? "小火苗点着了 · 清完计划变大火苗"
      : snap.streak > 0 ? `今天还没点火 · ${todayLeft(snap)}` : `${todayLeft(snap)}，火苗就点着了`;

  const doRepair = (day: string) => {
    const ok = cards > 0 ? repairDayWithCard(day) : repairDay(day);
    setPicked(null);
    if (ok) refresh();
  };

  return (
    <div className="stk">
      <div className="page-backbar stk-backbar">
        <button type="button" onClick={onBack} className="stk-back"><ArrowLeft size={17} />返回</button>
        <p>连续学习</p>
      </div>

      <section className={`stk-hero stk-hero-${state}`}>
        <StreakFlame state={state} tier={snap.tier} size={128} atRisk={snap.atRisk} />
        <div className="stk-count"><b>{count}</b><span>天连续</span></div>
        <p className={`stk-status${snap.atRisk ? " is-risk" : ""}`}>{status}</p>
        <ul className="stk-facts">
          <li className="stk-fact"><b>{snap.longest}</b>最长</li>
          <li className="stk-fact"><b>{snap.litDays}</b>累计</li>
          <li className="stk-fact is-gold"><b>{snap.goldInStreak % 7}<small>/7</small></b>大火苗</li>
        </ul>
      </section>

      <section className="stk-road" aria-label={next ? `下一站 ${next} 天，还差 ${next - snap.streak} 天` : "全部里程碑都到了"}>
        <div className="stk-road-line">
          <span className="stk-road-fill" style={{ width: `${Math.round(road * 1000) / 10}%` }} />
          <span className="stk-road-me" style={{ left: `${Math.round(road * 1000) / 10}%` }}>
            <StreakFlame state={state === "off" ? "lit" : state} tier={1} size={20} />
          </span>
        </div>
        <ol className="stk-road-stops">
          {STREAK_MILESTONES.map((m, i) => (
            <li key={m} className={`stk-road-stop${snap.streak >= m ? " is-got" : ""}${m === next ? " is-next" : ""}`} style={{ "--i": i } as CSSProperties}>
              <b>{m}</b>
            </li>
          ))}
        </ol>
        {next && <p className="stk-road-hint">下一站 {next} 天 · 还差 {next - snap.streak} 天</p>}
      </section>

      <section className="stk-month-block">
        <div className="stk-month">
          <button type="button" className="stk-month-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上个月"><ChevronLeft size={18} /></button>
          <h2>{Number(month.slice(0, 4))} 年 {Number(month.slice(5, 7))} 月</h2>
          <button type="button" className="stk-month-btn" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= nowMonth} aria-label="下个月"><ChevronRight size={18} /></button>
        </div>
        <div className="stk-cal">
          {WEEK_LABELS.map((w) => <small key={w}>{w}</small>)}
          {monthCells(month).map((day, index) => {
            if (!day) return <span key={`b${index}`} />;
            const dayStatus = statuses[day] ?? "none";
            const repairable = gaps.includes(day);
            const cls = `stk-day${day === snap.today ? " is-today" : ""}${day > snap.today ? " is-future" : ""}${repairable ? " is-gap" : ""}${picked === day ? " is-picked" : ""}`;
            const body = dayStatus === "none"
              ? <i className="stk-day-n">{Number(day.slice(8))}</i>
              : <StreakFlame state={flameStateOf(dayStatus)} tier={1} size={22} />;
            return repairable
              ? <button key={day} type="button" className={cls} onClick={() => setPicked(picked === day ? null : day)} aria-label={`补签 ${day}`}>{body}<em>补</em></button>
              : <span key={day} className={cls}>{body}{dayStatus === "repaired" && <em>补</em>}</span>;
          })}
        </div>
        {picked && (
          <div className="stk-repair">
            <p>补上 {Number(picked.slice(5, 7))} 月 {Number(picked.slice(8))} 日 · {cards > 0 ? "用一张补签卡" : `${price} 柚子`}</p>
            <button type="button" className="ds-btn" disabled={!canAfford} onClick={() => doRepair(picked)}>{canAfford ? "补上" : "柚子不够"}</button>
          </div>
        )}
      </section>

      <p className="stk-foot">
        答 {STREAK_LIT.answers} 题或学 {STREAK_LIT.seconds / 60} 分钟点亮小火苗，连胜不断 · 清完计划变大火苗，攒满 7 个得 {YUZU.streak7} 柚子
      </p>
    </div>
  );
}
