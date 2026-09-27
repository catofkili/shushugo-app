import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
import type { StudyActivityHandlers } from '../../../frontend/src/hooks/useStudyActivity';

// WeappPage imports this module, keeping one listener registry in the main package.
// Hidden tab pages stay mounted, so interactions must be addressed to their native page path.
const interactions = new Map<string, Set<() => void>>();
export const notifyStudyInteraction = (pagePath: string) => interactions.get(pagePath)?.forEach((listener) => listener());

/** Match AuthDialog: a page overlay cannot cover WeChat's native tab bar. */
export function useStudyBreakTabBar(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const route = Taro.getCurrentPages().at(-1)?.route;
    if (!route || !/^pages\/(home|word|grammar|profile)\/index$/.test(route)) return;
    void Taro.hideTabBar({ animation: false });
    return () => { void Taro.showTabBar({ animation: false }); };
  }, [open]);
}

export function useStudyActivity(handlers: StudyActivityHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => { latest.current = handlers; });
  const [pagePath] = useState(() => Taro.getCurrentInstance().router?.$taroPath ?? '');
  const visible = useRef(true);
  const left = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelLeave = () => {
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  const leave = () => {
    if (left.current) return;
    left.current = true;
    latest.current.onLeave();
  };
  useDidShow(() => {
    cancelLeave();
    visible.current = true;
    left.current = false;
    latest.current.onVisibilityChange(document.visibilityState !== 'hidden');
  });
  useDidHide(() => {
    visible.current = false;
    latest.current.onVisibilityChange(false);
    // App background also hides the page. Let onAppHide dispatch visibilitychange first,
    // then invalidate only navigation; backgrounding pauses the same countdown.
    cancelLeave();
    if (document.visibilityState !== 'hidden') leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      if (!visible.current && document.visibilityState !== 'hidden') leave();
    }, 0);
  });
  useEffect(() => {
    const interact = () => {
      if (visible.current && document.visibilityState !== 'hidden') latest.current.onInteraction();
    };
    const appVisibility = () => {
      if (document.visibilityState === 'hidden') cancelLeave();
      latest.current.onVisibilityChange(visible.current && document.visibilityState !== 'hidden');
    };
    const listeners = interactions.get(pagePath) ?? new Set<() => void>();
    listeners.add(interact);
    interactions.set(pagePath, listeners);
    document.addEventListener('visibilitychange', appVisibility);
    appVisibility();
    return () => {
      cancelLeave();
      listeners.delete(interact);
      if (!listeners.size) interactions.delete(pagePath);
      document.removeEventListener('visibilitychange', appVisibility);
      leave();
    };
  }, [pagePath]);
}
