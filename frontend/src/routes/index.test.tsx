import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ loads: [] as string[], grammarMode: "learn" }));
vi.mock("./home", () => ({ HomeRoute: () => <p>home</p> }));
vi.mock("./shared", () => ({ ToolSubpage: ({ children }: { children: ReactNode }) => children }));
vi.mock("../app/AppContext", () => ({ useApp: () => ({ state: { grammarMode: harness.grammarMode }, studyStore: {}, actions: {}, entitlements: {} }) }));
vi.mock("../app/app-store", () => ({ getAppState: () => ({ grammarMode: harness.grammarMode }) }));
vi.mock("../components/GrammarHighlightProvider", () => ({ GrammarHighlightProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../components/ProReadingPreview", () => ({ ProReadingPreview: ({ children }: { children: ReactNode }) => children }));
vi.mock("../lib/entitlements", () => ({ canUseFeature: () => true }));

let frames: Map<number, FrameRequestCallback>;
let idles: Map<number, () => void>;
let sequence: number;
const frame = () => {
  const [id, callback] = frames.entries().next().value!;
  frames.delete(id);
  callback(0);
};
const idle = async () => {
  const [id, callback] = idles.entries().next().value!;
  idles.delete(id);
  callback();
  await vi.dynamicImportSettled();
};
beforeEach(() => {
  vi.resetModules();
  vi.doMock("./word", () => { harness.loads.push("word"); return { WordRoute: () => <p>word</p> }; });
  vi.doMock("../pages/Library", () => { harness.loads.push("grammar"); return { Library: () => <p>grammar</p> }; });
  vi.doMock("../pages/ProfilePage", () => { harness.loads.push("profile"); return { ProfilePage: () => <p>profile</p> }; });
  vi.doMock("../pages/QuickStudyPage", () => { harness.loads.push("quick-study"); return { QuickStudyPage: () => <p>quick-study</p> }; });
  harness.loads = [];
  harness.grammarMode = "learn";
  frames = new Map(); idles = new Map(); sequence = 0;
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    requestIdleCallback: (callback: () => void) => { idles.set(++sequence, callback); return sequence; },
    cancelIdleCallback: (id: number) => idles.delete(id),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("网页路由预取", () => {
  it("首页画出一帧后才逐个 idle 预取主入口，包含实际页面；首次渲染无需兜底", async () => {
    const { prefetchHomeRoutes, ROUTES } = await import("./index");
    expect(harness.loads).toEqual([]);
    const cancel = prefetchHomeRoutes();
    expect(idles.size).toBe(0);
    frame();
    expect(idles.size).toBe(0);
    frame();
    expect(harness.loads).toEqual([]);
    for (const page of ["word", "grammar", "quick-study", "profile"] as const) {
      expect(idles.size).toBe(1);
      await idle();
      const Route = ROUTES[page];
      expect(renderToStaticMarkup(<Route />)).toContain(`<p>${page}</p>`);
    }
    expect(harness.loads).toEqual(["word", "grammar", "quick-study", "profile"]);
    expect(idles.size).toBe(0);
    cancel();
  });
  it("离开首页取消后续空闲预取；点击预取可直接复用同一份代码", async () => {
    const { prefetchHomeRoutes, prefetchRoute, ROUTES } = await import("./index");
    const cancel = prefetchHomeRoutes();
    frame(); frame();
    await idle();
    cancel();
    expect(idles.size).toBe(0);
    await Promise.all([prefetchRoute("profile"), prefetchRoute("profile")]);
    expect(harness.loads).toEqual(["word", "profile"]);
    expect(renderToStaticMarkup(<ROUTES.profile />)).toBe("<p>profile</p>");
  });
  it("没有 requestIdleCallback 时也先绘制，再逐段定时预取；卸载取消定时器", async () => {
    vi.useFakeTimers();
    window.requestIdleCallback = undefined as unknown as typeof window.requestIdleCallback;
    window.setTimeout = globalThis.setTimeout;
    window.clearTimeout = globalThis.clearTimeout;
    const { prefetchHomeRoutes } = await import("./index");
    const cancel = prefetchHomeRoutes();
    frame(); frame();
    expect(vi.getTimerCount()).toBe(1);
    expect(harness.loads).toEqual([]);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
});
