import { useEffect, useRef, useState } from "react";
import { Crown, LockKeyhole, RotateCcw, X } from "lucide-react";
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
  immersiveGrammar: {
    title: "沉浸式语法学习是 Pro 功能",
    body: "适合集中扫语法、快速推进等级和减少页面切换。"
  },
  stubbornHistory: {
    title: "往日顽固词是 Pro 功能",
    body: "翻回任意一天的顽固词。"
  },
  // ⚠️ 下面三条现在**没有任何调用方**。留着是因为它们迟早要接上；
  // 真接上那天，先确认这句「是 Pro 功能」当时是真的。
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
    body: "N1-N5 一整套计划。"
  },
  weeklyReportCloudHistory: {
    title: "云端历史回顾是 Pro 功能",
    body: "其他设备恢复学习回顾。"
  }
};

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

  // 这是非模态小窗，不再困住 Tab：用户可以关、可以买，也可以直接继续用背后的页面。
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
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
    <div className="paywall-popover-host">
      <section
        ref={dialogRef}
        role="dialog"
        aria-label={copy.title}
        className="paywall-popover"
      >
        <div className="paywall-popover-head">
          <span>
            <Crown size={13} />
            收集日 Pro
          </span>
          <button type="button" onClick={onClose} aria-label="关闭会员提示"><X size={16} /></button>
        </div>

        <div className="paywall-popover-intro">
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>

        <div className="paywall-popover-products" aria-label="会员方案">
          {products.map((product) => (
            <button
              key={product.id}
              onClick={() => buy(product.id)}
              disabled={busyProduct !== null || restoring}
              className={product.recommended ? "is-recommended" : ""}
              aria-label={`${product.title}，${product.price}`}
            >
              <b>{product.title.replace("收集日 Pro ", "")}</b>
              <small>{busyProduct === product.id ? "处理中…" : product.price}</small>
            </button>
          ))}
        </div>

        <div className="paywall-popover-actions">
          <p title={status}>{status}</p>
          <button
            onClick={restore}
            disabled={restoring || busyProduct !== null}
            title="恢复购买"
          >
            <RotateCcw size={13} />{restoring ? "恢复中" : "恢复"}
          </button>
          {import.meta.env.DEV && (
            <button onClick={unlockForDevelopment} title="本地开发临时解锁 Pro"><LockKeyhole size={13} />开发解锁</button>
          )}
        </div>

        <p className="paywall-popover-legal">
          月 / 年方案自动续订，除非在到期前至少 24 小时取消；续订费将在到期前 24 小时内扣除。永久版一次买断。
          {onOpenPrivacy && <button onClick={onOpenPrivacy}>隐私</button>}
          <a href={APPLE_STANDARD_EULA_URL} target="_blank" rel="noreferrer">EULA</a>
        </p>
      </section>
    </div>
  );
}
