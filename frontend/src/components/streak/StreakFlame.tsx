import type { CSSProperties } from "react";
import type { DayStatus } from "../../lib/streak";
import { Sticker } from "../CapybaraMascot";
import "./streak.css";

export type FlameState = "off" | "lit" | "gold";

/** 补签的日子也是亮的（不金） */
export const flameStateOf = (status: DayStatus): FlameState =>
  status === "gold" ? "gold" : status === "none" ? "off" : "lit";

/**
 * 连胜火苗主体用 CSS 画（层叠的水滴形），不用内联 SVG（小程序不渲染）、不用 lucide（小程序里是 Image，染不了色）。
 *
 * - state 说今天：off 睡着（灰、眯眼）/ lit 暖橙在跳 / gold 金色带扫光。
 * - tier 说攒了多久（规格 §3）：2 起有外焰和火星，3 内芯变蓝，4 外圈光环，5 戴冠。
 * - 40px 以下不画脸、火星和光环：主页 chip 里只有 18px，画了也是一团糊。
 *
 * ⚠️ 基础样式就是终态，动画只做跳动 / 扫光 / 飘，减少动效时整个拿掉也不缺东西
 *   （interface-and-design-system.md 周报那节踩过的坑）。
 */
export function StreakFlame({ state, tier, size = 48, atRisk = false, className = "" }: {
  state: FlameState;
  tier: number;
  size?: number;
  atRisk?: boolean;
  className?: string;
}) {
  const detailed = size >= 40;
  const t = Math.max(1, Math.min(5, tier || 1));
  return (
    <span
      className={`sf sf-${state} sf-t${t}${detailed ? " sf-detailed" : ""}${atRisk && state === "off" ? " sf-risk" : ""} ${className}`}
      style={{ "--sf": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {detailed && t >= 4 && <i className="sf-aura" />}
      {t >= 2 && <i className="sf-outer" />}
      <i className="sf-tongue sf-tongue-l" /><i className="sf-tongue sf-tongue-r" />
      <i className="sf-body"><i className="sf-sheen" /></i>
      <i className="sf-core" />
      {detailed && <i className="sf-face"><i /><i /></i>}
      {detailed && t >= 2 && state !== "off" && <i className="sf-sparks"><i /><i /><i /></i>}
      {detailed && t >= 5 && <span className="sf-crown"><Sticker name="crown" size={size * 0.34} /></span>}
    </span>
  );
}
