import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../../app/AppContext";
import { isStreakMilestone, dayStatusesBetween, repairableStreakDays, streakSnapshot, streakTier, todayStreakStatus } from "../../lib/streak";
import { today } from "../../lib/database/db-utils";
import { autoSyncReminderNotifications } from "../../lib/notifications";
import { useProgressUpdates } from "../../lib/use-progress-updates";
import { weekDays } from "../../lib/zoo-streak";
import { YUZU } from "../../lib/yuzu";
import { triggerRevealHaptic } from "../../lib/haptics";
import { StreakCelebration, type StreakCelebrationProps } from "./StreakCelebration";
import { StreakFlame } from "./StreakFlame";
import "./streak.css";

/*
 * 连胜的两个「时刻」（规格 §4）。
 *
 * 为什么不是挂在 AppShell 里的一个全局常驻层：小程序里每个页面各有一份 AppShell，
 * 打开过的页面都挂在后台，全局层会在看不见的页面里各弹一份，切回去时还停在那里。
 * 所以做成两个小组件，放进「会停下来的那一屏」里，谁可见谁负责：
 *   - <StreakCelebrationGate/>：主页、单词完成页、各模式的结束页。挂上时看今天要不要庆祝。
 *   - <StreakSpark/>：学习页。答题过程中跨过「亮」的那一下冒个小胶囊，不打断。
 *
 * 「这一级今天庆祝过没有」记在 localStorage，按学习日分键：设备偏好，不同步（换台设备再看一次无妨）。
 */

const celebratedKey = (day: string) => `mn-streak-celebrated:${day}`;
const sparkKey = (day: string) => `mn-streak-spark:${day}`;
const readFlag = (key: string) => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } };
const writeFlag = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* 无痕模式：大不了再放一次 */ } };

/** 今天要放哪一版；不该放就是 null。算出来就立刻记账，免得同一屏重渲染时再放一遍 */
export const claimStreakCelebration = (): Omit<StreakCelebrationProps, "onClose" | "onRepair"> | null => {
  const snap = streakSnapshot();
  if (snap.todayStatus === "none") return null;
  const done = readFlag(celebratedKey(snap.today));
  const want = snap.todayStatus === "gold" ? "gold" : "lit";
  if (done === "gold" || done === want) return null;
  const kind = done === "lit" ? "gold" : want === "gold" ? "lit+gold" : "lit";
  writeFlag(celebratedKey(snap.today), want);

  const lights = kind !== "gold";
  const to = snap.streak;
  const from = lights ? Math.max(0, to - 1) : to;
  const days = weekDays(snap.today);
  const statuses = dayStatusesBetween(days[0], days[6]);
  return {
    kind,
    from,
    to,
    tierFrom: Math.max(1, streakTier(from)),
    tierTo: Math.max(1, streakTier(to)),
    week: days.map((day) => (day > snap.today ? "none" : statuses[day] ?? "none")),
    todayIndex: days.indexOf(snap.today),
    milestone: lights && isStreakMilestone(to) ? to : null,
    // 奖励跟大火苗走：今天变金、且这一段连胜里的大火苗刚好攒满 7 的倍数（和 settleYuzu 同一判据）
    yuzu: kind !== "lit" && snap.goldInStreak > 0 && snap.goldInStreak % 7 === 0 ? YUZU.streak7 : 0,
    firstEver: lights && to === 1 && snap.everLitBefore === 0,
    rekindled: lights && to === 1 && snap.everLitBefore >= 3,
    canRepair: lights && to === 1 && repairableStreakDays().length > 0
  };
};

export function StreakCelebrationGate() {
  const { navigate } = useApp();
  const [show, setShow] = useState<ReturnType<typeof claimStreakCelebration>>(null);
  const check = () => {
    if (show) return;
    // 领到了才 set：claim 第二次一定是 null（已记账），直接 set 会把第一次领到的冲掉（StrictMode 双跑 effect 就是这样）
    try { const claimed = claimStreakCelebration(); if (claimed) setShow(claimed); } catch { /* 库没就位就下次再说 */ }
  };
  // 挂上时看一次；停在这一屏时状态又升了一级（比如完成页上点了「一键完成」）也接得住
  useEffect(check, []); // eslint-disable-line react-hooks/exhaustive-deps
  useProgressUpdates(check);
  if (!show) return null;
  // portal：学习页外壳带 transform（下拉手势），fixed 在它里面会被困在外壳里
  return createPortal(
    <StreakCelebration
      {...show}
      onClose={() => setShow(null)}
      onRepair={() => { setShow(null); navigate("streak"); }}
    />,
    document.body
  );
}

/** 学习中跨过「亮」：顶上滑下一枚小胶囊，1.8 秒自己收回。今天亮过了就不再查库 */
export function StreakSpark() {
  const [day, setDay] = useState("");
  const settled = useRef(false);
  const check = () => {
    if (settled.current) return;
    try {
      if (todayStreakStatus() === "none") return;
      settled.current = true;
      // 今天的学习提醒不用再发了，明天那条的天数也变了（规格 §6）
      void autoSyncReminderNotifications().catch(() => undefined);
      const day = today();
      if (readFlag(sparkKey(day)) || readFlag(celebratedKey(day))) return;
      writeFlag(sparkKey(day), "1");
      triggerRevealHaptic();
      setDay(day);
    } catch { /* 下一题再看 */ }
  };
  // 进页面时今天已经亮了：直接收工，不弹
  useEffect(() => {
    try {
      if (todayStreakStatus() !== "none") settled.current = true;
    } catch { /* 下一题再看 */ }
  }, []);
  useProgressUpdates(check);
  // 只有单词那条路会发「进度更新」；语法 / JLPT / 拼写 / 开口的作答和「学满 5 分钟」都不发，
  // 所以再隔 20 秒问一次。todayStreakStatus 只查今天那几行，亮了之后 settled 就不再查。
  useEffect(() => {
    const id = window.setInterval(check, 20_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!day) return;
    const id = window.setTimeout(() => setDay(""), 1900);
    return () => window.clearTimeout(id);
  }, [day]);
  if (!day) return null;
  return createPortal(
    <div className="sc-toast" role="status" aria-live="polite">
      <StreakFlame state="lit" tier={1} size={26} />今天的火苗亮了
    </div>,
    document.body
  );
}
