import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import type { AppNavigationParams } from "./AppContext";
import type { AppState } from "./app-store";
import type { Page, StudyMode } from "../types/app";
import { createAppActions } from "./actions";
import { readyForRoute } from "../lib/content-ready";

const { pickedStart } = vi.hoisted(() => ({ pickedStart: vi.fn(() => ({ session: { card: { id: 1 } } })) }));
vi.mock("../lib/api", () => ({ startPickedStudy: pickedStart, completeTodayWordPlan: vi.fn(), getProgressOverview: vi.fn(), recordStubbornQuickStudy: vi.fn() }));
vi.mock("../lib/content-ready", () => ({ readyForRoute: vi.fn() }));
vi.mock("./app-store", () => ({ setAppState: vi.fn() }));

// 沿用 WordStudy.motion 的离线办法，执行 App 的真实回调；只替换 state、ready 和平台边界。
const source = ts.createSourceFile("App.tsx", readFileSync(new URL("../App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nativeSource = ts.createSourceFile("WeappPage.tsx", readFileSync(new URL("../../../taro-spike-2/src/platform/WeappPage.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializer = (name: string, file = source) => {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw new Error(`missing production callback: ${name}`);
  return found.getText(file);
};
const open = () => {
  let state = { page: "home", pageHistory: [], launchStudyMode: "classic", selectedFoundationRuleId: null, wordStudyRevision: 0 } as unknown as AppState;
  const pending = new Map<Page, { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }>();
  const context = {
    useCallback: <T>(callback: T) => callback,
    navigationRevisionRef: { current: 0 },
    prefetchRoute: vi.fn(async () => undefined),
    readyForRoute: vi.fn((page: Page) => {
      let resolve!: () => void, reject!: (error: Error) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      pending.set(page, { promise, resolve, reject });
      return promise;
    }),
    getAppState: () => state,
    setAppState: (patch: Partial<AppState>) => { state = { ...state, ...patch }; },
    getStudyMode: () => "classic", defaultStudyMode: "classic", saveStudyMode: vi.fn(),
    accountProtectedPages: new Set(), proPages: {}, canUseFeature: () => true,
    cloudSession: { token: "local" }, entitlements: { isPro: true },
    setAuthOpen: vi.fn(), setPaywallTarget: vi.fn(), showNotice: vi.fn(),
    createAppActions, setOverview: vi.fn(), confirmDialog: vi.fn(), studyStore: { markLearned: vi.fn(), recordReview: vi.fn() }
  };
  vi.mocked(readyForRoute).mockImplementation(context.readyForRoute);
  pickedStart.mockClear();
  const compiled = ts.transpileModule(["navigateToPage", "navigate", "goBack", "openFoundationRule", "actions"].map(name => `const ${name} = ${initializer(name)};`).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const callbacks = new Function(...Object.keys(context), `${compiled}; return { navigateToPage, navigate, goBack, openFoundationRule, actions };`)(...Object.values(context)) as {
    navigateToPage(page: Page, mode?: StudyMode): Promise<void>;
    navigate(page: Page, params?: AppNavigationParams): void;
    goBack(): void;
    openFoundationRule(event: { detail: { ruleId: string } }): void;
    actions: ReturnType<typeof createAppActions>;
  };
  return { ...callbacks, context, pending, state: () => state };
};

it("语法气泡跳转在内容 ready 后保留指定条目；普通入口仍清空选中条目", async () => {
  const app = open();
  app.openFoundationRule({ detail: { ruleId: "particles-wa" } });
  expect(app.context.prefetchRoute).toHaveBeenCalledWith("grammar-foundation");
  expect(app.state().page).toBe("home");
  expect(app.state().selectedFoundationRuleId).toBeNull();
  const gate = app.pending.get("grammar-foundation")!;
  gate.resolve(); await gate.promise;
  expect(app.state().page).toBe("grammar-foundation");
  expect(app.state().selectedFoundationRuleId).toBe("particles-wa");
  const regular = app.navigateToPage("grammar-foundation");
  app.pending.get("grammar-foundation")!.resolve(); await regular;
  expect(app.state().selectedFoundationRuleId).toBeNull();
});

it("自选等内容时返回首页，迟到请求不能修改队列或重新发起跳页", async () => {
  const app = open();
  const picked = app.actions.startPickedStudy([1, 2]);
  const gate = app.pending.get("word")!;
  app.goBack();
  gate.resolve(); await picked;
  expect(pickedStart).not.toHaveBeenCalled();
  expect(app.context.readyForRoute).toHaveBeenCalledTimes(1);
  expect(app.state().page).toBe("home");
});

it("新自选请求取代旧请求，取消后的读取失败也不能给当前页弹提示", async () => {
  const app = open();
  const old = app.actions.startPickedStudy([1]);
  const oldGate = app.pending.get("word")!;
  const next = app.actions.startPickedStudy([2]);
  const nextGate = app.pending.get("word")!;
  oldGate.resolve(); await old;
  expect(pickedStart).not.toHaveBeenCalled();
  nextGate.resolve(); await next;
  expect(pickedStart).toHaveBeenCalledExactlyOnceWith([2]);
  const navigation = app.pending.get("word")!;
  navigation.resolve(); await navigation.promise;
  expect(app.state().page).toBe("word");

  const cancelled = app.actions.startPickedStudy([3]);
  const cancelledGate = app.pending.get("word")!;
  app.goBack();
  cancelledGate.reject(new Error("offline")); await cancelled;
  expect(app.context.showNotice).not.toHaveBeenCalled();
});

it("预取被返回取消或失败时，不提前写入目标参数或更改当前学习模式", async () => {
  const app = open();
  app.navigate("word", { studyMode: "mixed", wordListLevel: "N1" });
  expect(app.state().launchStudyMode).toBe("classic");
  expect(app.state().wordListLevel).toBeUndefined();
  app.goBack();
  const gate = app.pending.get("word")!;
  gate.resolve(); await gate.promise;
  expect(app.state().page).toBe("home");
  expect(app.state().launchStudyMode).toBe("classic");
  expect(app.state().wordListLevel).toBeUndefined();
  app.navigate("grammar-foundation", { selectedFoundationRuleId: "blocked" });
  const failed = app.pending.get("grammar-foundation")!;
  failed.reject(new Error("offline")); await failed.promise.catch(() => undefined);
  expect(app.state().selectedFoundationRuleId).toBeNull();
  expect(app.context.showNotice).toHaveBeenCalledWith("内容读取失败，请重试。", 2600);
});

it("小程序共享自选入口也受原生返回和新导航取消；正常请求只启动一次", async () => {
  const app = open();
  const context = {
    ...app.context,
    protectedPages: new Set(), openAuth: vi.fn(), openPaywall: vi.fn(), showModal: vi.fn(),
    ROUTE_TABLE: [{ page: "home", path: "pages/home/index", tab: true }, { page: "word", path: "pages/word/index", tab: true }],
    Taro: { getCurrentPages: () => [{}], switchTab: vi.fn(async () => undefined) }
  };
  const compiled = ts.transpileModule(["navigatePage", "goBack", "actions"].map(name => `const ${name} = ${initializer(name, nativeSource)};`).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const native = new Function(...Object.keys(context), `let navigationRevision = 0; ${compiled}; return { navigatePage, goBack, actions };`)(...Object.values(context)) as {
    navigatePage(page: Page): Promise<void>; goBack(): void; actions: ReturnType<typeof createAppActions>;
  };
  const picked = native.actions.startPickedStudy([1]);
  const gate = app.pending.get("word")!;
  native.goBack();
  gate.resolve(); await picked;
  expect(pickedStart).not.toHaveBeenCalled();
  expect(context.Taro.switchTab).not.toHaveBeenCalled();

  const cancelled = native.actions.startPickedStudy([2]);
  const cancelledGate = app.pending.get("word")!;
  const home = native.navigatePage("home");
  cancelledGate.reject(new Error("offline")); await cancelled;
  expect(pickedStart).not.toHaveBeenCalled();
  expect(context.showNotice).not.toHaveBeenCalled();
  app.pending.get("home")!.resolve(); await home;

  const current = native.actions.startPickedStudy([3]);
  app.pending.get("word")!.resolve(); await current;
  expect(pickedStart).toHaveBeenCalledExactlyOnceWith([3]);
  const navigation = app.pending.get("word")!;
  navigation.resolve(); await navigation.promise;
  expect(context.Taro.switchTab).toHaveBeenLastCalledWith({ url: "/pages/word/index" });
});
