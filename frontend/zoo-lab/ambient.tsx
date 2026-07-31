import { useCallback, useRef, useState, type CSSProperties } from "react";
import { CapybaraMascot } from "../src/components/CapybaraMascot";

/**
 * 「环境日语」三件套 —— 扭蛋、钓鱼这些小游戏共用。
 *
 * 日语是环境不是课程,分三层出现:
 *   拟声词(FxLayer)——跟着动作飞出来,不翻译(漫画效果音本来就靠画面懂,一翻译就变成课本);
 *   动物台词(Say)——日文大、中文小且淡,中文可一键关掉;
 *   物品名(JaName)——日语当主标题、带振り仮名,中文降为副标题。
 * 全程没有提问、没有判分:看懂看不懂都不影响玩。
 */

/** 振り仮名分段:r 为空表示这段本来就是假名,不注音 */
export type Ruby = { t: string; r?: string };
export type Line = { ja: string; cn: string };

export const jaText = (ruby: Ruby[]) => ruby.map((seg) => seg.t).join("");

/** 从一组台词里随机挑一句(同阶段多备几句,免得听腻) */
export const pickFrom = (list: Line[]): Line => list[Math.floor(Math.random() * list.length)];

/** 台词朗读走设备合成:句子本来就是假名,不需要词库那套读音归一化 */
export function speakLine(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

/** 振り仮名渲染:汉字段加 <rt>,假名段原样 */
export function JaName({ ruby }: { ruby: Ruby[] }) {
  return (
    <>
      {ruby.map((seg, i) =>
        seg.r ? (
          <ruby key={i}>
            {seg.t}
            <rt>{seg.r}</rt>
          </ruby>
        ) : (
          <span key={i}>{seg.t}</span>
        )
      )}
    </>
  );
}

/** 漫画式效果音:x 是相对舞台中线的偏移,y 是舞台内的高度 */
export type Fx = { key: number; text: string; x: number; y: number; tone: "ink" | "warm" | "gold" };

/** 效果音队列:boom() 丢一个上屏,1 秒后自己消失 */
export function useFx() {
  const [fx, setFx] = useState<Fx[]>([]);
  const seq = useRef(0);
  const boom = useCallback((text: string, x: number, y: number, tone: Fx["tone"] = "ink") => {
    const key = ++seq.current;
    setFx((list) => [...list, { key, text, x, y, tone }]);
    window.setTimeout(() => setFx((list) => list.filter((item) => item.key !== key)), 1000);
  }, []);
  const clearFx = useCallback(() => setFx([]), []);
  return { fx, boom, clearFx };
}

export function FxLayer({ fx }: { fx: Fx[] }) {
  return (
    <div className="zoo-fx">
      {fx.map((item) => (
        <span
          key={item.key}
          className={"zoo-fx-word t-" + item.tone}
          style={{ "--fx-x": `${item.x}px`, top: item.y } as CSSProperties}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

/** 动物旁白:一直在场,点一下会念出来 */
export function Say({
  line,
  showCn,
  mood = "happy"
}: {
  line: Line;
  showCn: boolean;
  mood?: "happy" | "sleepy" | "cheer";
}) {
  return (
    <button className="zoo-say" onClick={() => speakLine(line.ja)}>
      <span className="zoo-say-capy">
        <CapybaraMascot size={46} mood={mood} />
      </span>
      <span key={line.ja} className="zoo-bubble">
        <b>{line.ja}</b>
        {showCn && <small>{line.cn}</small>}
      </span>
    </button>
  );
}

/** 中文注释开关:关掉后界面只剩日语 */
export function CnToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button className={"zoo-cn-toggle pop" + (on ? " on" : "")} onClick={onToggle}>
      中文 {on ? "开" : "关"}
    </button>
  );
}
