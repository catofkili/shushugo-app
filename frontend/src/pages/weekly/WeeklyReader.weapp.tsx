import { ScrollView } from "@tarojs/components";
import { forwardRef, useRef, type Ref, type ComponentRef } from "react";
import type { WeeklyReaderProps } from "./WeeklyReader";

/** Native Views cannot overflow-scroll, and Taro nodes have no closest or
 * pointer capture. Keep the web reader untouched and use native touches here.
 * Thresholds match WeeklyReportPage: vertical movement reads, horizontal turns. */
export const WeeklyReader = forwardRef<HTMLElement, WeeklyReaderProps>(function WeeklyReader({ resetKey, onTurn, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, children, ...props }, ref) {
  void onPointerDown; void onPointerMove; void onPointerUp; void onPointerCancel;
  const drag = useRef<{ x: number; y: number; id: number; at: number; locked: boolean } | null>(null);
  return <ScrollView {...props} id="weekly-report-scroll" key={resetKey} ref={ref as unknown as Ref<ComponentRef<typeof ScrollView>>}
    scrollY={!resetKey.startsWith("stars:")} enhanced showScrollbar={false}
    onTouchStart={event => {
      const point = event.touches[0];
      drag.current = event.touches.length === 1 ? { x: point.clientX, y: point.clientY, id: point.identifier, at: Date.now(), locked: false } : null;
    }}
    onTouchMove={event => {
      const start = drag.current, point = event.touches[0];
      if (!start || !point || point.identifier !== start.id) return;
      const dx = Math.abs(point.clientX - start.x), dy = Math.abs(point.clientY - start.y);
      if (!start.locked && dy > 12 && dy > dx) drag.current = null;
      else if (dx >= 8) start.locked = true;
    }}
    onTouchEnd={event => {
      const start = drag.current, point = event.changedTouches[0];
      drag.current = null;
      if (!start?.locked || !point || point.identifier !== start.id) return;
      const dx = point.clientX - start.x, elapsed = Math.max(1, Date.now() - start.at);
      if (Math.abs(dx) >= 56 || (Math.abs(dx) >= 24 && Math.abs(dx) / elapsed > .4)) onTurn(dx < 0 ? 1 : -1);
    }}
    onTouchCancel={() => { drag.current = null; }}>
    {children}
  </ScrollView>;
});
