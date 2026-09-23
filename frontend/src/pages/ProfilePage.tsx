import {
  Bell,
  ChevronRight,
  CircleHelp,
  Crown,
  Info,
  LockKeyhole,
  LogOut,
  Settings,
  Shield,
  Trophy,
  UserRound
} from "lucide-react";
import { DevTools } from "../components/DevTools";
import { EntitlementState, productLabel } from "../lib/entitlements";
import { cloudLogout, type CloudSession } from "../lib/sync-api";
import { loadUserProfile, type UserProfile } from "../lib/userProfile";
import { Page } from "../types/app";
import { useEffect, useMemo, useState } from "react";
import { firstValue } from "../lib/database/db-utils";
import { studyTotals } from "../lib/study-totals";
import { yuzuBalance } from "../lib/yuzu";
import { Sticker } from "../components/CapybaraMascot";

// 「我的」页以前只是一张设置列表，没有「我」。页头下面摆三个只有这里说的数：
// 连击和今天的量主页已经说了，这里说的是累计 —— 学过多少词、学了多少天、攒了多少柚子。
const readProfileStats = () => {
  try {
    return {
      words: firstValue<number>("SELECT COUNT(*) FROM progress WHERE seen_count > 0", [], 0) ?? 0,
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
}

const profileSections = [
  {
    title: "账号",
    items: [
      { label: "账号和安全", detail: "登录、密码与设备", icon: Shield, page: "account" as Page },
      // 「收集日 Pro」不在这张表里:上面那张会随已购状态换文案的横幅指的是同一个页面,
      // 同一屏里把同一个入口摆两遍,只会让人以为它们通向不同的地方。
      { label: "个人信息", detail: "头像、昵称、学习身份", icon: UserRound, page: "personal-info" as Page },
      { label: "成就", detail: "47 个成就，含隐藏成就", icon: Trophy, page: "achievements" as Page },
      { label: "通知提醒", detail: "学习提醒和复习通知", icon: Bell, page: "notifications" as Page }
    ]
  },
  {
    title: "设置",
    items: [
      { label: "设置", detail: "显示、声音和学习偏好", icon: Settings, page: "settings" as Page },
      { label: "隐私", detail: "本地数据与同步权限", icon: LockKeyhole, page: "privacy" as Page },
      { label: "帮助和支持", detail: "使用教程、反馈与常见问题", icon: CircleHelp, page: "help" as Page },
      { label: "关于收集日", detail: "内容来源和应用信息", icon: Info, page: "about" as Page }
    ]
  }
];

export function ProfilePage({ entitlements, cloudSession, onNavigate, onRequireAuth, onNotice }: ProfilePageProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let alive = true;
    void loadUserProfile().then((value) => {
      if (alive) setProfile(value);
    });
    return () => { alive = false; };
  }, [cloudSession.displayName]);

  const stats = useMemo(() => readProfileStats(), []);

  const logout = async () => {
    await cloudLogout();
    onNotice("已退出账号；本机学习数据仍可离线使用。", 2600);
  };

  return (
    <section className="mx-auto max-w-3xl pb-4">
      <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
        <div className="flex items-center gap-4">
          {profile?.avatar ? (
            <img src={profile.avatar} alt="账号头像" className="h-16 w-16 shrink-0 rounded-full border border-white/20 object-cover" />
          ) : !cloudSession.token ? (
            // 没登录时是吉祥物在招手，不是一个灰色的「空用户」剪影
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-white/20 bg-[#81D8CF]/12">
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
            <p className="mt-2 inline-flex rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/62">
              {entitlements.isPro ? productLabel(entitlements.productId) : cloudSession.token ? "免费账号" : "离线学习可用"}
            </p>
          </div>
          {!cloudSession.token && (
            <button onClick={onRequireAuth} className="focus-ring shrink-0 rounded-2xl bg-[#91C968] px-4 py-2 text-sm font-bold text-[#172112]">
              登录
            </button>
          )}
        </div>
      </div>

      {stats && (
        <div className="profile-stats mt-3 grid grid-cols-3 gap-2">
          {[
            { value: stats.words.toLocaleString(), label: "学过的词" },
            { value: stats.days.toLocaleString(), label: "学习天数" },
            { value: stats.yuzu.toLocaleString(), label: "柚子" }
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/15 bg-[#464949] px-3 py-3 text-center">
              <p className="text-2xl font-bold leading-none text-white">{item.value}</p>
              <p className="mt-1.5 text-xs text-white/55">{item.label}</p>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => onNavigate("pro")}
        className="focus-ring mt-4 flex w-full items-center gap-3 rounded-2xl border border-[#81D8CF]/25 bg-[#81D8CF]/12 p-4 text-left hover:bg-[#81D8CF]/18"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#81D8CF] text-[#343838]">
          <Crown size={23} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-white">{entitlements.isPro ? "收集日 Pro 已启用" : "升级收集日 Pro"}</span>
        </span>
        <ChevronRight size={18} className="text-white/45" />
      </button>

      <DevTools />

      <div className="mt-4 space-y-4">
        {profileSections.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">{section.title}</p>
            <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
              {section.items.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    onClick={() => onNavigate(item.page)}
                    className={`focus-ring flex w-full items-center gap-3 p-4 text-left hover:bg-[#4d5151] ${index > 0 ? "border-t border-white/10" : ""}`}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#3b3f3f] text-white/76">
                      <Icon size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-white">{item.label}</span>
                      <span className="mt-0.5 block text-xs text-white/50">{item.detail}</span>
                    </span>
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
