import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import {
  dayStatusesBetween, repairableStreakDays, streakSnapshot, STREAK_LIT, STREAK_MILESTONES,
  type DayStatus, type StreakSnapshot
} from "../../lib/streak";
import { repairCards, repairDay, repairDayWithCard, repairPrice, yuzuBalance, YUZU, YUZU_EVENT } from "../../lib/yuzu";
import { useProgressUpdates } from "../../lib/use-progress-updates";
import { MascotSay } from "../MascotSay";
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

/** 今天还没亮时，挑离门槛更近的那一个说 */
const todayHint = (s: StreakSnapshot) => {
  const answersLeft = Math.max(0, STREAK_LIT.answers - s.todayAnswers);
  const minutesLeft = Math.max(1, Math.ceil((STREAK_LIT.seconds - s.todaySeconds) / 60));
  const byAnswers = s.todayAnswers / STREAK_LIT.answers >= s.todaySeconds / STREAK_LIT.seconds;
  const left = byAnswers ? `再答 ${answersLeft} 题` : `再学 ${minutesLeft} 分钟`;
  return s.streak > 0 ? `连续 ${s.streak} 天，今天还没点火。${left}就亮。` : `${left}，火苗就点着了。`;
};

export function StreakPageView({ onBack }: { onBack: () => void }) {
  const [snap, setSnap] = useState<StreakSnapshot | null>(null);
  const [month, setMonth] = useState("");
  const [statuses, setStatuses] = useState<Record<string, DayStatus>>({});
  const [gaps, setGaps] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

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
  const prevMilestone = [...STREAK_MILESTONES].reverse().find((m) => m <= snap.streak) ?? 0;
  const progress = next ? Math.min(1, (snap.streak - prevMilestone) / (next - prevMilestone)) : 1;
  const cards = repairCards();
  const price = repairPrice();
  const canAfford = cards > 0 || yuzuBalance() >= price;
  const nowMonth = snap.today.slice(0, 7);

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
        <StreakFlame state={state} tier={snap.tier} size={120} atRisk={snap.atRisk} />
        <div className="stk-hero-count">
          <b>{snap.streak}</b><span>天</span>
        </div>
        <p className="stk-hero-caption">连续学习</p>
      </section>

      <MascotSay
        sticker={state === "off" ? (snap.atRisk ? "mood-shocked" : "mood-fight") : state === "gold" ? "mood-proud" : "mood-fired-up"}
        tone={state === "off" && snap.atRisk ? "warn" : "good"}
        className="ds-say-onbg stk-say"
      >
        {state === "off" ? todayHint(snap) : state === "gold" ? "今天是大火苗。" : "小火苗点着了，连胜保住。清完计划变大火苗。"}
      </MascotSay>

      <section className="stk-stats">
        <div><b>{snap.longest}</b><span>最长连续</span></div>
        <div><b>{snap.litDays}</b><span>累计学习天数</span></div>
        <div className="stk-stat-gold"><b>{snap.goldInStreak % 7}<small>/7</small></b><span>大火苗 · 满 7 得 {YUZU.streak7} 柚子</span></div>
      </section>

      <section className="stk-card">
        <h2 className="stk-h">{next ? <>下一站 <b>{next}</b> 天</> : "全部里程碑都到了"}</h2>
        {next && (
          <div className="stk-bar" role="img" aria-label={`${snap.streak} / ${next}`}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
            <em>{snap.streak} / {next}</em>
          </div>
        )}
        <ol className="stk-badges">
          {STREAK_MILESTONES.map((m) => (
            <li key={m} className={snap.longest >= m ? "is-got" : ""}><b>{m}</b></li>
          ))}
        </ol>
      </section>

      <section className="stk-card">
        <div className="stk-month">
          <button type="button" className="stk-month-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上个月"><ChevronLeft size={18} /></button>
          <h2 className="stk-h">{Number(month.slice(0, 4))} 年 {Number(month.slice(5, 7))} 月</h2>
          <button type="button" className="stk-month-btn" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= nowMonth} aria-label="下个月"><ChevronRight size={18} /></button>
        </div>
        <div className="stk-cal">
          {WEEK_LABELS.map((w) => <small key={w}>{w}</small>)}
          {monthCells(month).map((day, index) => {
            if (!day) return <span key={`b${index}`} />;
            const status = statuses[day] ?? "none";
            const repairable = gaps.includes(day);
            const cls = `stk-day${day === snap.today ? " is-today" : ""}${day > snap.today ? " is-future" : ""}${repairable ? " is-gap" : ""}${picked === day ? " is-picked" : ""}`;
            const body = status === "none"
              ? <i className="stk-day-n">{Number(day.slice(8))}</i>
              : <StreakFlame state={flameStateOf(status)} tier={1} size={22} />;
            return repairable
              ? <button key={day} type="button" className={cls} onClick={() => setPicked(picked === day ? null : day)} aria-label={`补签 ${day}`}>{body}<em>补</em></button>
              : <span key={day} className={cls}>{body}{status === "repaired" && <em>补</em>}</span>;
          })}
        </div>
        {picked && (
          <div className="stk-repair">
            <p>补上 {Number(picked.slice(5, 7))} 月 {Number(picked.slice(8))} 日？{cards > 0 ? "用一张补签卡" : `${price} 柚子`}</p>
            <button type="button" className="ds-btn" disabled={!canAfford} onClick={() => doRepair(picked)}>{canAfford ? "补上" : "柚子不够"}</button>
          </div>
        )}
        <p className="stk-legend">
          <span><StreakFlame state="lit" tier={1} size={16} />亮了</span>
          <span><StreakFlame state="gold" tier={1} size={16} />清完计划</span>
          <span><i className="stk-legend-gap">补</i>可补签</span>
        </p>
      </section>

      <MascotSay sticker="mood-idea" className="ds-say-onbg stk-say">
        答满 {STREAK_LIT.answers} 题或学满 {STREAK_LIT.seconds / 60} 分钟点亮小火苗，连胜不断；清完当天计划变成大火苗，攒满 7 个得 {YUZU.streak7} 柚子。
      </MascotSay>
    </div>
  );
}
