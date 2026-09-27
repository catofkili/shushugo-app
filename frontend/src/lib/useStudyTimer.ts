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
  // 小程序里被盖住 / 切走的页面不卸载，document 仍是 visible；页面自己的显隐另记。
  const shownRef = useRef(true);
  // 交互会把上次结账以来的有效时间并进零头；这段也要报给十分钟观测，
  // 否则越常点、越常滚，观测到的时间越少。
  const unreportedFocusMsRef = useRef(0);

  const noteInteraction = useCallback(() => {
    const now = Date.now();
    const clock = clockRef.current ?? createStudyClock(now);
    clockRef.current = noteStudyInteraction(clock, now, { visible: shownRef.current && visible() });
    unreportedFocusMsRef.current += Math.max(0, clockRef.current.pendingMs - clock.pendingMs);
  }, []);

  const flush = useCallback((visibleOverride?: boolean) => {
    if (!enabled) return;
    const now = Date.now();
    const clock = clockRef.current ?? createStudyClock(now);
    const previousPendingMs = clock.pendingMs;
    const accrued = accrueStudyTime(clock, now, { visible: visibleOverride ?? (shownRef.current && visible()) });
    const activeMs = unreportedFocusMsRef.current + Math.max(0, accrued.pendingMs - previousPendingMs);
    unreportedFocusMsRef.current = 0;
    if (focusSource && activeMs > 0) recordStudyFocusTime(activeMs, now, focusSource);
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
      shownRef.current = isVisible;
      if (!isVisible) return;
      // 小程序页面离开后又显示（页面没卸载），重新接上这个入口的观测。
      if (enabled && focusSource) enterStudyFocus(focusSource);
      noteInteraction();
    },
    onLeave: () => {
      flush();
      if (focusSource) leaveStudyFocus(focusSource);
    }
  });

  useEffect(() => {
    if (!enabled) {
      // A component can mount before its card is ready. Do not let that idle
      // time leak into the first enabled interval.
      clockRef.current = createStudyClock(Date.now());
      clockRef.current.enabled = false;
      unreportedFocusMsRef.current = 0;
      return undefined;
    }
    if (focusSource) enterStudyFocus(focusSource);
    if (!clockRef.current?.enabled) {
      clockRef.current = createStudyClock(Date.now());
      unreportedFocusMsRef.current = 0;
    }
    clockRef.current!.enabled = true;
    noteInteraction();
    const interval = window.setInterval(flush, 15_000);
    return () => {
      window.clearInterval(interval);
      flush();
      if (focusSource) leaveStudyFocus(focusSource);
    };
  }, [enabled, flush, noteInteraction, focusSource]);
}
