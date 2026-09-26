import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import { queryTouchRects, scrollTouchPageBy, touchEventsEnabled, touchPoint, type TouchEventLike, type TouchRect } from "../lib/touch-adapter";

/**
 * 列表里的「长按进选择模式 + 拖动划选」。
 *
 * 原本只长在快速学习页里（那是它第一次出现的地方），词库的选词也要同一套手感 ——
 * 一列上百行的时候，逐个点是最笨的选法，手指划过去才是。两处共用这一份，
 * 别再各写一遍：手势的坑（长按阈值、拖动多少算拖、松手那一下不能再触发行点击）
 * 每写一遍都要重踩。
 *
 * 页面自己负责的部分留在外面：选中之后能做什么（评分 / 加入队列）、
 * 选择状态要不要持久化。
 */

/** 长按多久算「我要开始选」。太短会和滚动打架，太长像卡住了。 */
const LONG_PRESS_MS = 460;
/** 手指移动超过这个距离就当成滚动，取消长按 */
const LONG_PRESS_SLOP = 10;
/** 拖过这个距离才算划选（否则松手会被当成普通点击） */
const DRAG_SLOP = 8;
/** 拖到离边缘这么近就自动滚 */
const EDGE = 72;
const EDGE_STEP = 12;

export interface RowSelectionOptions {
  /** 每一行的选择器，必须带上存 id 的 data 属性，例如 ".wl-row[data-word-id]" */
  rowSelector: string;
  /** 行上存 id 的 dataset 键名（驼峰），例如 "wordId" */
  idKey: string;
  /** 小程序 selector query 不返回 HTML 自定义节点的 data-* 时，按渲染顺序关联行 id */
  touchIds?: readonly number[];
  /** 划选时自动滚的容器。不传就滚 window（快速学习那页是整页滚的） */
  scrollContainer?: () => HTMLElement | null;
  /** 进入/退出选择模式时页面要跟着做的事（比如关掉行内展开的小面板） */
  onEnter?: () => void;
  onExit?: () => void;
}

export interface RowSelection {
  selectionMode: boolean;
  selectedIds: Set<number>;
  setSelectedIds: (ids: Set<number>) => void;
  /** 从草稿里把上次没做完的选择原样放回来（快速学习会把选择状态存进草稿） */
  restore: (mode: boolean, ids: Iterable<number>) => void;
  enterWith: (id: number) => void;
  exit: () => void;
  toggle: (id: number) => void;
  /** 挂在行元素上的手势 props */
  rowHandlers: (id: number) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onTouchStart?: (event: ReactTouchEvent<HTMLElement>) => void;
    onTouchMove?: (event: ReactTouchEvent<HTMLElement>) => void;
    onTouchEnd?: (event: ReactTouchEvent<HTMLElement>) => void;
    onTouchCancel?: (event: ReactTouchEvent<HTMLElement>) => void;
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  };
  /**
   * 行的普通点击要先问这一句：刚刚那下是长按或划选的收尾就返回 true，
   * 页面应当**跳过**这次点击（否则松手会顺手把词条详情也打开）。
   */
  consumedByGesture: () => boolean;
}

export function useRowSelection({
  rowSelector,
  idKey,
  touchIds,
  scrollContainer,
  onEnter,
  onExit
}: RowSelectionOptions): RowSelection {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIdsState] = useState<Set<number>>(() => new Set());
  // 回调放进 ref：调用方多半是行内箭头函数，直接进依赖会让 exit/enterWith 每次渲染都换身份，
  // 用到它们的 useCallback 跟着全部失效（快速学习那个只在挂载时跑一次的 loadSession 首当其冲）。
  const callbacksRef = useRef({ onEnter, onExit });
  useEffect(() => {
    callbacksRef.current = { onEnter, onExit };
  });
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const draggedRef = useRef(false);
  const gestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const touchSelectionRef = useRef<{ id: number; x: number; y: number; rects: TouchRect[] | null; lastAutoScroll: number } | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  }, []);

  useEffect(() => () => {
    clearLongPress();
    cleanupRef.current?.();
  }, [clearLongPress]);

  /** 手指划过的那一段矩形里的行全部选上 */
  const selectAlongPath = useCallback((fromX: number, fromY: number, toX: number, toY: number) => {
    const minX = Math.min(fromX, toX);
    const maxX = Math.max(fromX, toX);
    const minY = Math.min(fromY, toY);
    const maxY = Math.max(fromY, toY);
    const ids: number[] = [];
    document.querySelectorAll<HTMLElement>(rowSelector).forEach((row) => {
      const rect = row.getBoundingClientRect();
      if (rect.right >= minX && rect.left <= maxX && rect.bottom >= minY && rect.top <= maxY) {
        const id = Number(row.dataset[idKey]);
        if (Number.isFinite(id)) ids.push(id);
      }
    });
    if (!ids.length) return;
    if (Math.abs(toX - fromX) > DRAG_SLOP || Math.abs(toY - fromY) > DRAG_SLOP) draggedRef.current = true;
    setSelectedIdsState((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, [idKey, rowSelector]);

  const beginGesture = useCallback((event: ReactPointerEvent<HTMLElement>, id: number) => {
    gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    draggedRef.current = false;
    setSelectedIdsState((current) => new Set(current).add(id));

    const handleMove = (moveEvent: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== moveEvent.pointerId) return;
      selectAlongPath(gesture.x, gesture.y, moveEvent.clientX, moveEvent.clientY);
      gesture.x = moveEvent.clientX;
      gesture.y = moveEvent.clientY;
      const scroller = scrollContainer?.() ?? null;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
      if (moveEvent.clientY < top + EDGE) {
        if (scroller) scroller.scrollTop -= EDGE_STEP; else window.scrollBy(0, -EDGE_STEP);
      } else if (moveEvent.clientY > bottom - EDGE) {
        if (scroller) scroller.scrollTop += EDGE_STEP; else window.scrollBy(0, EDGE_STEP);
      }
    };
    const handleEnd = (endEvent: PointerEvent) => {
      if (gestureRef.current?.pointerId !== endEvent.pointerId) return;
      cleanupRef.current?.();
      cleanupRef.current = null;
      gestureRef.current = null;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerup", handleEnd, { passive: true });
    window.addEventListener("pointercancel", handleEnd, { passive: true });
  }, [scrollContainer, selectAlongPath]);

  const updateTouchSelection = useCallback((state: NonNullable<typeof touchSelectionRef.current>, x: number, y: number) => {
    const fromX = state.x;
    const fromY = state.y;
    state.x = x;
    state.y = y;
    if (Math.hypot(x - fromX, y - fromY) > DRAG_SLOP) draggedRef.current = true;
    if (state.rects) {
      const minX = Math.min(fromX, x), maxX = Math.max(fromX, x);
      const minY = Math.min(fromY, y), maxY = Math.max(fromY, y);
      const ids = state.rects.flatMap((rect, index) => {
        if (rect.right < minX || rect.left > maxX || rect.bottom < minY || rect.top > maxY) return [];
        // Taro's h5-* nodes omit authored data-* from selector-query datasets; quick study supplies row ids by order.
        const id = Number(rect.dataset?.[idKey] ?? touchIds?.[index]);
        return Number.isFinite(id) ? [id] : [];
      });
      if (ids.length) setSelectedIdsState((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.add(id));
        return next.size === current.size ? current : next;
      });
    }
    if ((y < EDGE || y > window.innerHeight - EDGE) && Date.now() - state.lastAutoScroll >= 100) {
      state.lastAutoScroll = Date.now();
      const delta = y < EDGE ? -EDGE_STEP : EDGE_STEP;
      const scroller = scrollContainer?.() ?? null;
      if (scroller && typeof scroller.scrollTop === "number") scroller.scrollTop += delta;
      else scrollTouchPageBy(delta);
      void queryTouchRects(rowSelector).then((rects) => {
        if (touchSelectionRef.current === state) state.rects = rects;
      });
    }
  }, [idKey, rowSelector, scrollContainer, touchIds]);

  const beginTouchGesture = useCallback((id: number, x: number, y: number) => {
    const state = { id, x, y, rects: null as TouchRect[] | null, lastAutoScroll: 0 };
    touchSelectionRef.current = state;
    setSelectedIdsState((current) => new Set(current).add(id));
    void queryTouchRects(rowSelector).then((rects) => {
      if (touchSelectionRef.current !== state) return;
      state.rects = rects;
    });
  }, [rowSelector]);

  const endTouchGesture = useCallback(() => {
    touchSelectionRef.current = null;
    clearLongPress();
  }, [clearLongPress]);

  const enterWith = useCallback((id: number) => {
    setSelectionMode(true);
    setSelectedIdsState(new Set([id]));
    callbacksRef.current.onEnter?.();
  }, []);

  const exit = useCallback(() => {
    setSelectionMode(false);
    setSelectedIdsState(new Set());
    callbacksRef.current.onExit?.();
  }, []);

  const toggle = useCallback((id: number) => {
    setSelectedIdsState((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rowHandlers = useCallback((id: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      // 行内的按钮各管各的，别被长按劫持
      if ((event.target as HTMLElement).closest("button")) return;
      if (selectionMode) {
        beginGesture(event, id);
        return;
      }
      clearLongPress();
      longPressTriggeredRef.current = false;
      longPressOriginRef.current = { x: event.clientX, y: event.clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        longPressTimerRef.current = null;
        longPressOriginRef.current = null;
        setSelectionMode(true);
        setSelectedIdsState(new Set([id]));
        callbacksRef.current.onEnter?.();
        beginGesture(event, id);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const origin = longPressOriginRef.current;
      if (!origin) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_SLOP) clearLongPress();
    },
    onPointerUp: () => clearLongPress(),
    onPointerCancel: () => clearLongPress(),
    onTouchStart: touchEventsEnabled() ? (event: TouchEventLike) => {
      if ((event.target as HTMLElement | null)?.closest?.("button")) return;
      const point = touchPoint(event);
      if (!point) return;
      clearLongPress();
      longPressTriggeredRef.current = false;
      draggedRef.current = false;
      longPressOriginRef.current = { x: point.clientX, y: point.clientY };
      if (selectionMode) {
        beginTouchGesture(id, point.clientX, point.clientY);
        return;
      }
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        longPressTimerRef.current = null;
        longPressOriginRef.current = null;
        setSelectionMode(true);
        setSelectedIdsState(new Set([id]));
        callbacksRef.current.onEnter?.();
        beginTouchGesture(id, point.clientX, point.clientY);
      }, LONG_PRESS_MS);
    } : undefined,
    onTouchMove: touchEventsEnabled() ? (event: TouchEventLike) => {
      const point = touchPoint(event);
      if (!point) return;
      const origin = longPressOriginRef.current;
      if (origin && !touchSelectionRef.current) {
        if (Math.hypot(point.clientX - origin.x, point.clientY - origin.y) > LONG_PRESS_SLOP) clearLongPress();
        return;
      }
      const state = touchSelectionRef.current;
      if (state) {
        event.preventDefault?.();
        updateTouchSelection(state, point.clientX, point.clientY);
      }
    } : undefined,
    onTouchEnd: touchEventsEnabled() ? endTouchGesture : undefined,
    onTouchCancel: touchEventsEnabled() ? endTouchGesture : undefined,
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => event.preventDefault()
  }), [beginGesture, beginTouchGesture, clearLongPress, endTouchGesture, selectionMode, updateTouchSelection]);

  const consumedByGesture = useCallback(() => {
    if (!longPressTriggeredRef.current && !draggedRef.current) return false;
    longPressTriggeredRef.current = false;
    draggedRef.current = false;
    return true;
  }, []);

  const setSelectedIds = useCallback((ids: Set<number>) => setSelectedIdsState(new Set(ids)), []);

  const restore = useCallback((mode: boolean, ids: Iterable<number>) => {
    setSelectionMode(mode);
    setSelectedIdsState(new Set(ids));
  }, []);

  return useMemo(() => ({
    selectionMode,
    selectedIds,
    setSelectedIds,
    restore,
    enterWith,
    exit,
    toggle,
    rowHandlers,
    consumedByGesture
  }), [consumedByGesture, enterWith, exit, restore, rowHandlers, selectedIds, selectionMode, setSelectedIds, toggle]);
}
