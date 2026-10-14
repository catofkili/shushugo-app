import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { DayStatus } from "../../lib/streak";
import { jsMotionAllowed } from "../../lib/studyPreferences";
import { triggerTeamCheckinHaptic } from "../../lib/haptics";
import { playComplete, playStreakChirp, playStreakGold, playStreakIgnite } from "../../lib/zoo-sounds";
import { MascotSay } from "../MascotSay";
import type { StickerName } from "../CapybaraMascot";
import { ZooConfetti } from "../ZooConfetti";
import { StreakFlame, type FlameState } from "./StreakFlame";
import "./streak.css";

export interface StreakCelebrationProps {
  /** 这次要庆祝什么：刚亮 / 已亮过、刚变金 / 一口气亮 + 金 */
  kind: "lit" | "gold" | "lit+gold";
  from: number;
  to: number;
  tierFrom: number;
  tierTo: number;
  /** 本周一到周日的状态（终态），todayIndex 是今天在里面的下标 */
  week: DayStatus[];
  todayIndex: number;
  milestone: number | null;
  yuzu: number;
  firstEver: boolean;
  rekindled: boolean;
  canRepair: boolean;
  onClose: () => void;
  onRepair?: () => void;
}

type Look = { state: FlameState; tier: number; at: number };

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

const MILESTONE_LINES: Record<number, string> = {
  7: "一整周。", 14: "两周没断。", 30: "一个月了。", 50: "五十天。",
  100: "一百天。", 200: "两百天。", 365: "一整年。", 500: "五百天。", 1000: "一千天。"
};

/** 规格 §4.2 的编排，全部时刻在这里算一次，CSS 只吃 animation-delay */
const choreograph = (p: StreakCelebrationProps) => {
  const looks: Look[] = [];
  let t: number;
  let flipAt: number | null = null;
  let cellsAt = 0;
  if (p.kind === "gold") {
    looks.push({ state: "lit", tier: p.tierFrom, at: 0 });
    t = 350;
  } else {
    looks.push({ state: "off", tier: p.tierFrom, at: 0 }, { state: "lit", tier: p.tierFrom, at: 150 });
    flipAt = 600;
    cellsAt = 900;
    t = cellsAt + 7 * 70 + 120;
  }
  let evolveAt: number | null = null;
  if (p.tierTo > p.tierFrom) {
    evolveAt = t + 100;
    looks.push({ state: "lit", tier: p.tierTo, at: evolveAt });
    t = evolveAt + 600;
  }
  let goldAt: number | null = null;
  if (p.kind !== "lit") {
    goldAt = t + 100;
    looks.push({ state: "gold", tier: p.tierTo, at: goldAt });
    t = goldAt + 500;
  }
  let badgeAt: number | null = null;
  if (p.milestone) {
    badgeAt = t;
    t += 450;
  }
  return { looks, flipAt, cellsAt, evolveAt, goldAt, badgeAt, sayAt: t, buttonAt: t + 300 };
};

const delay = (ms: number | null): CSSProperties => ({ animationDelay: `${ms ?? 0}ms` });

/**
 * 一摞外观依次登场：每层外面一层管「退场」（下一层登场时），里面一层管「登场」。
 * 两个 animation 不能挂在同一个节点上 —— 退场那个的 backwards 填充会从 0 秒起就盖掉登场那个。
 * 基础样式是终态：除最后一层外都是透明的，所以动画被拿掉时只剩最后一层。
 */
function LookStack({ looks, render, className = "" }: { looks: Look[]; render: (look: Look) => ReactNode; className?: string }) {
  return (
    <span className={`sc-stack ${className}`}>
      {looks.map((look, index) => {
        const next = looks[index + 1];
        return (
          <span key={index} className={`sc-look-out${next ? " is-gone" : ""}`} style={next ? delay(next.at) : undefined}>
            <span className={`sc-look-in${index === 0 ? " is-first" : ""}`} style={delay(look.at)}>{render(look)}</span>
          </span>
        );
      })}
      {looks.slice(1).map((look, index) => (
        <i key={`b${index}`} className={`sc-burst sc-burst-${look.state}`} style={delay(look.at)} />
      ))}
    </span>
  );
}

const subtitle = (p: StreakCelebrationProps, evolved: boolean) => {
  if (p.kind === "gold") return "今天的计划清完了，火苗变金。";
  let line = p.milestone ? MILESTONE_LINES[p.milestone] ?? `${p.milestone} 天。`
    : p.firstEver ? "点着了。明天再来，它会长大一点。"
    : p.rekindled ? "重新点着了。"
    : "火苗又旺了一点。";
  if (evolved && !p.firstEver) line += "火苗长大了。";
  if (p.kind === "lit+gold") line += "计划也清完了，它变金了。";
  return line;
};

// ⚠️ 只用小程序主包里有的贴纸（taro-spike-2/scripts/sync-brand-assets.mjs 的 mainNames）：
// 庆祝层挂在主页 / 单词这两个主包页面上，分包里的贴纸（mood-proud、mood-fight）在那里是一张空图（10-14 开发者工具里看到过）。
const stickerFor = (p: StreakCelebrationProps): StickerName =>
  p.milestone ? "mood-yay" : p.kind === "gold" ? "mood-cheer" : p.rekindled ? "mood-wave" : "mood-fired-up";

export function StreakCelebration(props: StreakCelebrationProps) {
  const plan = useMemo(() => choreograph(props), [props]);
  const { kind, from, to, week, todayIndex, milestone, yuzu, canRepair, rekindled, onClose, onRepair } = props;
  const gold = kind !== "lit";

  useEffect(() => {
    const motion = jsMotionAllowed();
    const timers: number[] = [];
    const at = (ms: number | null, fn: () => void) => {
      if (ms === null) return;
      if (!motion) { fn(); return; }
      timers.push(window.setTimeout(fn, ms));
    };
    if (kind !== "gold") at(150, () => { playStreakIgnite(); triggerTeamCheckinHaptic(); });
    at(plan.goldAt, () => { playStreakGold(); if (kind === "gold") triggerTeamCheckinHaptic(); });
    at(plan.evolveAt, playStreakChirp);
    at(plan.badgeAt, () => { playComplete(); triggerTeamCheckinHaptic(); });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [kind, plan]);

  // 今天那格：没亮 → 亮（→ 金）；只变金的那一版从「亮」起步
  const todayLooks: Look[] = kind === "gold"
    ? [{ state: "lit", tier: 1, at: 0 }, { state: "gold", tier: 1, at: plan.goldAt ?? 0 }]
    : [{ state: "off", tier: 1, at: 0 }, { state: "lit", tier: 1, at: plan.cellsAt + todayIndex * 70 + 120 },
      ...(gold ? [{ state: "gold" as const, tier: 1, at: plan.goldAt ?? 0 }] : [])];

  return (
    <div className={`sc${gold ? " sc-is-gold" : ""}`} role="dialog" aria-modal="true" aria-label={`连续 ${to} 天`}>
      {milestone && <ZooConfettiLater at={plan.badgeAt ?? 0} />}
      <div className="sc-stage">
        {milestone && <i className="sc-rays" style={delay(plan.badgeAt)} />}
        <i className="sc-glow" />
        <LookStack className="sc-flame" looks={plan.looks} render={(look) => <StreakFlame state={look.state} tier={look.tier} size={150} />} />
        {milestone && <span className="sc-badge" style={delay(plan.badgeAt)}><b>{milestone}</b>天</span>}
      </div>

      <div className="sc-count" aria-hidden="true">
        <span className="sc-num">
          {plan.flipAt !== null && from !== to && <span className="sc-num-old" style={delay(plan.flipAt)}>{from}</span>}
          <span className="sc-num-new" style={plan.flipAt !== null && from !== to ? delay(plan.flipAt) : undefined}>{to}</span>
        </span>
        <span className="sc-unit">天</span>
      </div>
      <p className="sc-caption">连续学习</p>

      <ol className="sc-week" aria-hidden="true">
        {week.map((status, index) => (
          <li key={index} className={index === todayIndex ? "is-today" : index > todayIndex ? "is-future" : ""}
            style={delay(plan.cellsAt + index * 70)}>
            <span className="sc-cell">
              {index === todayIndex
                ? <LookStack looks={todayLooks} render={(look) => <StreakFlame state={look.state} tier={1} size={24} />} />
                : status === "none" ? <i className="sc-cell-empty" />
                : <StreakFlame state={status === "gold" ? "gold" : "lit"} tier={1} size={24} />}
              {status === "repaired" && index !== todayIndex && <em>补</em>}
            </span>
            <small>{WEEK_LABELS[index]}</small>
          </li>
        ))}
      </ol>

      <div className="sc-say" style={delay(plan.sayAt)}>
        <MascotSay sticker={stickerFor(props)} tone="good" size={64}>
          {subtitle(props, props.tierTo > props.tierFrom)}
          {yuzu > 0 && <b className="sc-yuzu">+{yuzu} 柚子</b>}
        </MascotSay>
      </div>

      <div className="sc-actions" style={delay(plan.buttonAt)}>
        <button type="button" className="ds-btn sc-continue" onClick={onClose} autoFocus>继续</button>
        {rekindled && canRepair && onRepair && (
          <button type="button" className="ds-btn-soft sc-repair" onClick={onRepair}>补上断掉的那天</button>
        )}
      </div>
    </div>
  );
}

/** 纸屑等盖章那一下再撒，开场就撒会和点燃抢 */
function ZooConfettiLater({ at }: { at: number }) {
  const motion = jsMotionAllowed();
  return <DelayedMount ms={motion ? at : 0}><ZooConfetti count={48} /></DelayedMount>;
}

function DelayedMount({ ms, children }: { ms: number; children: ReactNode }) {
  const [shown, setShown] = useState(ms === 0);
  useEffect(() => {
    if (ms === 0) return;
    const id = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(id);
  }, [ms]);
  return shown ? <>{children}</> : null;
}
