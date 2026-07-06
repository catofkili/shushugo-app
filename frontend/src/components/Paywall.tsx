import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Crown, LockKeyhole, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { FeatureId, ProductId } from "../lib/entitlements";
import { developmentUnlock, getPurchaseRuntime, initializePurchases, purchaseProduct, restorePurchases, StoreProduct } from "../lib/purchases";
import { useEntitlements } from "../hooks/useEntitlements";

interface PaywallProps {
  feature?: FeatureId;
  onClose: () => void;
  onUnlocked?: () => void;
  onOpenPrivacy?: () => void;
}

// Apple 标准 EULA(App Store Connect 未配置自定义 EULA 时即适用此条款)
const APPLE_STANDARD_EULA_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

const featureCopy: Record<FeatureId, { title: string; body: string }> = {
  immersiveGrammar: {
    title: "沉浸式语法学习是 Pro 功能",
    body: "适合集中扫语法、快速推进等级和减少页面切换。"
  },
  advancedDashboard: {
    title: "学习总览高级统计是 Pro 功能",
    body: "用更完整的进度视图观察单词、语法和等级推进。"
  },
  unlimitedMistakes: {
    title: "高级专项训练是 Pro 功能",
    body: "之后可以继续接无限训练和专项强化。"
  },
  fullJlptPlan: {
    title: "完整 JLPT 规划是 Pro 功能",
    body: "把 N1-N5 的单词、语法和复习节奏作为一整套计划管理。"
  }
};

const benefits = [
  "高级学习总览和等级进度",
  "沉浸式语法学习",
  "完整 JLPT 学习规划入口",
  "高级专项训练能力",
  "后续 Pro 功能自动纳入"
];

export function Paywall({ feature, onClose, onUnlocked, onOpenPrivacy }: PaywallProps) {
  const entitlements = useEntitlements();
  const [products, setProducts] = useState<StoreProduct[]>(() => getPurchaseRuntime().products);
  const [status, setStatus] = useState(getPurchaseRuntime().message);
  const [busyProduct, setBusyProduct] = useState<ProductId | null>(null);
  const [restoring, setRestoring] = useState(false);
  const copy = feature ? featureCopy[feature] : {
    title: "升级 Master Pro",
    body: "解锁更完整的学习节奏、统计和训练入口。"
  };

  useEffect(() => {
    initializePurchases().then((runtime) => {
      setProducts(runtime.products);
      setStatus(runtime.message);
    });
  }, []);

  useEffect(() => {
    if (entitlements.isPro) onUnlocked?.();
  }, [entitlements.isPro, onUnlocked]);

  const buy = async (productId: ProductId) => {
    setBusyProduct(productId);
    const result = await purchaseProduct(productId);
    setStatus(result.message);
    setBusyProduct(null);
  };

  const restore = async () => {
    setRestoring(true);
    const result = await restorePurchases();
    setStatus(result.message);
    setRestoring(false);
  };

  const unlockForDevelopment = () => {
    const result = developmentUnlock();
    setStatus(result.message);
    if (result.ok) onUnlocked?.();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/50 px-3 pb-3 pt-10 backdrop-blur-sm sm:items-center sm:p-6">
      <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-[#3f4343] p-4 shadow-2xl sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <button onClick={onClose} className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/76 hover:bg-white/8">
            <ArrowLeft size={17} />
            返回
          </button>
          <span className="inline-flex items-center gap-1 rounded-sm border border-[#81D8CF]/30 bg-[#81D8CF]/15 px-2 py-1 text-xs font-bold text-[#81D8CF]">
            <Crown size={13} />
            Master Pro
          </span>
        </div>

        <div className="rounded-2xl border border-[#81D8CF]/25 bg-[#81D8CF]/14 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#81D8CF] text-[#343838]">
              <Sparkles size={22} />
            </span>
            <div>
              <h2 className="text-xl font-bold text-white">{copy.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">{copy.body}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {benefits.map((benefit) => (
              <div key={benefit} className="flex items-center gap-2 rounded-2xl border border-white/12 bg-[#81D8CF]/10 px-3 py-2">
                <CheckCircle2 size={16} className="shrink-0 text-[#81D8CF]" />
                <span className="text-sm font-semibold text-white/78">{benefit}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {products.map((product) => (
            <button
              key={product.id}
              onClick={() => buy(product.id)}
              disabled={busyProduct !== null || restoring}
              className={`focus-ring relative rounded-2xl border p-4 text-left transition ${
                product.recommended ? "border-[#81D8CF] bg-[#81D8CF]/12" : "border-white/15 bg-[#464949] hover:bg-[#4d5151]"
              } disabled:opacity-60`}
            >
              {product.recommended && (
                <span className="absolute right-3 top-3 rounded-sm bg-[#81D8CF] px-2 py-1 text-[11px] font-bold text-[#343838]">
                  推荐
                </span>
              )}
              <p className="pr-12 text-base font-bold text-white">{product.title}</p>
              <p className="mt-2 text-xs font-bold text-[#81D8CF]">{product.period}</p>
              <p className="mt-3 text-sm leading-6 text-white/58">{product.description}</p>
              <p className="mt-4 text-lg font-bold text-white">{busyProduct === product.id ? "处理中..." : product.price}</p>
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <p className="rounded-2xl border border-white/12 bg-[#81D8CF]/10 px-3 py-2 text-xs leading-6 text-white/58">
            {status}
          </p>
          <button
            onClick={restore}
            disabled={restoring || busyProduct !== null}
            className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/18 px-4 text-sm font-bold text-white/78 hover:bg-white/8 disabled:opacity-60"
          >
            <RotateCcw size={16} />
            {restoring ? "恢复中" : "恢复购买"}
          </button>
        </div>

        {import.meta.env.DEV && (
          <button
            onClick={unlockForDevelopment}
            className="focus-ring mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[#81D8CF]/35 bg-[#81D8CF]/10 px-4 py-3 text-sm font-bold text-[#81D8CF]"
          >
            <LockKeyhole size={16} />
            本地开发临时解锁 Pro
          </button>
        )}

        <div className="mt-4 space-y-2 rounded-2xl border border-white/12 bg-[#81D8CF]/10 p-3 text-xs leading-6 text-white/52">
          <div className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#81D8CF]" />
            <p>
              付款将通过你的 Apple 账户完成。月度 / 年度 Pro 为自动续订订阅：除非在当前订阅期结束前至少
              24 小时关闭自动续订，订阅会按相同价格和周期自动续订，费用在当期结束前 24
              小时内从 Apple 账户扣除。你可以随时在系统「设置 → Apple 账户 → 订阅」中管理或取消订阅。
              永久 Pro 为一次性买断，不会自动扣费。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6">
            {onOpenPrivacy && (
              <button onClick={onOpenPrivacy} className="focus-ring font-bold text-[#81D8CF] underline underline-offset-2">
                隐私政策
              </button>
            )}
            <a
              href={APPLE_STANDARD_EULA_URL}
              target="_blank"
              rel="noreferrer"
              className="focus-ring font-bold text-[#81D8CF] underline underline-offset-2"
            >
              服务条款（EULA）
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
