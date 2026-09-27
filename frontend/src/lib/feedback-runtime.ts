import { foregroundEvent, startFeedbackRuntimeCore } from "./feedback-runtime-core";

export const startFeedbackRuntime = (): (() => void) => startFeedbackRuntimeCore({
  bindErrors(onError) {
    const onWindowError = (event: ErrorEvent) => onError(
      event.error instanceof Error ? event.error : new Error(event.message || "页面脚本运行错误")
    );
    const onUnhandledRejection = (event: PromiseRejectionEvent) => onError(
      event.reason instanceof Error ? event.reason : new Error("未处理的异步错误")
    );
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  },
  subscribeVisibility(listener) {
    const onVisibility = () => listener(foregroundEvent(document.visibilityState !== "hidden"));
    const onPageHide = () => listener(foregroundEvent(false));
    const onPageShow = () => listener(foregroundEvent(true));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  },
  isVisible: () => document.visibilityState !== "hidden",
  subscribeOnline(listener) {
    window.addEventListener("online", listener);
    return () => window.removeEventListener("online", listener);
  }
});
