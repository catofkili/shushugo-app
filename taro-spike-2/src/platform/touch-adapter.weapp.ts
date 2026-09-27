import Taro, { useReachBottom } from "@tarojs/taro";
import { useCallback, useEffect, useRef, useState } from "react";

export interface TouchPoint {
  identifier: number;
  clientX: number;
  clientY: number;
}

export interface TouchRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  dataset?: Record<string, string>;
}

export interface TouchEventLike {
  touches?: ArrayLike<TouchPoint>;
  changedTouches?: ArrayLike<TouchPoint>;
  currentTarget?: unknown;
  target?: unknown;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export const touchEventsEnabled = () => true;

export const touchPoint = (event: TouchEventLike, ending = false): TouchPoint | null => {
  const points = ending ? event.changedTouches : event.touches;
  return points?.length ? points[0] : null;
};

export const queryTouchRect = (selector: string): Promise<TouchRect | null> => new Promise((resolve) => {
  Taro.createSelectorQuery().select(selector).boundingClientRect().exec((result) => {
    resolve((result?.[0] as TouchRect | null | undefined) ?? null);
  });
});

export const queryTouchRects = (selector: string): Promise<TouchRect[]> => new Promise((resolve) => {
  Taro.createSelectorQuery().selectAll(selector).fields({ rect: true, dataset: true }).exec((result) => {
    resolve((result?.[0] as TouchRect[] | null | undefined) ?? []);
  });
});

/*
 * W15 之后页面本身不滚：内容在 WeappPage 里那个铺满全屏的 ScrollView（#weapp-main-scroll）里滚。
 * 于是页面级的 onReachBottom / wx.pageScrollTo 都不再起作用——W11 的「触底加载下一段」和词库拖选时的
 * 边缘自动滚动会一起失灵，而且开发者工具的路由巡检发现不了（2026-09-27 合 W15 时补上）。
 * 滚到底由 ScrollView 的 onScrollToLower 按页面路径转发到这里；滚动位置用 enhanced scroll-view 的 node.scrollTo。
 */
const MAIN_SCROLL_SELECTOR = '#weapp-main-scroll';
const currentPagePath = () => Taro.getCurrentInstance().router?.$taroPath ?? '';
// 挂在 globalThis 上：这个模块可能被分包各打一份，模块变量会各是各的，通知就传不到订阅方。
const reachBottomListeners: Map<string, Set<() => void>> = ((globalThis as { __shushugoReachBottom?: Map<string, Set<() => void>> }).__shushugoReachBottom ??= new Map());

export const notifyMainScrollReachBottom = (pagePath: string) => {
  reachBottomListeners.get(pagePath)?.forEach((listener) => listener());
};

type ScrollNode = { scrollTo: (options: { top: number; animated?: boolean }) => void };
const withMainScroll = (run: (node: ScrollNode, top: number) => void) => {
  Taro.createSelectorQuery().select(MAIN_SCROLL_SELECTOR).fields({ node: true, scrollOffset: true }).exec((result) => {
    const found = result?.[0] as { node?: ScrollNode; scrollTop?: number } | undefined;
    if (found?.node) run(found.node, Number(found.scrollTop ?? 0));
  });
};

export const scrollTouchPageBy = (delta: number) => {
  withMainScroll((node, top) => node.scrollTo({ top: Math.max(0, top + delta), animated: false }));
};

export const scrollPageBy = scrollTouchPageBy;

// Page reach-bottom owns pagination in the Mini Program. These browser-only fallbacks stay inert.
export const getPageScrollRemaining = (_bodyHeight: number) => Number.POSITIVE_INFINITY;

export const getElementFromPoint = (_x: number, _y: number): null => null;

export const getActiveElement = (): null => null;

export const scrollPageToTop = () => {
  withMainScroll((node) => node.scrollTo({ top: 0, animated: false }));
  return true;
};

export const usePageReachBottom = (callback: () => void) => {
  const latest = useRef(callback);
  latest.current = callback;
  const [pagePath] = useState(currentPagePath);
  useEffect(() => {
    const listener = () => latest.current();
    const listeners = reachBottomListeners.get(pagePath) ?? new Set<() => void>();
    listeners.add(listener);
    reachBottomListeners.set(pagePath, listeners);
    return () => { listeners.delete(listener); };
  }, [pagePath]);
  // 保险：哪天页面本身又滚了，原生触底照样能用。
  useReachBottom(callback);
  return true;
};

export const useProgressiveList = <T,>(items: readonly T[], resetKey: unknown, pageSize: number) => {
  const [page, setPage] = useState(() => ({ key: resetKey, count: pageSize }));
  const count = Object.is(page.key, resetKey) ? page.count : pageSize;
  const loadNext = useCallback(() => {
    setPage((current) => {
      const currentCount = Object.is(current.key, resetKey) ? current.count : pageSize;
      if (currentCount >= items.length) return current;
      return { key: resetKey, count: Math.min(items.length, currentCount + pageSize) };
    });
  }, [items.length, pageSize, resetKey]);
  const pageScrolls = usePageReachBottom(loadNext);

  return pageScrolls ? items.slice(0, count) : items;
};
