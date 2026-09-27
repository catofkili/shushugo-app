import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("./api", () => ({ refreshTodayWordPlan: vi.fn() }));
vi.mock("./mixed-cards", () => ({ refreshMixedCardTasks: vi.fn() }));
vi.mock("./database", () => ({ getDatabase: vi.fn(() => "db") }));
vi.mock("./progress-events", () => ({ notifyProgressUpdated: vi.fn() }));
vi.mock("./studyMode", () => ({ saveStudyMode: vi.fn() }));

import { getEntitlements } from "./entitlements";
import { refreshTodayWordPlan } from "./api";
import { refreshMixedCardTasks } from "./mixed-cards";
import { notifyProgressUpdated } from "./progress-events";
import { saveStudyMode } from "./studyMode";
import { completeLevelSetup, shouldOfferOnboardingGift } from "./level-setup-flow";

describe("LevelSetup launch gift", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows only for an open, gift-only WeChat release with a non-member", () => {
    const eligible = { firstSetup: true, platform: "wechat", purchaseEnabled: false, isPro: false, gift: { open: true, claimUntil: "2026-10-01" } };
    expect(shouldOfferOnboardingGift(eligible)).toBe(true);
    expect(shouldOfferOnboardingGift({ ...eligible, firstSetup: false })).toBe(false);
    expect(shouldOfferOnboardingGift({ ...eligible, platform: "web" })).toBe(false);
    expect(shouldOfferOnboardingGift({ ...eligible, purchaseEnabled: true })).toBe(false);
    expect(shouldOfferOnboardingGift({ ...eligible, isPro: true })).toBe(false);
    expect(shouldOfferOnboardingGift({ ...eligible, gift: { open: false, claimUntil: null } })).toBe(false);
    expect(shouldOfferOnboardingGift({ ...eligible, gift: undefined })).toBe(false);
  });

  it("keeps the original completion path when a non-member skips", () => {
    vi.mocked(getEntitlements).mockReturnValue({ isPro: false, source: "free", updatedAt: "now" });
    const onComplete = vi.fn();

    completeLevelSetup(onComplete);

    expect(saveStudyMode).toHaveBeenCalledWith("classic");
    expect(refreshTodayWordPlan).toHaveBeenCalledOnce();
    expect(refreshMixedCardTasks).toHaveBeenCalledWith("db");
    expect(notifyProgressUpdated).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith("计划已创建；当前先安排单词。 先完成今天的任务。");
  });

  it("uses mixed study and member copy after a successful claim", () => {
    vi.mocked(getEntitlements).mockReturnValue({ isPro: true, source: "cloud", updatedAt: "now" });
    const onComplete = vi.fn();

    completeLevelSetup(onComplete);

    expect(saveStudyMode).toHaveBeenCalledWith("mixed");
    expect(onComplete).toHaveBeenCalledWith("完整计划已启用。 先完成今天的任务。");
  });

});
