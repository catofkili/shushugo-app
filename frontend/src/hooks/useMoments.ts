import { useCallback, useEffect, useRef, useState } from "react";
import { collectMoments, type Moment } from "../lib/moments";

/**
 * 时刻的播放器:一次只播一个,播完隔一口气再播下一个。
 *
 * 「一次只播一个」是这个 hook 存在的理由 —— 某天你既清了积压、又拿下一个顽固词,
 * 两条都绝对定位在同一个角上,叠在一起就是一团糨糊。
 */

/** 最后这段用来淡出 */
const FADE_MS = 420;
/** 两个时刻之间留一口气,不然像跑马灯 */
const GAP_MS = 280;

export function useMoments() {
  const [current, setCurrent] = useState<Moment | null>(null);
  const [leaving, setLeaving] = useState(false);

  const queue = useRef<Moment[]>([]);
  const timers = useRef<number[]>([]);
  const playing = useRef(false);
  /** 自递归绕一层 ref:直接在 setTimeout 里写 playNext,闭包会锁死声明那一刻的实例 */
  const playNextRef = useRef<() => void>(() => {});

  const playNext = useCallback(() => {
    const next = queue.current.shift();
    if (!next) {
      playing.current = false;
      return;
    }
    playing.current = true;
    setCurrent(next);
    setLeaving(false);

    // 淡出用 class 切换而不是 CSS 动画的尾段:省电档/系统「减少动态效果」会把动画
    // 压成 0.01ms,尾段一瞬间跑完,时刻等于从没出现过。切 class 最差也只是
    // 「直接消失」,话还是说到了。
    timers.current.push(
      window.setTimeout(() => setLeaving(true), Math.max(0, next.holdMs - FADE_MS)),
      window.setTimeout(() => {
        setCurrent(null);
        timers.current.push(window.setTimeout(() => playNextRef.current(), GAP_MS));
      }, next.holdMs)
    );
  }, []);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  /**
   * 跑一遍检测器。可以随便调:去重记在库里,已经播过的不会再出来 ——
   * 所以首页每次刷新都调它,学习途中产生的时刻回到首页就能接上。
   */
  const collect = useCallback(() => {
    let found: Moment[] = [];
    try {
      found = collectMoments();
    } catch {
      // 词库还没加载好;下一次进度事件会再来一遍
      return;
    }
    if (!found.length) return;
    queue.current.push(...found);
    if (!playing.current) playNext();
  }, [playNext]);

  useEffect(() => () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    queue.current = [];
    playing.current = false;
  }, []);

  return { moment: current, leaving, collect };
}
