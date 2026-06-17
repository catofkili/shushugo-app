export type ProductId = "master_pro_monthly" | "master_pro_yearly" | "master_pro_lifetime";

export type EntitlementSource = "free" | "storekit" | "development";

export type FeatureId =
  | "immersiveGrammar"
  | "advancedDashboard"
  | "unlimitedMistakes"
  | "fullJlptPlan";

export interface EntitlementState {
  isPro: boolean;
  source: EntitlementSource;
  productId?: ProductId;
  expiresAt?: string;
  updatedAt: string;
}

const KEY = "mn-entitlements";
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

export function canUseFeature(feature: FeatureId, entitlements = getEntitlements()): boolean {
  const freeFeatures: FeatureId[] = [];
  return freeFeatures.includes(feature) || entitlements.isPro;
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
  if (productId === "master_pro_monthly") return "月度 Pro";
  if (productId === "master_pro_yearly") return "年度 Pro";
  if (productId === "master_pro_lifetime") return "永久 Pro";
  return "免费版";
}
