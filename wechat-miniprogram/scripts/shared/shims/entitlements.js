// frontend/src/lib/entitlements.ts → 小程序的权益缓存（Worker 下发、存 app_state）。
// 网页那份把权益放 localStorage，小程序的真相在 runtime/entitlements.js。
const cached = () => {
  try { return require('../runtime/entitlements').cachedEntitlement(); } catch { return { active: false, plan: 'free', expiresAt: null, source: 'local-default' }; }
};
const state = () => {
  const value = cached();
  return { isPro: Boolean(value.active), productId: value.plan, source: value.source, expiresAt: value.expiresAt, updatedAt: value.fetchedAt || null };
};
// 和 frontend/src/lib/entitlements.ts 的 productLabel 同一张表；小程序的 plan 可能是微信道具 id（pro_monthly），
// 也可能是内部权益 id（shushugo_pro_monthly），两种都认。
const PRODUCT_LABELS = {
  pro_monthly: '月度 Pro', pro_quarterly: '季度 Pro', pro_yearly: '年度 Pro', pro_lifetime: '永久 Pro',
  pro_trial: '计划试用', pro_launch_gift: '首月赠送会员'
};
const productLabel = (productId) => PRODUCT_LABELS[String(productId || '').replace(/^shushugo_/, '')] || '免费版';

module.exports = {
  productLabel,
  // 开发者强制 Pro 只在网页 dev server 里有；小程序里恒为关。
  devForcePro: () => false,
  setDevForcePro: () => undefined,
  getEntitlements: state,
  canUseFeature: (_feature, entitlements = state()) => Boolean(entitlements.isPro),
  saveEntitlements: state,
  grantPro: state,
  clearEntitlements: state,
  subscribeEntitlements: () => () => {}
};
