import { useEffect, useRef } from 'react';
import { useDidHide, useDidShow } from '@tarojs/taro';
import { PROGRESS_UPDATED_EVENT } from '../../../frontend/src/lib/progress-events';

/**
 * 小程序版「订阅进度更新」。和网页的差别（2026-09-26 真机分段计时查出）：
 * 小程序里打开过的标签页（主页、单词、语法、我的）和页面栈里的页面都挂着。网页上同一时间只有一个页面在听，
 * 小程序里每答一题，后台挂着的主页也会同步重算统计 / 备考状态 / 每日量面板——iPhone 上「记账」因此要 182 ms
 * （Node 里事件是空操作，只量得到 1 ms）。
 * - 页面不在前台：只记脏，切回来（onShow）再刷一次；
 * - 在前台：推到下一个宏任务、连着几次合成一次，不和记账挤在同一段里（翻面那一下不用排在它后面）。
 */
export function useProgressUpdates(refresh: () => void): void {
  const latest = useRef(refresh);
  const visible = useRef(true);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latest.current = refresh;
  });
  useDidShow(() => {
    visible.current = true;
    if (!dirty.current) return;
    dirty.current = false;
    latest.current();
  });
  useDidHide(() => {
    visible.current = false;
  });
  useEffect(() => {
    const handler = () => {
      if (!visible.current) {
        dirty.current = true;
        return;
      }
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (visible.current) latest.current();
        else dirty.current = true;
      }, 0);
    };
    window.addEventListener(PROGRESS_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(PROGRESS_UPDATED_EVENT, handler);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
}
