import type { AnimationEvent, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  mode: "full", platform: "web", cursor: 0, mounted: false,
  values: [] as unknown[], cleanups: [] as (() => void)[]
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = harness.cursor++;
    if (!(slot in harness.values)) harness.values[slot] = initial;
    return [harness.values[slot], (next: unknown) => { harness.values[slot] = next; }];
  },
  useRef: (initial: unknown) => {
    const slot = harness.cursor++;
    return harness.values[slot] ??= { current: initial };
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => () => void) => {
    if (!harness.mounted) harness.cleanups.push(effect());
  }
}));
vi.mock("react-dom", () => ({ createPortal: (child: unknown) => child }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => harness.platform } }));
vi.mock("../lib/studyPreferences", () => ({ jsMotionAllowed: () => harness.mode === "full" }));
vi.mock("./CapybaraMascot", () => ({ Sticker: () => null }));
import { useZoomOpen } from "./ZoomOpen";

const event = { clientX: 80, clientY: 160 };
const renderHook = () => {
  harness.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 此处用上面的 hooks harness 执行真实 hook，不依赖 DOM renderer。
  const hook = useZoomOpen();
  harness.mounted = true;
  return hook;
};
const unmount = () => harness.cleanups.splice(0).forEach((cleanup) => cleanup());
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", { body: {} });
  Object.assign(harness, { mode: "full", platform: "web", cursor: 0, mounted: false, values: [], cleanups: [] });
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("ZoomOpen 等待", () => {
  it.each(["off", "reduced"])("%s 在 0ms 定时器内导航，预取从点击当下开始，同 tick 连点只执行一次", (mode) => {
    harness.mode = mode;
    const hook = renderHook();
    const go = vi.fn();
    const prefetch = vi.fn();
    hook.open(event, go, undefined, prefetch);
    hook.open(event, go, undefined, prefetch);
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
    expect(renderHook().overlay).toBeNull();
    vi.advanceTimersByTime(0);
    expect(go).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("小程序即使全开也在 0ms 导航", () => {
    harness.platform = "wechat";
    const hook = renderHook();
    const go = vi.fn();
    hook.open(event, go);
    expect(renderHook().overlay).toBeNull();
    vi.advanceTimersByTime(0);
    expect(go).toHaveBeenCalledOnce();
  });

  it("全开丢失 animationend 也在 300ms 放行，迟到事件不会再次导航", () => {
    const hook = renderHook();
    const go = vi.fn();
    const prefetch = vi.fn();
    hook.open(event, go, undefined, prefetch);
    expect(prefetch).toHaveBeenCalledOnce();
    const overlay = renderHook().overlay as ReactElement<{ children: ReactElement<{ onAnimationEnd: (event: AnimationEvent) => void }> }>;
    expect(overlay).not.toBeNull();
    vi.advanceTimersByTime(299);
    expect(go).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    const target = {};
    overlay.props.children.props.onAnimationEnd({ target, currentTarget: target, animationName: "zoom-open-expand" } as AnimationEvent);
    expect(go).toHaveBeenCalledOnce();
  });

  it("只接受遮罩本身的结束事件，提前结束会取消兜底计时器", () => {
    const hook = renderHook();
    const go = vi.fn();
    hook.open(event, go);
    const overlay = renderHook().overlay as ReactElement<{ children: ReactElement<{ onAnimationEnd: (event: AnimationEvent) => void }> }>;
    const target = {};
    const end = overlay.props.children.props.onAnimationEnd;
    end({ target: {}, currentTarget: target, animationName: "zoom-open-art" } as AnimationEvent);
    expect(go).not.toHaveBeenCalled();
    vi.advanceTimersByTime(280);
    end({ target, currentTarget: target, animationName: "zoom-open-expand" } as AnimationEvent);
    expect(go).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(go).toHaveBeenCalledOnce();
  });

  it.each(["off", "full"])("%s 卸载清掉待导航回调", (mode) => {
    harness.mode = mode;
    const go = vi.fn();
    renderHook().open(event, go);
    unmount();
    vi.runAllTimers();
    expect(go).not.toHaveBeenCalled();
  });

  it("导航抛错仍释放点击锁", () => {
    harness.mode = "off";
    const hook = renderHook();
    hook.open(event, () => { throw new Error("navigation failed"); });
    expect(() => vi.advanceTimersByTime(0)).toThrow("navigation failed");
    const retry = vi.fn();
    hook.open(event, retry);
    vi.advanceTimersByTime(0);
    expect(retry).toHaveBeenCalledOnce();
  });
});
