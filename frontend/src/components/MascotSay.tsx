import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sticker, type StickerName } from "./CapybaraMascot";

function SleepingMascot({ size }: { size: number }) {
  const [awake, setAwake] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      className={`ds-say-sleeper ds-say-mascot${awake ? " is-awake" : ""}`}
      aria-label="叫醒水豚"
      onClick={() => {
        if (awake) return;
        setAwake(true);
        timer.current = window.setTimeout(() => { timer.current = null; setAwake(false); }, 600);
      }}
    >
      <Sticker name={awake ? "mood-surprised" : "mood-sleep"} size={size} />
    </button>
  );
}

/**
 * 吉祥物说话：一张表情贴纸 + 一个对话气泡。
 *
 * 用户原话（2026-09-23）：「那些各种长提示都要灵活用吉祥物去说，而不是干巴巴的文字」。
 * 所以凡是「一段解释 / 提醒 / 警告」的地方都走这个组件，不再写
 * `rounded-2xl border bg-xxx/15 text-xs` 那种干巴巴的色块 —— 表情本身就说明了语气：
 * 提醒用 ask / idea，警告用 shocked / puzzled，好消息用 yay / cheer，求人用 shy。
 *
 * tone 只管气泡底色：info（中性浅底）/ warn（琥珀）/ good（主色浅底）。
 * 表情和 tone 分开给，是因为同一个「警告」有时是吓一跳（shocked）、有时是犯愁（puzzled）。
 */
export function MascotSay({
  sticker = "mood-default",
  tone = "info",
  size = 56,
  children,
  className = ""
}: {
  sticker?: StickerName;
  tone?: "info" | "warn" | "good";
  size?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ds-say ds-say-${tone} ${className}`}>
      {sticker === "mood-sleep" ? <SleepingMascot size={size} /> : <Sticker name={sticker} size={size} className="ds-say-mascot" />}
      <div className="ds-say-bubble">{children}</div>
    </div>
  );
}
