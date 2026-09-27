import { useCallback, useEffect, useRef } from "react";
import { addWordStudySeconds } from "./word-api";
import { accrueStudyTime, createStudyClock, drainStudySeconds, noteStudyInteraction } from "./study-clock";
import { enterStudyFocus, leaveStudyFocus, recordStudyFocusTime } from "./study-focus";
import { useStudyActivity } from "../hooks/useStudyActivity";

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * 给不使用 WordStudy 页面骨架的学习模式共用计时器。
 * WordStudy 自己已有同一规则，这个 hook 用在语法考题和快速学习页，避免
 * “都是学习但只有某个页面有时长”的断层。
 */
export function useStudyTimer(enabled: boolean, focusSource?: string): void {
  const clockRef = useRef<(ReturnType<typeof createStudyClock> & { enabled?: boolean }) | null>(null);

  const noteInteraction = useCallback(() => {
    const now = Date.now();
    clockRef.current = noteStudyInteraction(clockRef.current ?? createStudyClock(now), now, { visible: visible() });
  }, []);

  const flush = useCallback((visibleOverride?: boolean) => {
    if (!enabled) return;
    const now = Date.now();
    const clock = clockRef.current ?? createStudyClock(now);
    const previousPendingMs = clock.pendingMs;
    const accrued = accrueStudyTime(clock, now, { visible: visibleOverride ?? visible() });
    const activeMs = Math.max(0, accrued.pendingMs - previousPendingMs);
    if (focusSource && activeMs > 0) recordStudyFocusTime(activeMs, now);
    if (accrued.pendingMs < 1000) {
      clockRef.current = accrued;
      return;
    }
    const drained = drainStudySeconds(accrued);
    try {
      addWordStudySeconds(drained.seconds, now);
      clockRef.current = drained.state;
    } catch {
      // Do not discard the drained state until persistence succeeds. The next
      // interval retries the same seconds and any newly accrued time.
      clockRef.current = accrued;
    }
  }, [enabled, focusSource]);

  useStudyActivity({
    onInteraction: noteInteraction,
    onVisibilityChange: (isVisible) => {
      flush(isVisible ? undefined : true);
      if (isVisible) noteInteraction();
    },
    onLeave: () => {
      flush();
      if (focusSource) leaveStudyFocus();
    }
  });

  useEffect(() => {
    if (!enabled) {
      // A component can mount before its card is ready. Do not let that idle
      // time leak into the first enabled interval.
      clockRef.current = createStudyClock(Date.now());
      clockRef.current.enabled = false;
      return undefined;
    }
    if (focusSource) enterStudyFocus(focusSource);
    if (!clockRef.current?.enabled) clockRef.current = createStudyClock(Date.now());
    clockRef.current!.enabled = true;
    noteInteraction();
    const interval = window.setInterval(flush, 15_000);
    return () => {
      window.clearInterval(interval);
      flush();
      if (focusSource) leaveStudyFocus();
    };
  }, [enabled, flush, noteInteraction, focusSource]);
}
