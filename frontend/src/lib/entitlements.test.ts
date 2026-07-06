import { beforeEach, describe, expect, it } from "vitest";
import {
  canUseFeature,
  clearEntitlements,
  getEntitlements,
  grantPro,
  productLabel,
  saveEntitlements
} from "./entitlements";

// 纯 Node 测试环境:给 entitlements 依赖的 localStorage / window 事件挂最小桩。
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
};

beforeEach(() => {
  store.clear();
});

describe("getEntitlements", () => {
  it("defaults to free", () => {
    const state = getEntitlements();
    expect(state.isPro).toBe(false);
    expect(state.source).toBe("free");
  });

  it("ignores corrupted storage", () => {
    store.set("mn-entitlements", "not json");
    expect(getEntitlements().isPro).toBe(false);
  });

  it("downgrades to free once the subscription expires", () => {
    grantPro("master_pro_monthly", "storekit", new Date(Date.now() - 60_000).toISOString());
    const state = getEntitlements();
    expect(state.isPro).toBe(false);
    expect(state.source).toBe("free");
  });

  it("keeps Pro active before the expiry date", () => {
    grantPro("master_pro_yearly", "storekit", new Date(Date.now() + 86_400_000).toISOString());
    const state = getEntitlements();
    expect(state.isPro).toBe(true);
    expect(state.productId).toBe("master_pro_yearly");
  });
});

describe("grantPro", () => {
  it("clears a stale expiry when switching to lifetime", () => {
    grantPro("master_pro_monthly", "storekit", new Date(Date.now() + 1000).toISOString());
    grantPro("master_pro_lifetime", "storekit");
    const state = getEntitlements();
    expect(state.isPro).toBe(true);
    expect(state.expiresAt).toBeUndefined();
  });
});

describe("clearEntitlements", () => {
  it("resets to free and drops product info", () => {
    grantPro("master_pro_yearly", "cloud");
    const state = clearEntitlements();
    expect(state.isPro).toBe(false);
    expect(state.productId).toBeUndefined();
    expect(state.expiresAt).toBeUndefined();
  });
});

describe("canUseFeature", () => {
  it("locks every feature for free users", () => {
    expect(canUseFeature("immersiveGrammar")).toBe(false);
    expect(canUseFeature("fullJlptPlan")).toBe(false);
  });

  it("unlocks features for Pro users", () => {
    grantPro("master_pro_lifetime", "storekit");
    expect(canUseFeature("immersiveGrammar")).toBe(true);
    expect(canUseFeature("advancedDashboard")).toBe(true);
  });
});

describe("saveEntitlements", () => {
  it("merges patches over the stored state", () => {
    saveEntitlements({ isPro: true, source: "cloud", productId: "master_pro_monthly" });
    const state = saveEntitlements({ source: "app_store" });
    expect(state.isPro).toBe(true);
    expect(state.source).toBe("app_store");
    expect(state.productId).toBe("master_pro_monthly");
  });
});

describe("productLabel", () => {
  it("maps product ids to labels", () => {
    expect(productLabel("master_pro_monthly")).toBe("月度 Pro");
    expect(productLabel("master_pro_yearly")).toBe("年度 Pro");
    expect(productLabel("master_pro_lifetime")).toBe("永久 Pro");
    expect(productLabel(undefined)).toBe("免费版");
  });
});
