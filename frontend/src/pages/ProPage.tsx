import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronRight, Crown, ReceiptText, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { EntitlementState, productLabel } from "../lib/entitlements";
import { initializePurchases, restorePurchases } from "../lib/purchases";

interface ProPageProps {
  entitlements: EntitlementState;
  onBack: () => void;
  onOpenPaywall: () => void;
  onOpenPrivacy: () => void;
}

const rows = [
  { label: "高级学习总览", detail: "整合单词、语法、错题和等级进度" },
  { label: "沉浸式语法学习", detail: "低干扰阅读卡片，适合集中推进" },
  { label: "完整 JLPT 规划", detail: "按 N1-N5 组织未来学习路线" },
  { label: "高级复习能力", detail: "为后续专项训练和 AI 讲解预留权益" }
];

export function ProPage({ entitlements, onBack, onOpenPaywall, onOpenPrivacy }: ProPageProps) {
  const [message, setMessage] = useState("正在准备 App Store 商品信息...");
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    initializePurchases().then((runtime) => setMessage(runtime.message));
  }, []);

  const restore = async () => {
    setRestoring(true);
    const result = await restorePurchases();
    setMessage(result.message);
    setRestoring(false);
  };

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button onClick={onBack} className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8">
          <ArrowLeft size={17} />
          返回
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">Master Pro</p>
      </div>

      <section className="rounded-2xl border border-[#81D8CF]/25 bg-[#81D8CF]/14 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#81D8CF] text-[#343838]">
            <Crown size={25} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#81D8CF]">Membership</p>
            <h1 className="mt-1 text-2xl font-bold text-white">{entitlements.isPro ? "Master Pro 已启用" : "升级 Master Pro"}</h1>
            <p className="mt-2 text-sm leading-6 text-white/66">
              {entitlements.isPro
                ? `${productLabel(entitlements.productId)} · ${entitlements.source === "development" ? "本地开发解锁" : "App Store 权益"}`
                : "当前为免费版。升级后可解锁高级统计、沉浸式学习和完整训练规划。"}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="rounded-2xl border border-white/12 bg-[#81D8CF]/10 p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-[#81D8CF]" />
                <p className="text-sm font-bold text-white">{row.label}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-white/50">{row.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
        <button
          onClick={onOpenPaywall}
          className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
            <Sparkles size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white">{entitlements.isPro ? "查看 Pro 方案" : "选择 Pro 方案"}</span>
            <span className="mt-0.5 block text-xs text-white/50">月度、年度或永久买断</span>
          </span>
          <ChevronRight size={17} className="text-white/40" />
        </button>

        <button
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
        </button>

        <button
          onClick={onOpenPrivacy}
          className="focus-ring flex w-full items-center gap-3 p-4 text-left hover:bg-[#4d5151]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#3b3f3f] text-white/76">
            <ShieldCheck size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white">隐私政策和购买说明</span>
            <span className="mt-0.5 block text-xs text-white/50">上架前会随商品信息继续补充</span>
          </span>
          <ChevronRight size={17} className="text-white/40" />
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-white/15 bg-[#81D8CF]/10 p-3 text-xs leading-6 text-white/56">
        <div className="mb-1 flex items-center gap-2 font-bold text-white/72">
          <ReceiptText size={15} />
          内购状态
        </div>
        {message}
      </div>
    </div>
  );
}
