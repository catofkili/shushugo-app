import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CloudBackupReminder } from "./CloudBackupReminder";

const harness = vi.hoisted(() => ({
  cursor: 0, values: [] as unknown[], effects: [] as Array<() => (() => void)>,
  session: { configured: true, token: undefined as string | undefined }, platform: "web", hasData: true, snoozedOn: null as string | null,
  login: vi.fn(), notice: vi.fn(), progress: () => undefined as void
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = harness.cursor++;
    if (!(slot in harness.values)) harness.values[slot] = typeof initial === "function" ? initial() : initial;
    return [harness.values[slot], (value: unknown) => { harness.values[slot] = value; }];
  },
  useEffect: (effect: () => (() => void)) => { harness.effects.push(effect); }
}));
vi.mock("../app/AppContext", () => ({ useApp: () => ({ cloudSession: harness.session, requireAccount: harness.login, showNotice: harness.notice }) }));
vi.mock("../lib/sync-api", () => ({ hasLocalLearningData: () => harness.hasData }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => harness.platform, isNativePlatform: () => false } }));
vi.mock("../lib/use-progress-updates", () => ({ useProgressUpdates: (refresh: () => void) => { harness.progress = refresh; } }));
vi.mock("@capacitor/preferences", () => ({ Preferences: {
  get: async () => ({ value: harness.snoozedOn }),
  set: vi.fn(async ({ value }: { value: string }) => { harness.snoozedOn = value; })
} }));

let cleanups: Array<() => void>;
const render = () => {
  harness.cursor = 0;
  return CloudBackupReminder();
};
const mount = async () => {
  render();
  cleanups = harness.effects.splice(0).map((effect) => effect());
  await Promise.resolve();
  return render();
};
const html = () => renderToStaticMarkup(render());
const buttons = (tree: ReactElement<any>) => (tree.props.children[1] as ReactElement<any>).props.children as Array<ReactElement<{ onClick(): void }>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 9, 23, 59));
  vi.stubGlobal("document", new EventTarget());
  Object.assign(harness, { cursor: 0, values: [], effects: [], session: { configured: true }, platform: "web", hasData: true, snoozedOn: null });
  vi.clearAllMocks();
  cleanups = [];
});
afterEach(() => { cleanups.forEach((cleanup) => cleanup()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("未登录且有学习记录时显示，登录备份调用现有登录入口，登录后消失", async () => {
  const tree = (await mount())!;
  expect(html()).toContain("还没登录，学习记录只存在这台设备上");
  expect(html()).toContain("登录备份");
  buttons(tree)[0].props.onClick();
  expect(harness.login).toHaveBeenCalledOnce();
  harness.session.token = "logged-in";
  expect(render()).toBeNull();
});

it.each(["已登录", "无学习记录", "今天点过稍后", "未配置同步"])("%s 时不显示", async (condition) => {
  if (condition === "已登录") harness.session.token = "logged-in";
  if (condition === "无学习记录") harness.hasData = false;
  if (condition === "今天点过稍后") harness.snoozedOn = "2026-11-09";
  if (condition === "未配置同步") harness.session.configured = false;
  expect(await mount()).toBeNull();
});

it("稍后记本地日期并立即隐藏；跨午夜后重新出现", async () => {
  buttons((await mount())!)[1].props.onClick();
  expect(harness.snoozedOn).toBe("2026-11-09");
  expect(render()).toBeNull();
  vi.advanceTimersByTime(60_000);
  expect(html()).toContain("登录备份");
});

it("首次作答后进度事件会让提醒出现", async () => {
  harness.hasData = false;
  expect(await mount()).toBeNull();
  harness.hasData = true;
  harness.progress();
  expect(html()).toContain("登录备份");
});

it("微信已有云函数传输，即使没有网页 API URL 也显示提醒", async () => {
  harness.platform = "wechat";
  harness.session.configured = false;
  await mount();
  expect(html()).toContain("登录备份");
});
