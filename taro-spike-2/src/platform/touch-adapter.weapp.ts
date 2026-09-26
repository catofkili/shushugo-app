import Taro from "@tarojs/taro";

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
