import { refreshCloudEntitlements } from "./sync-api";
import type { ProductId } from "./entitlements";

declare const require: (path: string) => any;
const release = require("../../../taro-spike-2/src/platform/release-config.weapp.cjs");
const payment = require("../../../wechat-miniprogram/src/runtime/payment.js");

export interface StoreProduct {
  id: ProductId; title: string; description: string; price: string; period: string; recommended?: boolean;
}
export interface PurchaseResult { ok: boolean; message: string; }
export interface PurchaseRuntime { status: "idle" | "ready" | "unavailable" | "error"; message: string; products: StoreProduct[]; }
const products: StoreProduct[] = [
  { id: "shushugo_pro_yearly", title: "收集日 Pro 年度", description: "按年计费，权益相同。", price: "¥68", period: "按年订阅", recommended: true },
  { id: "shushugo_pro_monthly", title: "收集日 Pro 月度", description: "按月计费。", price: "¥10", period: "按月订阅" },
  { id: "shushugo_pro_lifetime", title: "收集日 Pro 永久", description: "一次购买。", price: "¥298", period: "一次购买" }
];
const prices: Partial<Record<ProductId, number>> = { shushugo_pro_monthly: 1000, shushugo_pro_yearly: 6800, shushugo_pro_lifetime: 29800 };
let runtime: PurchaseRuntime = { status: "unavailable", message: "微信支付未开放。", products: [] };

export const STORE_PRODUCTS = products;
export async function initializePurchases(): Promise<PurchaseRuntime> {
  runtime = release.release.purchase === true
    ? { status: "ready", message: "微信虚拟支付已开放。", products }
    : { status: "unavailable", message: "微信支付尚未开放。", products: [] };
  return runtime;
}
export function getPurchaseRuntime(): PurchaseRuntime { return runtime; }
export async function purchaseProduct(productId: ProductId): Promise<PurchaseResult> {
  if (release.release.purchase !== true) return { ok: false, message: "微信支付尚未开放。" };
  const price = prices[productId];
  if (!price) return { ok: false, message: "该商品暂不支持微信支付。" };
  try {
    const result = await payment.requestPayment(productId, price);
    if (!result.paid) return { ok: false, message: result.pending ? "支付结果待服务端确认，可稍后恢复订单。" : "支付未完成。" };
    await refreshCloudEntitlements();
    return { ok: true, message: "支付已由服务端验单，会员权益已更新。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "微信支付失败，请稍后重试。" };
  }
}
export async function restorePurchases(): Promise<PurchaseResult> {
  return { ok: false, message: release.release.purchase === true ? "微信订单只能由服务端按待验订单恢复。" : "微信支付尚未开放。" };
}
export async function retryPendingPurchaseVerifications(): Promise<void> {
  if (release.release.purchase !== true) return;
  const result = await payment.verifyPendingPayment();
  if (result?.paid) await refreshCloudEntitlements();
}
export async function redeemOfferCode(): Promise<PurchaseResult> { return { ok: false, message: "小程序不支持 Apple 优惠码。" }; }
