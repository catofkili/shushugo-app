// frontend/src/lib/entitlements.ts → 小程序的权益缓存（Worker 下发、存 app_state）。
// 网页那份把权益放 localStorage，小程序的真相在 runtime/entitlements.js。
const cached = () => {
  try { return require('../runtime/entitlements').cachedEntitlement(); } catch { return { active: false, plan: 'free', expiresAt: null, source: 'local-default' }; }
};
const state = () => {
  const value = cached();
  return { isPro: Boolean(value.active), productId: value.plan, source: value.source, expiresAt: value.expiresAt, updatedAt: value.fetchedAt || null };
};
// ⚠️ 网页那份的 saveEntitlements / grantPro / clearEntitlements 是「写 localStorage 再广播」，
// 云端下发的权益（登录、领首月赠送、启动时对账、购买）全是靠它落地的。这里以前把它们都写成 `state`
// —— 只读、忽略入参、也不广播：服务器返回 isPro:true，本地什么都没存，界面永远是免费版
// （2026-09-30 真机：点「领取首月会员」服务器 200 且 isPro:true，本地读回 free/local-default）。
// 现在存进 app_state 的 entitlement_cache（小程序真相所在），并通知 subscribeEntitlements 的订阅者。
const listeners = new Set();
const save = (patch) => {
  const next = { ...state(), ...patch };
  try {
    require('../runtime/entitlements').storeEntitlement({
      isPro: Boolean(next.isPro), plan: next.productId, source: next.source, expiresAt: next.expiresAt
    });
  } catch (error) { console.warn('[entitlements] 权益没存下来', error); }
  const value = state();
  listeners.forEach((listener) => { try { listener(value); } catch (error) { console.warn('[entitlements] 订阅回调出错', error); } });
  return value;
};
// 和 frontend/src/lib/entitlements.ts 的 productLabel 同一张表；小程序的 plan 可能是微信道具 id（pro_monthly），
// 也可能是内部权益 id（shushugo_pro_monthly），两种都认。
const PRODUCT_LABELS = {
  pro_monthly: '月度 Pro', pro_quarterly: '季度 Pro', pro_yearly: '年度 Pro', pro_lifetime: '永久 Pro',
  pro_trial: '计划试用', pro_launch_gift: '首月赠送会员'
};
const productLabel = (productId) => PRODUCT_LABELS[String(productId || '').replace(/^shushugo_/, '')] || '免费版';
const entitlementExpiryLabel = ({ productId, expiresAt }) => {
  if (!expiresAt) return String(productId || '').replace(/^shushugo_/, '') === 'pro_lifetime' ? '长期有效' : '到期日待确认';
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime())
    ? '到期日待确认'
    : `到期日 ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

module.exports = {
  productLabel,
  entitlementExpiryLabel,
  // 开发者强制 Pro 只在网页 dev server 里有；小程序里恒为关。
  devForcePro: () => false,
  setDevForcePro: () => undefined,
  getEntitlements: state,
  canUseFeature: (_feature, entitlements = state()) => Boolean(entitlements.isPro),
  saveEntitlements: save,
  grantPro: (productId, source, expiresAt) => save({ isPro: true, productId, source, expiresAt }),
  clearEntitlements: () => save({ isPro: false, source: 'free', productId: undefined, expiresAt: null }),
  subscribeEntitlements: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }
};
