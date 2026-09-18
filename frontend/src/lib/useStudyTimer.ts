import { useCallback, useEffect, useRef } from "react";
import { addWordStudySeconds } from "./word-api";
import { accrueStudyTime, createStudyClock, drainStudySeconds, noteStudyInteraction } from "./study-clock";

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * 给不使用 WordStudy 页面骨架的学习模式共用计时器。
 * WordStudy 自己已有同一规则，这个 hook 用在语法考题和快速学习页，避免
 * “都是学习但只有某个页面有时长”的断层。
 */
export function useStudyTimer(enabled: boolean): void {
  const clockRef = useRef(createStudyClock(Date.now()) as ReturnType<typeof createStudyClock> & { enabled?: boolean });

  const noteInteraction = useCallback(() => {
    clockRef.current = noteStudyInteraction(clockRef.current, Date.now(), { visible: visible() });
  }, []);

  const flush = useCallback((visibleOverride?: boolean) => {
    if (!enabled) return;
    const now = Date.now();
    const accrued = accrueStudyTime(clockRef.current, now, { visible: visibleOverride ?? visible() });
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
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      // A component can mount before its card is ready. Do not let that idle
      // time leak into the first enabled interval.
      clockRef.current = createStudyClock(Date.now());
      clockRef.current.enabled = false;
      return undefined;
    }
    if (!clockRef.current.enabled) clockRef.current = createStudyClock(Date.now());
    clockRef.current.enabled = true;
    noteInteraction();
    const events = ["pointerdown", "keydown", "wheel", "scroll", "touchmove"] as const;
    events.forEach((name) => document.addEventListener(name, noteInteraction, { capture: true, passive: true }));
    const interval = window.setInterval(flush, 15_000);
    const handleVisibility = () => {
      // visibilityState is already "hidden" when this event fires. Force the
      // transition's previous foreground tail to be accrued before pausing.
      flush(document.visibilityState === "hidden" ? true : undefined);
      if (document.visibilityState === "visible") noteInteraction();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      events.forEach((name) => document.removeEventListener(name, noteInteraction, { capture: true }));
      document.removeEventListener("visibilitychange", handleVisibility);
      flush();
    };
  }, [enabled, flush, noteInteraction]);
}
