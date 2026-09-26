import { useEffect, useRef } from "react";
import { PROGRESS_UPDATED_EVENT } from "./progress-events";

/**
 * 订阅「进度已更新」（答一题、改计划之后要重读统计的组件用）。
 * 网页同一时间只挂着一个页面，直接听事件就行。
 * ⚠️ 小程序版在 taro-spike-2/src/platform/use-progress-updates.weapp.ts，行为不一样：
 * 小程序里打开过的标签页都挂在后台，每答一题所有挂着的页面都会同步重算——那边改成后台只记脏、切回来再刷。
 */
export function useProgressUpdates(refresh: () => void): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    const handler = () => latest.current();
    window.addEventListener(PROGRESS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(PROGRESS_UPDATED_EVENT, handler);
  }, []);
}
