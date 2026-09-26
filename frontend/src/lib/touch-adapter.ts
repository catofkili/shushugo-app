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

/** Web keeps its existing PointerEvent path. The WeChat adapter replaces this module. */
export const touchEventsEnabled = () => false;

export const touchPoint = (event: TouchEventLike, ending = false): TouchPoint | null => {
  const points = ending ? event.changedTouches : event.touches;
  return points?.length ? points[0] : null;
};

export const queryTouchRect = async (_selector: string): Promise<TouchRect | null> => null;

export const queryTouchRects = async (_selector: string): Promise<TouchRect[]> => [];

export const scrollTouchPageBy = (_delta: number) => {};

/**
 * 小程序里滚的是页面本身：window 上没有 scroll 事件，scrollTo 在 iPhone 上不存在、在开发者工具里调用会
 * Illegal invocation（Taro 的 window 把全局属性原样抄了一份，this 不对）。网页返回 false，调用方照旧滚自己的容器。
 */
export const scrollPageToTop = () => false;

/** 小程序的触底（页面 onReachBottom），返回「是不是页面自己在滚」。网页返回 false：列表页自己听滚动续页。 */
export const usePageReachBottom = (_callback: () => void) => false;

/** Web keeps the full list; the WeChat adapter pages it at the native reach-bottom event. */
export const useProgressiveList = <T,>(items: readonly T[], _resetKey: unknown, _pageSize: number) => items;
