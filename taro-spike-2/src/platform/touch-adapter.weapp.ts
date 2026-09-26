import Taro, { useReachBottom } from "@tarojs/taro";
import { useCallback, useState } from "react";

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

export const scrollTouchPageBy = (delta: number) => {
  Taro.createSelectorQuery().selectViewport().scrollOffset().exec((result) => {
    const top = Number((result?.[0] as { scrollTop?: number } | undefined)?.scrollTop ?? 0);
    Taro.pageScrollTo({ scrollTop: Math.max(0, top + delta), duration: 0 });
  });
};

export const scrollPageBy = scrollTouchPageBy;

// Page reach-bottom owns pagination in the Mini Program. These browser-only fallbacks stay inert.
export const getPageScrollRemaining = (_bodyHeight: number) => Number.POSITIVE_INFINITY;

export const getElementFromPoint = (_x: number, _y: number): null => null;

export const getActiveElement = (): null => null;

export const scrollPageToTop = () => {
  Taro.pageScrollTo({ scrollTop: 0, duration: 0 });
  return true;
};

export const usePageReachBottom = (callback: () => void) => {
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
