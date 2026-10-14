import {
  Bell,
  ChevronRight,
  CircleHelp,
  Crown,
  Info,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Settings,
  Shield,
  Trophy,
  UserRound
} from "lucide-react";
import { entitlementExpiryLabel, EntitlementState, productLabel } from "../lib/entitlements";
import { cloudLogout, refreshLaunchGiftAvailability, type CloudSession } from "../lib/sync-api";
import { isLaunchGiftOnlyRelease } from "../lib/purchases";
import { loadUserProfile, type UserProfile } from "../lib/userProfile";
import { Page } from "../types/app";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { seenWordCount } from "../lib/progress-api";
import { ACHIEVEMENT_TOTAL } from "../lib/achievements/count";
import { studyTotals } from "../lib/study-totals";
import { yuzuBalance } from "../lib/yuzu";
import { Sticker } from "../components/CapybaraMascot";
import { CrossPlatformImage } from "../components/CrossPlatformImage";

// 「我的」页以前只是一张设置列表，没有「我」。页头下面摆三个只有这里说的数：
// 连击和今天的量主页已经说了，这里说的是累计 —— 学过多少词、学了多少天、攒了多少柚子。
const readProfileStats = () => {
  try {
    return {
      words: seenWordCount(),
      days: studyTotals().days,
      yuzu: yuzuBalance()
    };
  } catch {
    return null; // 库还没就位时整行不画，不摆 0 出来误导
  }
};

interface ProfilePageProps {
  entitlements: EntitlementState;
  cloudSession: CloudSession;
  onNavigate: (page: Page) => void;
  onRequireAuth: () => void;
  onNotice: (message: string, timeout?: number) => void;
  onFeedback: () => void;
}

const profileSections = [
  {
    title: "账号",
    items: [
      { label: "账号和安全", icon: Shield, page: "account" as Page },
      { label: "个人信息", icon: UserRound, page: "personal-info" as Page },
      { label: "成就", detail: `共 ${ACHIEVEMENT_TOTAL} 个`, icon: Trophy, page: "achievements" as Page },
      { label: "通知提醒", icon: Bell, page: "notifications" as Page }
    ]
  },
  {
    title: "设置",
    items: [
      { label: "提意见 / 报问题", icon: MessageCircle, action: "feedback" as const },
      { label: "设置", icon: Settings, page: "settings" as Page },
      { label: "隐私", icon: LockKeyhole, page: "privacy" as Page },
      { label: "帮助和支持", icon: CircleHelp, page: "help" as Page },
      { label: "关于收集日", icon: Info, page: "about" as Page }
    ]
  }
];

const staggerStyle = (index: number) => ({ "--i": index < 8 ? index : 0 }) as CSSProperties;

export function ProfilePage({ entitlements, cloudSession, onNavigate, onRequireAuth, onNotice, onFeedback }: ProfilePageProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [giftOpen, setGiftOpen] = useState<boolean | undefined>(entitlements.launchGift?.open);
  const giftOnly = isLaunchGiftOnlyRelease();

  useEffect(() => {
    let alive = true;
    void loadUserProfile().then((value) => {
      if (alive) setProfile(value);
    });
    return () => { alive = false; };
  }, [cloudSession.displayName]);

  useEffect(() => {
    if (!giftOnly) return;
    void refreshLaunchGiftAvailability().then((gift) => setGiftOpen(gift?.open)).catch(() => setGiftOpen(undefined));
  }, [giftOnly]);

  const stats = useMemo(() => readProfileStats(), []);
  const giftStatus = entitlements.isPro
    ? entitlementExpiryLabel(entitlements)
    : giftOpen
    ? cloudSession.token ? "领取首月会员" : "登录领取首月会员"
    : giftOpen === false ? "赠送窗口已关闭" : "查看首月赠送状态";

  const logout = async () => {
    await cloudLogout();
    onNotice("已退出。本机的学习记录还在。", 2600);
  };

  return (
    <section className="mx-auto max-w-3xl pb-4">
      <div className="ds-card ds-stagger p-4">
        <div className="flex items-center gap-4" style={staggerStyle(0)}>
          {profile?.avatar ? (
            <CrossPlatformImage src={profile.avatar} alt="账号头像" className="h-16 w-16 shrink-0 rounded-full border border-white/20 object-cover" weappWidth={64} weappHeight={64} />
          ) : !cloudSession.token ? (
            // 没登录时是吉祥物在招手，不是一个灰色的「空用户」剪影
            <div className="profile-avatar-placeholder grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-white/20 bg-[#81D8CF]/12">
              <Sticker name="mood-wave" size={46} />
            </div>
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-white/20 bg-[#91C968] text-[#243019]">
              <UserRound size={34} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold text-white">
              {cloudSession.token ? profile?.nickname || cloudSession.displayName || "收集日用户" : "尚未登录"}
            </p>
            <p className="mt-1 truncate text-sm text-white/58">
              {cloudSession.token ? cloudSession.email : "登录后多设备同步"}
            </p>
            {/* 没登录时上面一行已经说了「登录后多设备同步」，不再挂标签（原来是「离线学习可用」，关于页也已去掉离线的说法） */}
            {(entitlements.isPro || cloudSession.token) && <p className="mt-2 inline-flex rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/62">
              {entitlements.isPro ? productLabel(entitlements.productId) : "免费账号"}
            </p>}
          </div>
          {/* 登录 / 退出是同一个位置：退出只放页面最底下时，手机上要翻到底、还可能被底栏压住，用户会以为没有退出 */}
          {cloudSession.token ? (
            <button onClick={() => void logout()} className="focus-ring shrink-0 rounded-2xl border border-white/20 px-4 py-2 text-sm font-bold text-white/80">
              退出
            </button>
          ) : (
            <button onClick={onRequireAuth} className="focus-ring shrink-0 rounded-2xl bg-[#91C968] px-4 py-2 text-sm font-bold text-[#172112]">
              登录
            </button>
          )}
        </div>
      {stats && (
        <div className="w7-profile-stats mt-4 grid grid-cols-3 pt-4" style={staggerStyle(1)}>
          {[
            { value: stats.words.toLocaleString(), label: "学过的词" },
            { value: stats.days.toLocaleString(), label: "学习天数" },
            { value: stats.yuzu.toLocaleString(), label: "柚子" }
          ].map((item) => (
            <div key={item.label} className="px-2 text-center">
              <p className="ds-num text-2xl font-bold leading-none text-white">{item.value}</p>
              <p className="mt-1.5 text-xs text-white/55">{item.label}</p>
            </div>
          ))}
        </div>
      )}
      </div>

      <button
        onClick={() => giftOnly && !entitlements.isPro && giftOpen && !cloudSession.token ? onRequireAuth() : onNavigate("pro")}
        className="ds-card ds-stagger focus-ring mt-3 flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Crown size={20} className="shrink-0 text-[var(--ds-warn-ink)]" style={staggerStyle(0)} />
        <span className="min-w-0 flex-1" style={staggerStyle(1)}>
          <span className="block text-[15px] font-bold text-white">{giftOnly ? entitlements.isPro ? "首月会员已启用" : giftOpen === false ? "首月赠送活动已结束" : "首月赠送会员" : entitlements.isPro ? "收集日 Pro 已启用" : "升级收集日 Pro"}</span>
          {giftOnly && giftOpen && !entitlements.isPro && <span className="mt-1 block text-xs text-white/50">免费领取，无需绑定支付方式。</span>}
        </span>
        {giftOnly && giftStatus && <span className="shrink-0 text-xs text-white/45" style={staggerStyle(2)}>{giftStatus}</span>}
        <ChevronRight size={18} className="text-white/45" style={staggerStyle(giftOnly && giftStatus ? 3 : 2)} />
      </button>

      <div className="mt-4 space-y-4 ds-stagger">
        {profileSections.map((section) => (
          <div key={section.title} style={staggerStyle(profileSections.indexOf(section))}>
            <p className="ds-section">{section.title}</p>
            <div className="ds-card w7-list ds-stagger overflow-hidden">
              {section.items.map((item, index) => {
                const Icon = item.icon;
                const isFeedback = "action" in item && item.action === "feedback";
                return (
                  <button
                    key={item.label}
                    onClick={() => isFeedback ? onFeedback() : item.page && onNavigate(item.page)}
                    className="w7-row focus-ring flex w-full items-center gap-3 px-4 py-3 text-left"
                    style={staggerStyle(index)}
                  >
                    <Icon size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
                    <span className="min-w-0 flex-1 text-[15px] font-bold text-white">{item.label}</span>
                    {"detail" in item && <span className="shrink-0 text-xs text-white/45">{item.detail}</span>}
                    <ChevronRight size={17} className="text-white/40" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {cloudSession.token && (
        <button onClick={() => void logout()} className="focus-ring mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#91C968]/25 bg-[#91C968]/15 px-4 py-3 text-sm font-bold text-[#B7E38D]">
          <LogOut size={18} />
          退出账号
        </button>
      )}
    </section>
  );
}
