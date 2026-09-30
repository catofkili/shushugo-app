import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { LevelSetup } from "./LevelSetup";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(() => null),
  preview: vi.fn(() => null),
  save: vi.fn(async () => {}),
  preset: vi.fn(() => ({ plan: { words: { fresh: 20 } } })),
  complete: vi.fn(),
  portal: null as unknown
}));
vi.mock("react-dom", () => ({ createPortal: (children: unknown) => { mocks.portal = children; return children; } }));
vi.mock("../lib/level-plan", () => ({
  getLevelPlanSettings: mocks.settings,
  saveLevelPlanSettings: mocks.save,
  familiarityDefaults: () => ({ words: 0, grammar: 0, kanji: 0, confusion: 0 })
}));
vi.mock("../lib/daily-plan", () => ({ previewCurrentLevelPlan: mocks.preview, applyExamPreset: mocks.preset }));
vi.mock("../lib/level-setup-flow", () => ({ completeLevelSetup: mocks.complete, shouldOfferOnboardingGift: () => false }));
vi.mock("../lib/kana-progress", () => ({ deferWordPlanUntilKanaComplete: vi.fn() }));
vi.mock("../lib/sync-api", () => ({ claimLaunchGift: vi.fn(), refreshLaunchGiftAvailability: vi.fn() }));
vi.mock("../lib/purchases", () => ({ isLaunchGiftOnlyRelease: () => false }));
vi.mock("../hooks/useEntitlements", () => ({ useEntitlements: () => ({ isPro: false }) }));
vi.mock("../lib/entitlements", () => ({ getEntitlements: () => ({ isPro: false }) }));
vi.mock("./CapybaraMascot", () => ({ Sticker: () => null }));

function saveButton(node: ReactNode): (() => Promise<void>) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => Promise<void> }>(child)) continue;
    if (child.type === "button" && String(child.props.children).includes("保存并查看")) return child.props.onClick;
    const found = saveButton(child.props.children);
    if (found) return found;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", { body: {} });
});

it("未开库时能渲染静态预估，错误仍用原警告样式；网页默认继续读库", () => {
  mocks.settings.mockImplementationOnce(() => { throw new Error("库没开"); });
  const html = renderToStaticMarkup(<LevelSetup open databaseReady={false} databaseError="下载失败" onComplete={() => {}} />);
  expect(html).toContain("每天");
  expect(html).toContain("ds-say-warn");
  expect(html).toContain("下载失败");
  expect(mocks.settings).not.toHaveBeenCalled();
  expect(mocks.preview).not.toHaveBeenCalled();
  // 前一次设成会抛错，是为了证明关闭开关后完全没有读库；恢复网页模拟。
  mocks.settings.mockReset().mockReturnValue(null);
  renderToStaticMarkup(<LevelSetup open onComplete={() => {}} />);
  expect(mocks.settings).toHaveBeenCalledOnce();
  expect(mocks.preview).toHaveBeenCalledOnce();
});

it("点保存后等待初始化，再自动写计划，不需第二次点击", async () => {
  let ready!: () => void;
  const preparing = new Promise<void>((resolve) => { ready = resolve; });
  renderToStaticMarkup(<LevelSetup open databaseReady={false} prepareDatabase={() => preparing} onComplete={() => {}} />);
  const pending = saveButton(mocks.portal as ReactNode)!();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.preset).not.toHaveBeenCalled();
  ready();
  await pending;
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ startingLevel: "kana", target: "N3" }));
  expect(mocks.preset).toHaveBeenCalledOnce();
  expect(mocks.complete).toHaveBeenCalledOnce();
});

it("初始化失败不写库，用户重试后才保存", async () => {
  const prepare = vi.fn().mockRejectedValueOnce(new Error("下载失败")).mockResolvedValueOnce(undefined);
  renderToStaticMarkup(<LevelSetup open databaseReady={false} prepareDatabase={prepare} onComplete={() => {}} />);
  const submit = saveButton(mocks.portal as ReactNode)!;
  await submit();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
  await submit();
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.complete).toHaveBeenCalledOnce();
});
