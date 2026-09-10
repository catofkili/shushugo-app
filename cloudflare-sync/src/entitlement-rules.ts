/**
 * 「这行权益有多强」—— 决定一笔新验证通过的交易能不能覆盖账号当前的权益。
 *
 * ⚠️ 老代码是任意一笔验证通过的交易直接覆盖那一行，于是**恢复历史订单**或者
 * 响应到达顺序一变，一笔早就过期的月度订阅就能把永久 Pro 降级成 isPro=false。
 * 不需要伪造订单就能触发。
 *
 * 单独一个文件是为了能被 scripts/entitlement-rules.test.mjs 直接 import
 * （index.ts 里有指向 frontend 的无扩展名导入，Node 直接跑不起来）。
 */
export const LIFETIME_PRODUCT_ID = "shushugo_pro_lifetime";

export const entitlementStrength = (row?: {
  is_pro?: number | null;
  product_id?: string | null;
  expires_at?: string | null;
} | null): number => {
  if (!row || !row.is_pro) return -1;
  // 永久购买没有到期时间；订阅缺了到期时间不能顺手解释成永久 ——
  // 那正是「取消续订之后 Pro 永不过期」的来源，所以它是最弱的一档。
  if (row.product_id === LIFETIME_PRODUCT_ID && !row.expires_at) return Number.MAX_SAFE_INTEGER;
  return row.expires_at ? Date.parse(row.expires_at) : 0;
};
