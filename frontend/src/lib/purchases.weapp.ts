import { getCloudSession, refreshCloudEntitlements } from "./sync-api";
import type { ProductId } from "./entitlements";

declare const require: (path: string) => any;
const release = require("../../../taro-spike-2/src/platform/release-config.weapp.cjs");
const payment = require("../../../wechat-miniprogram/src/runtime/payment.js");

export interface StoreProduct {
  id: ProductId; title: string; description: string; price: string; period: string; recommended?: boolean;
}
export interface PurchaseResult { ok: boolean; message: string; needsAuth?: boolean; }
export interface PurchaseRuntime { status: "idle" | "ready" | "unavailable" | "error"; message: string; products: StoreProduct[]; }

// 微信虚拟支付卖的是期限卡：一次付款、到期即停，**不自动续费**（Worker wechat-pay.ts 的 PRODUCT_DURATION_MONTHS，
// 按北京时间自然月）。别写成「订阅」——那是 Apple 的自动续订，写在这里是在误导付费用户。
// 分价必须和 Worker 的 WECHAT_PAY_PRICES、虚拟支付后台的道具价三处一致；下单后 payment.js 还会拿服务端回的分价再核一次。
const products: StoreProduct[] = [
  { id: "shushugo_pro_monthly", title: "收集日 Pro 月卡", description: "1 个月，到期不自动续费。", price: "¥10", period: "1 个月" },
  { id: "shushugo_pro_quarterly", title: "收集日 Pro 季卡", description: "3 个月，到期不自动续费。", price: "¥24", period: "3 个月" },
  { id: "shushugo_pro_yearly", title: "收集日 Pro 年卡", description: "12 个月，到期不自动续费。", price: "¥68", period: "12 个月", recommended: true },
  { id: "shushugo_pro_lifetime", title: "收集日 Pro 永久版", description: "一次购买，长期有效。", price: "¥298", period: "一次购买" }
];
const prices: Partial<Record<ProductId, number>> = {
  shushugo_pro_monthly: 1000, shushugo_pro_quarterly: 2400, shushugo_pro_yearly: 6800, shushugo_pro_lifetime: 29800
};
let runtime: PurchaseRuntime = { status: "unavailable", message: "微信支付未开放。", products: [] };

// 服务端的 detail 本来就是给用户看的中文（「当前 Pro 仍有效；…」），wx-promise 在前面加的「接口请求失败（HTTP 409）：」不是。
const errorMessage = (error: unknown, fallback: string) => {
  const detail = (error as { data?: { detail?: unknown } } | null)?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (error instanceof Error && error.message === "PAYMENT_PRICE_CHANGED") return "价格有更新，请关掉重新打开购买页。";
  return error instanceof Error && error.message ? error.message : fallback;
};

const hasSession = async () => Boolean((await getCloudSession()).token);

export const STORE_PRODUCTS = products;
export const isLaunchGiftOnlyRelease = (): boolean => release.release.purchase === false;
export async function initializePurchases(): Promise<PurchaseRuntime> {
  runtime = release.release.purchase === true
    ? { status: "ready", message: "期限卡到期即停，不会自动续费。", products }
    : { status: "unavailable", message: "微信支付尚未开放。", products: [] };
  return runtime;
}
export function getPurchaseRuntime(): PurchaseRuntime { return runtime; }
export async function purchaseProduct(productId: ProductId): Promise<PurchaseResult> {
  if (release.release.purchase !== true) return { ok: false, message: "微信支付尚未开放。" };
  const price = prices[productId];
  if (!price) return { ok: false, message: "该商品暂不支持微信支付。" };
  // 下单要用这个账号的微信会话签名（Worker 的 wechat-session），没登录下单只会 401。
  if (!(await hasSession())) return { ok: false, needsAuth: true, message: "请先用微信登录，会员跟着账号走。" };
  try {
    const result = await payment.requestPayment(productId, price);
    if (result.paid) {
      await refreshCloudEntitlements();
      return { ok: true, message: "支付成功，会员已开通。" };
    }
    if (result.cancelled) return { ok: false, message: "已取消支付。" };
    return { ok: false, message: result.pending ? "付款结果还在确认，稍后点「恢复」刷新。" : "支付未完成。" };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "微信支付失败，请稍后重试。") };
  }
}
// 微信的会员权益在服务端、跟着账号走，「恢复」= 补查本机那张没确认的订单 + 重新拉一次账号权益。
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!(await hasSession())) return { ok: false, needsAuth: true, message: "请先用微信登录，会员跟着账号走。" };
  try {
    const pending = release.release.purchase === true ? await payment.verifyPendingPayment() : null;
    const state = await refreshCloudEntitlements();
    if (state?.isPro) return { ok: true, message: "已从账号恢复会员权益。" };
    return { ok: false, message: pending?.pending ? "上一笔付款还在确认，稍后再点「恢复」。" : "这个账号目前没有有效的会员。" };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "恢复失败，请稍后重试。") };
  }
}
export async function retryPendingPurchaseVerifications(): Promise<void> {
  if (release.release.purchase !== true) return;
  const result = await payment.verifyPendingPayment();
  if (result?.paid) await refreshCloudEntitlements();
}
export async function redeemOfferCode(): Promise<PurchaseResult> { return { ok: false, message: "小程序不支持 Apple 优惠码。" }; }
