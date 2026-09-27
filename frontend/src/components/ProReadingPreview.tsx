import { useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { Crown } from "lucide-react";
import { claimLaunchGift, refreshLaunchGiftAvailability } from "../lib/sync-api";
import { isLaunchGiftOnlyRelease } from "../lib/purchases";
import { useApp } from "../app/AppContext";
import { useEntitlements } from "../hooks/useEntitlements";
import { Sticker } from "./CapybaraMascot";

export const ProReadingGate = ({ title, onUpgrade, onRequireAuth }: {
  title: string;
  onUpgrade: () => void;
  onRequireAuth?: () => void;
}) => {
  const entitlements = useEntitlements();
  const { cloudSession, requireAccount, showNotice } = useApp();
  const isWechat = Capacitor.getPlatform() === "wechat";
  const giftOnly = isWechat && isLaunchGiftOnlyRelease();
  const [giftStatus, setGiftStatus] = useState<"loading" | "open" | "closed" | "unavailable">("loading");
  const [claiming, setClaiming] = useState(false);
  useEffect(() => {
    if (!isWechat) return;
    void refreshLaunchGiftAvailability().then((gift) => setGiftStatus(gift ? gift.open ? "open" : "closed" : "unavailable")).catch(() => setGiftStatus("unavailable"));
  }, [isWechat]);
  const launchGiftOpen = isWechat && (giftOnly
    ? giftStatus === "open"
    : giftStatus === "open" || giftStatus !== "closed" && entitlements.launchGift?.open === true);
  const buttonText = giftOnly
    ? launchGiftOpen ? cloudSession.token ? "领取首月会员" : "登录领取首月会员" : giftStatus === "closed" ? "首月赠送活动已结束" : giftStatus === "loading" ? "正在查询首月赠送活动…" : "暂时无法查询首月赠送活动"
    : launchGiftOpen ? "登录领取首月会员" : "查看会员方案";
  const activate = async () => {
    if (!giftOnly) {
      if (launchGiftOpen) (onRequireAuth ?? requireAccount)();
      else onUpgrade();
      return;
    }
    if (!launchGiftOpen) return;
    if (!cloudSession.token) {
      (onRequireAuth ?? requireAccount)();
      return;
    }
    setClaiming(true);
    try {
      await claimLaunchGift();
      showNotice("首月会员已领取。", 2600);
    } catch (error) {
      const availability = await refreshLaunchGiftAvailability().catch(() => undefined);
      if (availability?.open === false) setGiftStatus("closed");
      showNotice(availability?.open === false ? "首月赠送活动已结束。" : error instanceof Error ? error.message : "领取失败，请稍后重试。", 3200);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="pro-reading-preview-gate">
      <div className="pro-reading-preview-copy">
        {/* 三角里坐一只害羞的水豚：这块是「请你开通」，不是一面冷冰冰的墙 */}
        <Sticker name="mood-shy" size={64} className="pro-reading-preview-mascot" />
        <span><Crown size={14} aria-hidden="true" />{giftOnly ? "首月赠送会员" : "收集日 Pro"}</span>
        <h2>{giftOnly ? `领首月会员，看完整${title}` : `解锁完整${title}`}</h2>
        <button type="button" onClick={() => void activate()} disabled={claiming || giftOnly && !launchGiftOpen}>{claiming ? "领取中…" : buttonText}</button>
      </div>
    </div>
  );
};

export const ProReadingPreview = ({ title, onUpgrade, onRequireAuth, children }: {
  title: string;
  onUpgrade: () => void;
  onRequireAuth?: () => void;
  children: ReactNode;
}) => (
  <section className="pro-reading-preview" aria-label={`${title}会员预览`}>
    <div className="pro-reading-preview-content" inert>{children}</div>
    <ProReadingGate title={title} onUpgrade={onUpgrade} onRequireAuth={onRequireAuth} />
  </section>
);
