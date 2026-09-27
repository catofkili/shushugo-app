import { foregroundEvent, startFeedbackRuntimeCore } from "../../../frontend/src/lib/feedback-runtime-core";

type MiniApp = {
  onError?: (listener: (message: string) => void) => void;
  offError?: (listener: (message: string) => void) => void;
  onUnhandledRejection?: (listener: (event: { reason?: unknown }) => void) => void;
  offUnhandledRejection?: (listener: (event: { reason?: unknown }) => void) => void;
  onAppHide?: (listener: () => void) => void;
  offAppHide?: (listener: () => void) => void;
  onAppShow?: (listener: () => void) => void;
  offAppShow?: (listener: () => void) => void;
  onNetworkStatusChange?: (listener: () => void) => void;
  offNetworkStatusChange?: (listener: () => void) => void;
};

const mini = (globalThis as typeof globalThis & { wx?: MiniApp }).wx;

export const startFeedbackRuntime = (): (() => void) => {
  let visible = true;
  return startFeedbackRuntimeCore({
    bindErrors(onError) {
      const onErrorMessage = (message: string) => onError(new Error(String(message || "小程序运行错误")));
      const onRejection = (event: { reason?: unknown }) => onError(
        event?.reason instanceof Error ? event.reason : new Error("未处理的异步错误")
      );
      mini?.onError?.(onErrorMessage);
      mini?.onUnhandledRejection?.(onRejection);
      return () => {
        mini?.offError?.(onErrorMessage);
        mini?.offUnhandledRejection?.(onRejection);
      };
    },
    subscribeVisibility(listener) {
      const hide = () => { visible = false; listener(foregroundEvent(false)); };
      const show = () => { visible = true; listener(foregroundEvent(true)); };
      mini?.onAppHide?.(hide);
      mini?.onAppShow?.(show);
      return () => {
        mini?.offAppHide?.(hide);
        mini?.offAppShow?.(show);
      };
    },
    isVisible: () => visible,
    subscribeOnline(listener) {
      const onNetwork = () => listener();
      mini?.onNetworkStatusChange?.(onNetwork);
      return () => mini?.offNetworkStatusChange?.(onNetwork);
    }
  });
};
