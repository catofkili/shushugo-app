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
