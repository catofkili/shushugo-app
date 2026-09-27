import { getEntitlements, type LaunchGiftAvailability } from "./entitlements";
import { refreshTodayWordPlan } from "./api";
import { refreshMixedCardTasks } from "./mixed-cards";
import { getDatabase } from "./database";
import { notifyProgressUpdated } from "./progress-events";
import { saveStudyMode } from "./studyMode";

export function shouldOfferOnboardingGift({
  firstSetup,
  platform,
  purchaseEnabled,
  isPro,
  gift
}: {
  firstSetup: boolean;
  platform: string;
  purchaseEnabled: boolean;
  isPro: boolean;
  gift?: LaunchGiftAvailability;
}): boolean {
  return firstSetup && platform === "wechat" && !purchaseEnabled && !isPro && gift?.open === true;
}

export function completeLevelSetup(onComplete: (message: string) => void): void {
  const entitlement = getEntitlements();
  saveStudyMode(entitlement.isPro ? "mixed" : "classic");
  refreshTodayWordPlan();
  refreshMixedCardTasks(getDatabase());
  notifyProgressUpdated();
  const accessText = entitlement.isPro ? "完整计划已启用。" : "计划已创建；当前先安排单词。";
  onComplete(`${accessText} 先完成今天的任务。`);
}
