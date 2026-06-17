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
  UserRound
} from "lucide-react";
import { DevTools } from "../components/DevTools";
import { EntitlementState, productLabel } from "../lib/entitlements";
import { Page } from "../types/app";

interface ProfilePageProps {
  entitlements: EntitlementState;
  onNavigate: (page: Page) => void;
  onNotice: (message: string, timeout?: number) => void;
}

const profileSections = [
  {
    title: "账号",
    items: [
      { label: "账号和安全", detail: "登录、密码与设备", icon: Shield, page: "account" as Page },
      { label: "Master Pro", detail: "会员权益、恢复购买", icon: Crown, page: "pro" as Page },
      { label: "个人信息", detail: "头像、昵称、学习身份", icon: UserRound, page: "personal-info" as Page },
      { label: "通知提醒", detail: "学习提醒和复习通知", icon: Bell, page: "notifications" as Page }
    ]
  },
  {
    title: "设置",
    items: [
      { label: "设置", detail: "显示、声音和学习偏好", icon: Settings, page: "settings" as Page },
      { label: "隐私", detail: "本地数据与同步权限", icon: LockKeyhole, page: "privacy" as Page },
      { label: "关于和帮助", detail: "版本、反馈与常见问题", icon: CircleHelp, page: "help" as Page },
      { label: "关于 Master Nihongo", detail: "内容来源和应用信息", icon: Info, page: "about" as Page }
    ]
  }
];

export function ProfilePage({ entitlements, onNavigate, onNotice }: ProfilePageProps) {
  return (
    <section className="mx-auto max-w-3xl pb-4">
      <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-white/20 bg-[#81D8CF] text-[#343838]">
            <UserRound size={34} />
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold text-white">Master 用户</p>
            <p className="mt-1 text-sm text-white/58">ID: local-nihongo-0001</p>
            <p className="mt-2 inline-flex rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/62">
              {entitlements.isPro ? productLabel(entitlements.productId) : "本地学习模式"}
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={() => onNavigate("pro")}
        className="focus-ring mt-4 flex w-full items-center gap-3 rounded-2xl border border-[#81D8CF]/25 bg-[#81D8CF]/12 p-4 text-left hover:bg-[#81D8CF]/18"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#81D8CF] text-[#343838]">
          <Crown size={23} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-white">{entitlements.isPro ? "Master Pro 已启用" : "升级 Master Pro"}</span>
          <span className="mt-0.5 block text-xs text-white/56">
            {entitlements.isPro ? "管理权益、恢复购买和购买说明" : "解锁高级统计、沉浸学习和完整规划"}
          </span>
        </span>
        <ChevronRight size={18} className="text-white/45" />
      </button>

      <DevTools onNotice={onNotice} />

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

      <button className="focus-ring mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#81D8CF]/25 bg-[#81D8CF]/20 px-4 py-3 text-sm font-bold text-[#81D8CF]">
        <LogOut size={18} />
        登出账号
      </button>
    </section>
  );
}
