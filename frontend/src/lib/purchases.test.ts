import { describe, expect, it } from "vitest";

// purchases.ts 间接依赖 entitlements(localStorage)与 window 事件,
// 在纯 Node 环境里先挂最小桩再导入。
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
  removeEventListener: () => undefined,
  CdvPurchase: undefined
};

const { transactionExpiry } = await import("./purchases");

describe("transactionExpiry", () => {
  it("reads the expiry of the matching product from the verified collection", () => {
    const expiry = Date.UTC(2026, 7, 6);
    const receipt = {
      collection: [
        { id: "master_pro_monthly", expiryDate: expiry },
        { id: "master_pro_yearly", expiryDate: expiry + 1000 }
      ]
    };
    expect(transactionExpiry(receipt, "master_pro_yearly")).toBe(new Date(expiry + 1000).toISOString());
  });

  it("falls back to the first entry when no product matches", () => {
    const expiry = Date.UTC(2026, 0, 1);
    const receipt = { transactions: [{ productId: "something_else", expiryDate: expiry }] };
    expect(transactionExpiry(receipt, "master_pro_monthly")).toBe(new Date(expiry).toISOString());
  });

  it("parses string and Date expiry values", () => {
    const iso = "2026-09-01T00:00:00.000Z";
    expect(transactionExpiry({ collection: [{ id: "master_pro_monthly", expiryDate: iso }] }, "master_pro_monthly")).toBe(iso);
    expect(
      transactionExpiry({ collection: [{ id: "master_pro_monthly", expiryDate: new Date(iso) }] }, "master_pro_monthly")
    ).toBe(iso);
  });

  it("returns undefined when the receipt has no usable expiry", () => {
    expect(transactionExpiry({}, "master_pro_monthly")).toBeUndefined();
    expect(transactionExpiry({ collection: [{ id: "master_pro_monthly", expiryDate: "garbage" }] }, "master_pro_monthly")).toBeUndefined();
    expect(transactionExpiry(null, "master_pro_monthly")).toBeUndefined();
  });
});
