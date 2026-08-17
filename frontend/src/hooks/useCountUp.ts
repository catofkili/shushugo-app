import { useEffect, useRef, useState } from "react";
import { jsMotionAllowed } from "../lib/studyPreferences";

/**
 * 数字滚动:显示值从上一次的数一路数到新的数,而不是「啪」地换掉。
 *
 * 首页那个「688 词」以前是跳变的 —— 学完一批回来变成 670,中间什么都没发生,
 * 用户感觉不到自己刚刚把它按下去了。这个 hook 只做一件事:把变化过程还给眼睛。
 *
 * 三条刻意的设计:
 *   1. 滚动中途目标又变了,从**当前显示值**接着滚,不回到起点重来;
 *   2. 时长随差值缩放并夹在 [320, 900]ms —— 688→0 也不许滚成一场动画;
 *   3. 省电档/系统「减少动态效果」下一步到位,但**照样是对的数字**(见 jsMotionAllowed)。
 *
 * 用 rAF 而不是 CSS:数字是文本内容,CSS 动不了它;而且 rAF 在标签页隐藏时自动停,
 * 后台不会空转。
 */

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** 差一个滚 12ms,夹在 [320, 900]ms:小变化要利落,大变化也别拖 */
const durationFor = (delta: number): number =>
  Math.min(Math.max(Math.abs(delta) * 12, 320), 900);

export function useCountUp(target: number): number {
  // 首屏从 0 数上来(开场);省电档下第一帧就落到目标值
  const displayRef = useRef(0);
  const [display, setDisplay] = useState(0);
  const frameRef = useRef(0);

  useEffect(() => {
    const from = displayRef.current;
    if (from === target) return;

    // 一步到位也走 rAF:在 effect 里直接 setState 会引发级联渲染,
    // 交给第一帧去落值,差一帧(约 16ms)看不出来。
    const duration = jsMotionAllowed() ? durationFor(target - from) : 0;
    const start = performance.now();

    const step = (now: number) => {
      const progress = duration > 0 ? Math.min((now - start) / duration, 1) : 1;
      const value = Math.round(from + (target - from) * easeOutCubic(progress));
      displayRef.current = value;
      setDisplay(value);
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target]);

  return display;
}
