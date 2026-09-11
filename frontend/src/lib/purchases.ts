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
    id: "shushugo_pro_yearly",
    title: "收集日 Pro 年度",
    // 三个档位的区别只有计费方式,权益完全一样 —— 描述就该只说计费方式。
    // 原来这句在年度卡上单独列了一串「高级学习统计、完整训练规划」,那些现在都没上锁,
    // 而且写在这里还会让人以为年度比月度多给东西。
    description: "按年计费，权益与月度、永久相同。",
    price: "App Store 定价",
    period: "按年订阅",
    recommended: true
  },
  {
    id: "shushugo_pro_monthly",
    title: "收集日 Pro 月度",
    description: "适合短期冲刺，随时取消。",
    price: "App Store 定价",
    period: "按月订阅"
  },
  {
    id: "shushugo_pro_lifetime",
    title: "收集日 Pro 永久",
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
  if (productId === "shushugo_pro_lifetime") return purchase.ProductType.NON_CONSUMABLE;
  return purchase.ProductType.PAID_SUBSCRIPTION;
};

const platform = () => window.CdvPurchase?.Platform?.APPLE_APPSTORE;

/**
 * 从一份 VerifiedReceipt 里读出「买了哪个商品、哪笔交易、什么时候到期」。
 *
 * ⚠️ 收据有两种结构,少认一种就等于收了钱不发货:
 * - **配了 `store.validator`**:商品在 `receipt.collection`(VerifiedPurchase[]),
 *   到期时间是 `expiryDate`(毫秒时间戳)。
 * - **没配 validator(本应用当前就是这种)**:插件走 `validator.ts` 里
 *   `if (!this.controller.validator)` 那个「为了向后兼容,视为已验证」分支,
 *   于是 `collection` 是空的、**`receipt.id` 是首笔交易 ID 而不是商品 ID**,
 *   真正的商品在 `receipt.sourceReceipt.transactions[].products[].id`,
 *   到期时间在 `transaction.expirationDate`(Date)。
 *
 * 老代码优先把 `receipt.id` 当商品 ID,又去查一个不存在的顶层 `receipt.transactions`,
 * 于是合法收据进来后:授权 0 次、云校验 0 次、`finish()` 1 次 ——
 * 钱付了、交易被完成、用户什么都没拿到。
 */
export interface ReceiptPurchase {
  productId: ProductId;
  transactionId?: string;
  expiresAt?: string;
}

const KNOWN_PRODUCT_IDS = new Set<string>(STORE_PRODUCTS.map((product) => product.id));

const asIsoDate = (raw: unknown): string | undefined => {
  if (raw == null || raw === "") return undefined;
  const parsed = raw instanceof Date ? raw : new Date(typeof raw === "number" ? raw : String(raw));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const asId = (raw: unknown): string | undefined => {
  const value = raw == null ? "" : String(raw);
  return value || undefined;
};

export const receiptPurchases = (receipt: any): ReceiptPurchase[] => {
  const found = new Map<ProductId, ReceiptPurchase>();
  const put = (productId: unknown, transactionId: unknown, expiry: unknown) => {
    if (typeof productId !== "string" || !KNOWN_PRODUCT_IDS.has(productId)) return;
    const id = productId as ProductId;
    const current = found.get(id);
    found.set(id, {
      productId: id,
      transactionId: current?.transactionId ?? asId(transactionId),
      expiresAt: current?.expiresAt ?? asIsoDate(expiry)
    });
  };

  // validator 校验过的结果最权威,先放它;缺的字段再由本地收据补。
  const collection: any[] = Array.isArray(receipt?.collection) ? receipt.collection : [];
  for (const item of collection) put(item?.id, item?.transactionId ?? item?.purchaseId, item?.expiryDate);

  const transactions: any[] = Array.isArray(receipt?.sourceReceipt?.transactions)
    ? receipt.sourceReceipt.transactions
    : Array.isArray(receipt?.transactions) ? receipt.transactions : [];
  for (const transaction of transactions) {
    const products: any[] = Array.isArray(transaction?.products) ? transaction.products : [];
    for (const product of products) {
      put(product?.id, transaction?.transactionId ?? transaction?.purchaseId, transaction?.expirationDate);
    }
  }
  return [...found.values()];
};

/** 这份收据里某个商品的到期时间。 */
export const transactionExpiry = (receipt: any, productId: ProductId): string | undefined => (
  receiptPurchases(receipt).find((item) => item.productId === productId)?.expiresAt
  ?? asIsoDate(receipt?.expiryDate)
);

/**
 * 云端校验失败(离线、服务端故障、买的时候还没登录)不能把这笔交易丢掉:
 * 钱已经付了。排进队列,下次启动或登录后重试。
 */
const PENDING_KEY = "mn-pending-purchase-verifications";

const readPending = (): ReceiptPurchase[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item: any) => item && KNOWN_PRODUCT_IDS.has(item.productId) && item.transactionId)
      : [];
  } catch {
    return [];
  }
};

const writePending = (items: ReceiptPurchase[]): void => {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(items.slice(-20)));
  } catch {
    /* 存储被禁用时不值得让购买流程失败 */
  }
};

const rememberPending = (purchase: ReceiptPurchase): void => {
  writePending([...readPending().filter((item) => item.transactionId !== purchase.transactionId), purchase]);
};

const forgetPending = (transactionId?: string): void => {
  if (!transactionId) return;
  writePending(readPending().filter((item) => item.transactionId !== transactionId));
};

/**
 * 订阅收据没带到期时间时给的离线宽限期。
 *
 * ⚠️ 不能不给:`grantPro(id, source, undefined)` 的语义是「永不过期」,
 * 用在订阅上等于取消续订之后本地 Pro 永远留着。给一小段宽限期,
 * 下次联网时云端权益会覆盖它。
 */
const OFFLINE_SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

const applyReceiptPurchase = async (purchase: ReceiptPurchase): Promise<void> => {
  const isLifetime = purchase.productId === "shushugo_pro_lifetime";
  if (purchase.transactionId) {
    try {
      // 云端是权威:校验通过时 applyCloudEntitlements 已经把权益写好了。
      if (await verifyCloudPurchase(purchase.productId, purchase.transactionId)) {
        forgetPending(purchase.transactionId);
        return;
      }
      rememberPending(purchase); // 还没登录:先本地放行,登录后补校验
    } catch {
      rememberPending(purchase);
    }
  }
  const expiresAt = isLifetime
    ? undefined
    : purchase.expiresAt ?? new Date(Date.now() + OFFLINE_SUBSCRIPTION_GRACE_MS).toISOString();
  grantPro(purchase.productId, "storekit", expiresAt);
};

/**
 * 发货成功后才结束交易。VerifiedReceipt 回调本身不等待 Promise，所以这个函数
 * 必须把“识别商品 → 落权 → finish”串成一个可测试的 Promise；任一步失败都让
 * StoreKit 保留交易，等待下次启动重新投递。
 */
export async function fulfillVerifiedReceipt(receipt: any): Promise<void> {
  const purchases = receiptPurchases(receipt);
  if (purchases.length === 0) {
    throw new Error("已验证的 App Store 收据里没有可识别的收集日商品，交易暂不结束。");
  }
  for (const item of purchases) await applyReceiptPurchase(item);
  await receipt.finish();
}

/** 启动和登录成功后各调一次。云端仍然不通就原样留在队列里。 */
export async function retryPendingPurchaseVerifications(): Promise<void> {
  for (const purchase of readPending()) {
    try {
      if (await verifyCloudPurchase(purchase.productId, purchase.transactionId!)) forgetPending(purchase.transactionId);
    } catch {
      return; // 一笔失败说明云端整体不通,不用把剩下的挨个撞一遍
    }
  }
}

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
        void fulfillVerifiedReceipt(receipt).catch((error) => {
          const message = error instanceof Error ? error.message : "App Store 权益写入失败，交易暂未结束。";
          runtime = { ...runtime, status: "error", message };
          console.error("[purchases] verified receipt was not finished", error);
        });
      });

      initialized = true;
    }

    await store.initialize([platform()]);
    await store.update();
    await retryPendingPurchaseVerifications();

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

export function developmentUnlock(productId: ProductId = "shushugo_pro_yearly"): PurchaseResult {
  if (!import.meta.env.DEV) {
    return { ok: false, message: "开发解锁只在本地开发环境可用。" };
  }
  grantPro(productId, "development");
  return { ok: true, message: "已在本地开发环境临时解锁 Pro。" };
}
