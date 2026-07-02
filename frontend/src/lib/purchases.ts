import { Capacitor } from "@capacitor/core";
import { grantPro, ProductId } from "./entitlements";
import { verifyCloudPurchase } from "./sync-api";

export interface StoreProduct {
  id: ProductId;
  title: string;
  description: string;
  price: string;
  period: string;
  recommended?: boolean;
}

export interface PurchaseResult {
  ok: boolean;
  message: string;
}

type StoreStatus = "idle" | "ready" | "unavailable" | "error";

interface PurchaseRuntime {
  status: StoreStatus;
  message: string;
  products: StoreProduct[];
}

declare global {
  interface Window {
    CdvPurchase?: any;
  }
}

export const STORE_PRODUCTS: StoreProduct[] = [
  {
    id: "master_pro_yearly",
    title: "Master Pro 年度",
    description: "解锁高级学习统计、沉浸式学习和完整训练规划。",
    price: "App Store 定价",
    period: "按年订阅",
    recommended: true
  },
  {
    id: "master_pro_monthly",
    title: "Master Pro 月度",
    description: "适合短期冲刺，按月获得全部 Pro 功能。",
    price: "App Store 定价",
    period: "按月订阅"
  },
  {
    id: "master_pro_lifetime",
    title: "Master Pro 永久",
    description: "一次购买，长期使用当前 Pro 功能。",
    price: "App Store 定价",
    period: "一次购买"
  }
];

let runtime: PurchaseRuntime = {
  status: "idle",
  message: "内购尚未初始化。",
  products: STORE_PRODUCTS
};
let initialized = false;

const isStoreAvailable = () => Capacitor.getPlatform() === "ios" && Boolean(window.CdvPurchase?.store);

const nativeTypeFor = (productId: ProductId) => {
  const purchase = window.CdvPurchase;
  if (!purchase?.ProductType) return undefined;
  if (productId === "master_pro_lifetime") return purchase.ProductType.NON_CONSUMABLE;
  return purchase.ProductType.PAID_SUBSCRIPTION;
};

const platform = () => window.CdvPurchase?.Platform?.APPLE_APPSTORE;

const transactionProductId = (receipt: any): ProductId | undefined => {
  const value = receipt?.id ?? receipt?.transactions?.[0]?.products?.[0]?.id ?? receipt?.transactions?.[0]?.productId;
  return STORE_PRODUCTS.some((product) => product.id === value) ? value as ProductId : undefined;
};

const transactionId = (receipt: any): string | undefined => {
  return String(
    receipt?.transactionId ??
    receipt?.id ??
    receipt?.transactions?.[0]?.transactionId ??
    receipt?.transactions?.[0]?.id ??
    ""
  ) || undefined;
};

export async function initializePurchases(): Promise<PurchaseRuntime> {
  if (!isStoreAvailable()) {
    runtime = {
      status: "unavailable",
      message: "当前环境没有可用的 App Store 内购服务。真机或 TestFlight 环境会自动尝试连接。",
      products: STORE_PRODUCTS
    };
    return runtime;
  }

  try {
    const purchase = window.CdvPurchase;
    const store = purchase.store;
    store.verbosity = purchase.LogLevel?.WARNING ?? store.verbosity;

    if (!initialized) {
      STORE_PRODUCTS.forEach((product) => {
        store.register({
          id: product.id,
          type: nativeTypeFor(product.id),
          platform: platform()
        });
      });

      store.when().approved((transaction: any) => transaction.verify());
      store.when().verified((receipt: any) => {
        const productId = transactionProductId(receipt);
        if (productId && STORE_PRODUCTS.some((product) => product.id === productId)) {
          grantPro(productId as ProductId, "storekit");
          const id = transactionId(receipt);
          if (id) {
            verifyCloudPurchase(productId, id).catch(() => undefined);
          }
        }
        receipt.finish();
      });

      initialized = true;
    }

    await store.initialize([platform()]);
    await store.update();

    runtime = {
      status: "ready",
      message: "App Store 内购已准备好。",
      products: STORE_PRODUCTS.map((fallback) => {
        const product = store.get(fallback.id, platform());
        const offer = product?.getOffer?.();
        return {
          ...fallback,
          title: product?.title ?? fallback.title,
          description: product?.description ?? fallback.description,
          price: offer?.pricingPhases?.[0]?.price ?? product?.pricing?.price ?? fallback.price
        };
      })
    };
    return runtime;
  } catch (error) {
    runtime = {
      status: "error",
      message: error instanceof Error ? error.message : "内购初始化失败。",
      products: STORE_PRODUCTS
    };
    return runtime;
  }
}

export function getPurchaseRuntime(): PurchaseRuntime {
  return runtime;
}

export async function purchaseProduct(productId: ProductId): Promise<PurchaseResult> {
  if (!isStoreAvailable()) {
    return {
      ok: false,
      message: "当前环境不能发起真实购买。请在真机沙盒或 TestFlight 中测试 Apple 内购。"
    };
  }

  try {
    const store = window.CdvPurchase.store;
    const product = store.get(productId, platform());
    const offer = product?.getOffer?.();
    if (!offer?.order) {
      return { ok: false, message: "App Store 商品尚未准备好，请确认 App Store Connect 已创建对应商品 ID。" };
    }
    const error = await offer.order();
    if (error) {
      return { ok: false, message: error.message ?? "购买未完成。" };
    }
    return { ok: true, message: "购买请求已提交，等待 App Store 确认。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "购买失败。" };
  }
}

export async function restorePurchases(): Promise<PurchaseResult> {
  if (!isStoreAvailable()) {
    return {
      ok: false,
      message: "当前环境不能恢复真实购买。请在真机沙盒或 TestFlight 中测试恢复购买。"
    };
  }

  try {
    await window.CdvPurchase.store.restorePurchases();
    return { ok: true, message: "已向 App Store 请求恢复购买。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "恢复购买失败。" };
  }
}

export function developmentUnlock(productId: ProductId = "master_pro_yearly"): PurchaseResult {
  if (!import.meta.env.DEV) {
    return { ok: false, message: "开发解锁只在本地开发环境可用。" };
  }
  grantPro(productId, "development");
  return { ok: true, message: "已在本地开发环境临时解锁 Pro。" };
}
