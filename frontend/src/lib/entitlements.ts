export type ProductId = "shushugo_pro_monthly" | "shushugo_pro_yearly" | "shushugo_pro_lifetime";

export type EntitlementSource = "free" | "storekit" | "cloud" | "app_store" | "development";

export type FeatureId =
  | "immersiveGrammar"
  | "advancedDashboard"
  | "unlimitedMistakes"
  | "fullJlptPlan"
  | "stubbornHistory"
  | "weeklyReportCloudHistory";

export interface EntitlementState {
  isPro: boolean;
  source: EntitlementSource;
  productId?: ProductId;
  expiresAt?: string;
  updatedAt: string;
}

const KEY = "mn-entitlements";
/**
 * 本地 StoreKit 授权(没经过云端校验)的最长离线有效期。
 *
 * localStorage 是用户可改的,所以它从来就不是授权边界 —— 联网时云端权益
 * (source = "cloud" / "app_store")会覆盖它。这条闸门管的是另一件事:
 * 一台长期不联网的设备上,退款和取消续订永远传不进来。每次启动 StoreKit
 * 都会重新校验本地收据并刷新 updatedAt,所以正常使用碰不到这个上限。
 */
const STOREKIT_OFFLINE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const EVENT = "mn-entitlements-change";

const defaultEntitlements = (): EntitlementState => ({
  isPro: false,
  source: "free",
  updatedAt: new Date().toISOString()
});

const isEntitlementState = (value: unknown): value is EntitlementState => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EntitlementState>;
  return typeof item.isPro === "boolean" && typeof item.source === "string" && typeof item.updatedAt === "string";
};

export function getEntitlements(): EntitlementState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultEntitlements();
    const parsed = JSON.parse(raw);
    if (!isEntitlementState(parsed)) return defaultEntitlements();
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) {
      return saveEntitlements({ isPro: false, source: "free" });
    }
    if (parsed.isPro && parsed.source === "storekit"
      && Date.parse(parsed.updatedAt) + STOREKIT_OFFLINE_MAX_AGE_MS < Date.now()) {
      return saveEntitlements({ isPro: false, source: "free" });
    }
    return parsed;
  } catch {
    return defaultEntitlements();
  }
}

export function saveEntitlements(patch: Partial<EntitlementState>): EntitlementState {
  const current = (() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultEntitlements();
      const parsed = JSON.parse(raw);
      return isEntitlementState(parsed) ? parsed : defaultEntitlements();
    } catch {
      return defaultEntitlements();
    }
  })();
  const next: EntitlementState = {
    ...defaultEntitlements(),
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

export function grantPro(productId: ProductId, source: Exclude<EntitlementSource, "free">, expiresAt?: string): EntitlementState {
  return saveEntitlements({ isPro: true, productId, source, expiresAt });
}

export function clearEntitlements(): EntitlementState {
  return saveEntitlements({ isPro: false, source: "free", productId: undefined, expiresAt: undefined });
}

// 当前没有任何 FeatureId 是免费的,所以这里就是 isPro。真要放开某个功能时
// 再加白名单,别为了「以后可能有」先摆一个每次都新建的空数组。
export function canUseFeature(_feature: FeatureId, entitlements = getEntitlements()): boolean {
  return entitlements.isPro;
}

export function subscribeEntitlements(listener: (state: EntitlementState) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<EntitlementState>).detail;
    listener(detail ?? getEntitlements());
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export function productLabel(productId?: ProductId): string {
  if (productId === "shushugo_pro_monthly") return "月度 Pro";
  if (productId === "shushugo_pro_yearly") return "年度 Pro";
  if (productId === "shushugo_pro_lifetime") return "永久 Pro";
  return "免费版";
}
