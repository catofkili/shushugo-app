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
 *   2. 不指定时长时随差值缩放并夹在 [320, 900]ms —— 688→0 不许滚成一场动画、差 1 也别拖 0.7 秒;
 *      完成页那种要和别的元素对拍子的，显式传 duration；可选延迟只作用在第一次起步;
 *   3. 省电档/系统「减少动态效果」直接到终值,但**照样是对的数字**(见 jsMotionAllowed)。
 *
 * 用 rAF 而不是 CSS:数字是文本内容,CSS 动不了它;而且 rAF 在标签页隐藏时自动停,
 * 后台不会空转。
 */

export const countUpValue = (from: number, target: number, progress: number): number => {
  const t = Math.min(Math.max(progress, 0), 1);
  return Math.round(from + (target - from) * (1 - (1 - t) ** 3));
};

/** 差一个滚 12ms,夹在 [320, 900]ms:小变化要利落,大变化也别拖 */
const durationFor = (delta: number): number =>
  Math.min(Math.max(Math.abs(delta) * 12, 320), 900);

export function useCountUp(
  target: number,
  duration?: number,
  delay = 0,
  initialValue = 0,
  onComplete?: () => void
): number {
  // 首屏从 initialValue 数上来；余额等已有数字可以把当前值当起点。
  const [display, setDisplay] = useState(() => jsMotionAllowed() ? initialValue : target);
  const displayRef = useRef(display);
  const frameRef = useRef(0);
  const firstStartRef = useRef(true);
  // 回调放 ref：调用方传了内联函数也不会让 effect 每次渲染都重启（重启 = 缓动从头算，数字越滚越慢）
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; });

  useEffect(() => {
    const from = displayRef.current;
    if (from === target) return;
    if (!jsMotionAllowed()) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const wait = firstStartRef.current ? delay : 0;
    const ms = duration ?? durationFor(target - from);
    // ⚠️ 起点取第一帧的时间戳，不取 performance.now()：小程序里 rAF 是 Taro 拿定时器模拟的，时间戳是它自己的钟，
    // 和 iPhone 的 performance.now() 对不上——相减得出极端的进度，缓动一放大就溢出，主页大数字显示成「-Infinity」
    // （2026-09-26 真机）。进度也夹到 [0, 1]，哪个平台都不会再算飞。
    let start: number | null = null;
    let timer: number | undefined;

    const step = (now: number) => {
      start ??= now;
      const progress = ms > 0 ? (now - start) / ms : 1;
      const value = countUpValue(from, target, progress);
      displayRef.current = value;
      setDisplay(value);
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
      else onCompleteRef.current?.();
    };

    const startAnimation = () => {
      firstStartRef.current = false;
      frameRef.current = requestAnimationFrame(step);
    };
    if (wait > 0) timer = window.setTimeout(startAnimation, wait);
    else startAnimation();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration, delay]);

  return display;
}
