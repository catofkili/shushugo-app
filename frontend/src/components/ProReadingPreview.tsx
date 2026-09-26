import { useEffect, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { Crown } from "lucide-react";
import { refreshLaunchGiftAvailability } from "../lib/sync-api";
import { useEntitlements } from "../hooks/useEntitlements";
import { Sticker } from "./CapybaraMascot";

export const ProReadingGate = ({ title, onUpgrade, onRequireAuth }: {
  title: string;
  onUpgrade: () => void;
  onRequireAuth?: () => void;
}) => {
  const entitlements = useEntitlements();
  const isWechat = Capacitor.getPlatform() === "wechat";
  const launchGiftOpen = isWechat && entitlements.launchGift?.open;
  useEffect(() => {
    if (isWechat) void refreshLaunchGiftAvailability().catch(() => undefined);
  }, [isWechat]);
  const buttonText = launchGiftOpen
    ? "登录领取首月会员"
    : "查看会员方案";

  return (
    <div className="pro-reading-preview-gate">
      <div className="pro-reading-preview-copy">
        {/* 三角里坐一只害羞的水豚：这块是「请你开通」，不是一面冷冰冰的墙 */}
        <Sticker name="mood-shy" size={64} className="pro-reading-preview-mascot" />
        <span><Crown size={14} aria-hidden="true" />收集日 Pro</span>
        <h2>解锁完整{title}</h2>
        <button type="button" onClick={launchGiftOpen ? onRequireAuth ?? onUpgrade : onUpgrade}>{buttonText}</button>
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
