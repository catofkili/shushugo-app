import { useEffect, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import type { FeatureId, ProductId } from "../lib/entitlements";
import { claimLaunchGift, getCloudSession, refreshLaunchGiftAvailability, type LaunchGiftAvailability } from "../lib/sync-api";
import { getPurchaseRuntime, initializePurchases, purchaseProduct, type StoreProduct } from "../lib/purchases";
import { useEntitlements } from "../hooks/useEntitlements";
import { AuthDialog } from "./AuthDialog";

const copy: Partial<Record<FeatureId, [string, string]>> = {
  confusionGroups: ["疑难辨析是 Pro 功能", "1,881 组近义、同音、自他、汉字用法对照。"],
  kanjiReadingUsage: ["一字多音是 Pro 功能", "520 个多音字，理解什么时候读哪个音。"],
  mixedStudy: ["混合学习是 Pro 功能", "单词、语法、汉字和辨析进入同一学习队列。"],
  immersiveGrammar: ["沉浸式语法学习是 Pro 功能", "集中学习语法并减少页面切换。"]
};

export function Paywall({ feature, onClose, onUnlocked, onOpenPrivacy }: {
  feature?: FeatureId; onClose: () => void; onUnlocked?: () => void; onOpenPrivacy?: () => void;
}) {
  const entitlements = useEntitlements();
  const [products, setProducts] = useState<StoreProduct[]>(getPurchaseRuntime().products);
  const [status, setStatus] = useState(getPurchaseRuntime().message);
  const [gift, setGift] = useState<LaunchGiftAvailability>();
  const [hasSession, setHasSession] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyProduct, setBusyProduct] = useState<ProductId | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const featureCopy = feature ? copy[feature] : undefined;

  useEffect(() => {
    void initializePurchases().then((runtime) => { setProducts(runtime.products); setStatus(runtime.message); });
    void getCloudSession().then((session) => setHasSession(Boolean(session.token)));
    void refreshLaunchGiftAvailability().then(setGift).catch(() => setGift(undefined));
  }, []);
  useEffect(() => { if (entitlements.isPro) onUnlocked?.(); }, [entitlements.isPro, onUnlocked]);

  const claim = async () => {
    if (!hasSession) { setAuthOpen(true); return; }
    setBusy(true);
    try { await claimLaunchGift(); await onUnlocked?.(); setStatus("首月会员已领取。"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "领取失败，请稍后重试。"); }
    finally { setBusy(false); }
  };
  const buy = async (product: StoreProduct) => {
    setBusyProduct(product.id);
    const result = await purchaseProduct(product.id);
    setStatus(result.message);
    setBusyProduct(null);
  };

  return <View className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label={featureCopy?.[0] || "收集日 Pro"}>
    <View className="w-full max-w-[520px] rounded-[28px] bg-[#303730] p-5 text-white">
      <View className="mb-3 flex items-center"><Text className="flex-1 text-base font-bold">收集日 Pro</Text><Button onClick={onClose}>关闭</Button></View>
      <Text className="block text-lg font-bold">{featureCopy?.[0] || "升级收集日 Pro"}</Text>
      <Text className="mt-2 block text-sm leading-6 text-white/65">{featureCopy?.[1] || "解锁更完整的学习节奏、统计和训练入口。"}</Text>
      {gift?.open && !entitlements.isPro ? <Button className="mt-4 w-full bg-[#07C160] text-white" disabled={busy} onClick={() => void claim()}>{busy ? "处理中…" : "登录领取首月会员"}</Button> : null}
      {!gift?.open && products.map((product) => <Button key={product.id} className="mt-3 w-full" disabled={Boolean(busyProduct)} onClick={() => void buy(product)}>{busyProduct === product.id ? "处理中…" : `${product.title} ${product.price}`}</Button>)}
      {!gift?.open && !products.length && <Text className="mt-4 block text-xs text-white/55">{status}</Text>}
      {gift?.open && <Text className="mt-3 block text-xs text-white/55">{hasSession ? "已登录账号符合领取条件时，可领取一次。" : "微信登录后可领取；邮箱密码和 Apple 登录在小程序中不可用。"}</Text>}
      {onOpenPrivacy && <Button className="mt-2" onClick={onOpenPrivacy}>隐私政策</Button>}
      <Button className="mt-2" onClick={() => setPrivacyOpen((value) => !value)}>{privacyOpen ? "收起" : "查看支付状态"}</Button>
      {privacyOpen && <Text className="mt-2 block text-xs text-white/55">{status}</Text>}
    </View>
    <AuthDialog open={authOpen} onClose={() => { setAuthOpen(false); void getCloudSession().then((session) => setHasSession(Boolean(session.token))); }} onAuthenticated={async () => { setHasSession(true); setGift(await refreshLaunchGiftAvailability().catch(() => undefined)); }} />
  </View>;
}
