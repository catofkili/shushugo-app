// frontend/src/lib/entitlements.ts → 小程序的权益缓存（Worker 下发、存 app_state）。
// 网页那份把权益放 localStorage，小程序的真相在 runtime/entitlements.js。
const cached = () => {
  try { return require('../runtime/entitlements').cachedEntitlement(); } catch { return { active: false, plan: 'free', expiresAt: null, source: 'local-default' }; }
};
const state = () => {
  const value = cached();
  return { isPro: Boolean(value.active), productId: value.plan, source: value.source, expiresAt: value.expiresAt, updatedAt: value.fetchedAt || null };
};
module.exports = {
  getEntitlements: state,
  canUseFeature: (_feature, entitlements = state()) => Boolean(entitlements.isPro),
  saveEntitlements: state,
  grantPro: state,
  clearEntitlements: state,
  subscribeEntitlements: () => () => {}
};
