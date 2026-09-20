import { useEffect, useRef, useState } from "react";
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
  confusionGroups: {
    title: "疑难辨析是 Pro 功能",
    body: "1,881 组近义、同音、自他、汉字用法对照，卡上一键看，连线题练到分得清。"
  },
  kanjiReadingUsage: {
    title: "一字多音是 Pro 功能",
    body: "520 个多音字，什么时候读哪个音，判据说得清的机器说，说不清的人写。"
  },
  mixedStudy: {
    title: "混合学习是 Pro 功能",
    body: "单词、语法、单独汉字、疑难辨析进同一条队列，一个圆环定当天怎么分。"
  },
    title: "沉浸式语法学习是 Pro 功能",
    body: "适合集中扫语法、快速推进等级和减少页面切换。"
  },
  stubbornHistory: {
    title: "往日顽固词是 Pro 功能",
    body: "翻回过去任何一天，看那天跟你打过架的词，一键收藏或整批复习。"
  },
  // ⚠️ 下面三条现在**没有任何调用方**:只有 immersiveGrammar 走 requirePro()。
  // 留着是因为它们迟早要接上;真接上那天,先确认这句「是 Pro 功能」当时是真的。
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
  },
  weeklyReportCloudHistory: {
    title: "云端历史回顾是 Pro 功能",
    body: "在登录后的其他设备恢复已经保存的学习回顾；本机已有历史和最新回顾仍可免费阅读。"
  }
};

// 买之前看到的这几条必须和真实解锁的对得上。2026-09-20 起真正锁着的：疑难辨析（App.tsx 的
// proPages + 卡上的辨析入口）、一字多音（proPages）、混合学习（模式列表）、沉浸式语法
// （requirePro）、完成页的往日顽固词（FinishPanel 自己弹）。其余 FeatureId 定义了但没人问权益，
// 归到「后续纳入」那一条里。
const benefits = [
  "沉浸式语法学习",
  "疑难辨析：1,881 组近义 / 同音 / 自他对照",
  "一字多音：520 个多音字的读音判据",
  "混合学习：单词 · 语法 · 汉字 · 疑难一条队列",
  "往日顽固词：翻回任意一天，整批复习或收藏",
  "后续 Pro 功能自动纳入（高级总览、JLPT 规划、专项训练开发中）"
];

export function Paywall({ feature, onClose, onUnlocked, onOpenPrivacy }: PaywallProps) {
  const entitlements = useEntitlements();
  const dialogRef = useRef<HTMLElement>(null);
  const [products, setProducts] = useState<StoreProduct[]>(() => getPurchaseRuntime().products);
  const [status, setStatus] = useState(getPurchaseRuntime().message);
  const [busyProduct, setBusyProduct] = useState<ProductId | null>(null);
  const [restoring, setRestoring] = useState(false);
  const copy = feature ? featureCopy[feature] : {
    title: "升级收集日 Pro",
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

  // 模态语义:Esc 关闭、焦点进来、Tab 在卡片里循环、关掉之后还回原处。
  // ⚠️ 缺了这几样,键盘和 VoiceOver 用户会在背后那一页里乱走 —— 而背后那一页
  // 正是刚刚被拦下来的付费功能。用原生 <dialog> 能白捡这些,但它要 Safari 15.4,
  // 而工程的部署目标还写着 iOS 15.0(见 Podfile),所以这里自己做。
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea') ?? []
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      opener?.focus?.();
    };
  }, [onClose]);

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
    <div className="fixed inset-0 z-[10000] flex items-end justify-center overflow-y-auto bg-black/50 px-3 pb-3 pt-10 backdrop-blur-sm sm:items-center sm:p-6">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-[#3f4343] p-4 shadow-2xl sm:p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <button onClick={onClose} className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/76 hover:bg-white/8">
            <ArrowLeft size={17} />
            返回
          </button>
          <span className="inline-flex items-center gap-1 rounded-sm border border-[#81D8CF]/30 bg-[#81D8CF]/15 px-2 py-1 text-xs font-bold text-[#81D8CF]">
            <Crown size={13} />
            收集日 Pro
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
