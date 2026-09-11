import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sync-api", () => ({ verifyCloudPurchase: vi.fn(async () => false) }));

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

const { fulfillVerifiedReceipt, receiptPurchases, transactionExpiry } = await import("./purchases");

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
});

describe("transactionExpiry", () => {
  it("reads the expiry of the matching product from the verified collection", () => {
    const expiry = Date.UTC(2026, 7, 6);
    const receipt = {
      collection: [
        { id: "shushugo_pro_monthly", expiryDate: expiry },
        { id: "shushugo_pro_yearly", expiryDate: expiry + 1000 }
      ]
    };
    expect(transactionExpiry(receipt, "shushugo_pro_yearly")).toBe(new Date(expiry + 1000).toISOString());
  });

  // 以前这里「没匹配上就拿第一条」——那正是本次修的那一类 bug:
  // 把别的商品的到期时间当成本商品的。收据里没有这个商品就是没有。
  it("returns undefined when the receipt does not contain that product", () => {
    const expiry = Date.UTC(2026, 0, 1);
    const receipt = { transactions: [{ products: [{ id: "something_else" }], expirationDate: new Date(expiry) }] };
    expect(transactionExpiry(receipt, "shushugo_pro_monthly")).toBeUndefined();
  });

  it("parses string and Date expiry values", () => {
    const iso = "2026-09-01T00:00:00.000Z";
    expect(transactionExpiry({ collection: [{ id: "shushugo_pro_monthly", expiryDate: iso }] }, "shushugo_pro_monthly")).toBe(iso);
    expect(
      transactionExpiry({ collection: [{ id: "shushugo_pro_monthly", expiryDate: new Date(iso) }] }, "shushugo_pro_monthly")
    ).toBe(iso);
  });

  it("returns undefined when the receipt has no usable expiry", () => {
    expect(transactionExpiry({}, "shushugo_pro_monthly")).toBeUndefined();
    expect(transactionExpiry({ collection: [{ id: "shushugo_pro_monthly", expiryDate: "garbage" }] }, "shushugo_pro_monthly")).toBeUndefined();
    expect(transactionExpiry(null, "shushugo_pro_monthly")).toBeUndefined();
  });
});

// 这是收款不发货的那条路:没配 store.validator 时插件走「视为已验证」的兜底分支,
// collection 是空的、receipt.id 是**交易号不是商品号**,商品藏在
// sourceReceipt.transactions[].products[] 里。少认这一种就等于用户白付钱。
describe("receiptPurchases", () => {
  it("reads products from sourceReceipt when no validator is configured", () => {
    const expiry = new Date("2026-10-01T00:00:00.000Z");
    const receipt = {
      id: "2000000123456789",       // 首笔交易号,不是商品号
      collection: [],
      sourceReceipt: {
        transactions: [
          { transactionId: "2000000123456789", expirationDate: expiry, products: [{ id: "shushugo_pro_monthly" }] }
        ]
      }
    };
    expect(receiptPurchases(receipt)).toEqual([
      { productId: "shushugo_pro_monthly", transactionId: "2000000123456789", expiresAt: expiry.toISOString() }
    ]);
  });

  it("prefers the validator collection and fills gaps from the local receipt", () => {
    const expiry = Date.UTC(2026, 10, 1);
    const receipt = {
      collection: [{ id: "shushugo_pro_yearly", expiryDate: expiry }],
      sourceReceipt: {
        transactions: [{ transactionId: "2000000999", products: [{ id: "shushugo_pro_yearly" }] }]
      }
    };
    expect(receiptPurchases(receipt)).toEqual([
      { productId: "shushugo_pro_yearly", transactionId: "2000000999", expiresAt: new Date(expiry).toISOString() }
    ]);
  });

  it("ignores products that are not ours", () => {
    expect(receiptPurchases({ sourceReceipt: { transactions: [{ products: [{ id: "someone_else_pro" }] }] } })).toEqual([]);
    expect(receiptPurchases(null)).toEqual([]);
  });
});

describe("fulfillVerifiedReceipt", () => {
  it("does not finish a receipt without a supported product", async () => {
    const finish = vi.fn(async () => undefined);
    await expect(fulfillVerifiedReceipt({ collection: [], finish })).rejects.toThrow("没有可识别");
    expect(finish).not.toHaveBeenCalled();
  });

  it("persists the entitlement before awaiting finish", async () => {
    let finishSawEntitlement = false;
    const finish = vi.fn(async () => {
      finishSawEntitlement = store.has("mn-entitlements");
    });
    await fulfillVerifiedReceipt({
      collection: [{ id: "shushugo_pro_lifetime" }],
      finish
    });
    expect(finishSawEntitlement).toBe(true);
    expect(finish).toHaveBeenCalledOnce();
  });

  it("keeps the transaction unfinished when local entitlement persistence fails", async () => {
    const finish = vi.fn(async () => undefined);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("disk full"); });
    await expect(fulfillVerifiedReceipt({
      collection: [{ id: "shushugo_pro_lifetime" }],
      finish
    })).rejects.toThrow("disk full");
    expect(finish).not.toHaveBeenCalled();
  });
});
