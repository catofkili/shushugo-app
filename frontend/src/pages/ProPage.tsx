import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, CheckCircle2, ChevronRight, Clock3, Crown, RotateCcw, ShieldCheck, Sparkles, Ticket } from "lucide-react";
import { entitlementExpiryLabel, EntitlementState, productLabel, type LaunchGiftAvailability } from "../lib/entitlements";
import { MascotSay } from "../components/MascotSay";
import { Sticker } from "../components/CapybaraMascot";
import { initializePurchases, isLaunchGiftOnlyRelease, redeemOfferCode, restorePurchases } from "../lib/purchases";
import { claimLaunchGift, refreshLaunchGiftAvailability } from "../lib/sync-api";

interface ProPageProps {
  entitlements: EntitlementState;
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  onBack: () => void;
  onOpenPaywall: () => void;
  onOpenPrivacy: () => void;
}

/**
 * ⚠️ live 行 = 真的锁在 Pro 后面的功能（以 `entitlements.ts` 的 FeatureId 和真实入口为准，
 * 新锁一个功能要来这里加一行）；live=false 的是产品路线。
 * `FeatureId` 里的 advancedDashboard / unlimitedMistakes / fullJlptPlan 仍没有调用方，
 * 学习总览、JLPT 规划免费用户本来就在用。
 *
 * 所以这里如实标注,把没上锁的写成「开发中」。**没有顺手去给它们上锁** ——
 * 那等于把现在能用的东西收走,是产品决定,不该由一次文案修订带出来。
 */
// 已上线那几行的文案跟 Paywall.tsx 的 featureCopy 同一个口径；2026-09-23 之前这里只列了沉浸式语法，
// 页头还写着「其余权益还在开发中」—— 疑难辨析、一字多音、混合学习、往日顽固词早就锁在 Pro 后面了。
const rows = [
  { label: "疑难辨析", detail: "近义、同音、自他、汉字用法对照，连线题练到分得清", live: true },
  { label: "一字多音", detail: "520 个多音字，什么时候读哪个音", live: true },
  { label: "混合学习", detail: "单词、语法、汉字、辨析进同一条队列", live: true },
  { label: "沉浸式语法学习", detail: "低干扰阅读卡片，适合集中推进", live: true },
  { label: "往日顽固词", detail: "翻回任意一天跟你打过架的词", live: true }
  // 2026-09-27 删了三行「开发中」（高级学习总览 / 完整 JLPT 规划 / 专项训练和 AI 讲解）：
  // 会员页上摆没做出来的权益，审核按虚假宣传算，用户也会当成已经买到的东西。做出来再加回。
];

export function ProPage({ entitlements, isAuthenticated, onRequireAuth, onBack, onOpenPaywall, onOpenPrivacy }: ProPageProps) {
  const isWechatMini = Capacitor.getPlatform() === "wechat";
  const giftOnly = isWechatMini && isLaunchGiftOnlyRelease();
  const [message, setMessage] = useState(() => giftOnly ? "登录领取首月会员。" : isWechatMini ? "微信支付尚未开放。" : "正在准备 App Store 商品信息...");
  const [restoring, setRestoring] = useState(false);
  const [gift, setGift] = useState<LaunchGiftAvailability | undefined>(entitlements.launchGift);
  const [giftLoading, setGiftLoading] = useState(giftOnly);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (giftOnly) {
      void refreshLaunchGiftAvailability().then((availability) => {
        setGift(availability);
        setGiftLoading(false);
        if (!availability) setMessage("暂时无法查询首月赠送活动，请稍后重试。");
      }).catch(() => {
        setGift(undefined);
        setGiftLoading(false);
        setMessage("暂时无法查询首月赠送活动，请稍后重试。");
      });
    } else {
      initializePurchases().then((runtime) => setMessage(runtime.message));
    }
  }, [giftOnly]);

  const restore = async () => {
    setRestoring(true);
    const result = await restorePurchases();
    setMessage(result.message);
    setRestoring(false);
  };

  const claimGift = async () => {
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    setClaiming(true);
    try {
      const updated = await claimLaunchGift();
      setMessage(updated ? `首月会员已领取 · ${entitlementExpiryLabel(updated)}` : "登录后即可领取首月会员。");
    } catch (error) {
      const availability = await refreshLaunchGiftAvailability().catch(() => undefined);
      if (availability) setGift(availability);
      setMessage(availability?.open === false ? "首月赠送活动已结束。" : error instanceof Error ? error.message : "领取失败，请稍后重试。");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="page-backbar mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button onClick={onBack} className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8">
          <ArrowLeft size={17} />
          返回
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">{giftOnly ? "首月赠送会员" : "收集日 Pro"}</p>
      </div>

      <section className="ds-card p-5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <span className="ds-pill ds-pill-primary"><Crown size={13} /> 会员</span>
            <h1 className="mt-2 text-2xl font-black text-white">{giftOnly ? entitlements.isPro ? "首月会员已启用" : "首月赠送会员" : entitlements.isPro ? "收集日 Pro 已启用" : "升级收集日 Pro"}</h1>
            <p className="mt-2 text-sm leading-6 text-white/66">
              {giftOnly && entitlements.isPro
                ? `${productLabel(entitlements.productId)} · ${entitlementExpiryLabel(entitlements)}`
                : entitlements.isPro
                ? `${productLabel(entitlements.productId)} · ${isWechatMini ? entitlementExpiryLabel(entitlements) : entitlements.source === "development" ? "本地开发解锁" : "App Store 权益"}`
                : giftOnly
                ? "免费领取，无需绑定支付方式。下面这些都能用。"
                : "开通后下面这些立即可用。"}
            </p>
          </div>
          <Sticker name={entitlements.isPro ? "mood-proud" : "mood-heart"} size={92} className="-mr-2 shrink-0" />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.label}
              className={`rounded-2xl border p-3 ${
                row.live ? "border-white/12 bg-[#81D8CF]/10" : "border-white/10 bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2">
                {row.live
                  ? <CheckCircle2 size={16} className="shrink-0 text-[#81D8CF]" />
                  : <Clock3 size={16} className="shrink-0 text-white/40" />}
                <p className={`text-sm font-bold ${row.live ? "text-white" : "text-white/70"}`}>{row.label}</p>
                {!row.live && (
                  <span className="ml-auto shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-bold text-white/45">
                    开发中
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-5 text-white/50">{row.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
        {giftOnly ? (
          <div className="border-b border-white/10 p-4">
            {entitlements.isPro ? (
              <p className="text-sm font-bold text-white">{entitlements.productId === "shushugo_pro_launch_gift" ? "首月会员已领取" : "会员权益已启用"} · {entitlementExpiryLabel(entitlements)}</p>
            ) : gift?.open ? (
              <>
                <button className="ds-btn w-full" onClick={() => void claimGift()} disabled={claiming}>
                  {claiming ? "领取中…" : isAuthenticated ? "领取首月会员" : "登录领取首月会员"}
                </button>
                <p className="mt-2 text-center text-xs text-white/55">免费领取，无需绑定支付方式。</p>
              </>
            ) : (
              <p className="text-sm font-bold text-white">{gift?.open === false ? "首月赠送活动已结束" : giftLoading ? "正在查询首月赠送活动…" : "暂时无法查询首月赠送活动，请稍后重试。"}</p>
            )}
          </div>
        ) : <button
          onClick={onOpenPaywall}
          className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
            <Sparkles size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white">{entitlements.isPro ? "查看 Pro 方案" : "选择 Pro 方案"}</span>
            <span className="mt-0.5 block text-xs text-white/50">{isWechatMini ? "微信支付尚未开放时不会显示购买入口" : "月度、年度或永久买断"}</span>
          </span>
          <ChevronRight size={17} className="text-white/40" />
        </button>}

        {!isWechatMini && <button
          onClick={restore}
          disabled={restoring}
          className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151] disabled:opacity-60"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#3b3f3f] text-white/76">
            <RotateCcw size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white">{restoring ? "正在恢复" : "恢复购买"}</span>
            <span className="mt-0.5 block text-xs text-white/50">换机或重装后从 App Store 恢复权益</span>
          </span>
          <ChevronRight size={17} className="text-white/40" />
        </button>}

        {!isWechatMini && <button
          onClick={async () => setMessage((await redeemOfferCode()).message)}
          className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#3b3f3f] text-white/76">
            <Ticket size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white">兑换码</span>
            <span className="mt-0.5 block text-xs text-white/50">在 App Store 兑换页输入活动或赠送的兑换码</span>
          </span>
          <ChevronRight size={17} className="text-white/40" />
        </button>}

        <button
          onClick={onOpenPrivacy}
          className="focus-ring flex w-full items-center gap-3 p-4 text-left hover:bg-[#4d5151]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#3b3f3f] text-white/76">
            <ShieldCheck size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white">{giftOnly ? "隐私政策" : "隐私政策和购买说明"}</span>
            <span className="mt-0.5 block text-xs text-white/50">{giftOnly ? "数据收集与账号权益说明" : "数据收集、订阅与退款说明"}</span>
          </span>
          <ChevronRight size={17} className="text-white/40" />
        </button>
      </div>

      <MascotSay sticker="scene-laptop" size={52} className="ds-say-onbg mt-4">{message}</MascotSay>

      {!isWechatMini && <div className="mt-4 rounded-2xl border border-white/12 bg-[#464949] p-3 text-xs leading-6 text-white/50">
        <p>
          月度 / 年度 Pro 为自动续订订阅：除非在当前订阅期结束前至少 24 小时关闭自动续订，
          订阅会自动续订并从 Apple 账户扣费。可随时在系统「设置 → Apple 账户 → 订阅」中管理或取消。
          永久 Pro 为一次性买断。购买适用
          <a
            href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
            target="_blank"
            rel="noreferrer"
            className="focus-ring mx-1 font-bold text-[#81D8CF] underline underline-offset-2"
          >
            Apple 标准 EULA
          </a>
          条款。
        </p>
      </div>}
    </div>
  );
}
