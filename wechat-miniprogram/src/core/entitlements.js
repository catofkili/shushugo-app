const ENTITLEMENT_VERSION = 'entitlement-v1';

function normalizeEntitlement(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const expiresAt = source.expiresAt || source.expires_at || null;
  // Worker 使用 iOS 现有的 isPro 字段，小程序本地缓存也接受更直观的
  // active/is_pro 写法，避免登录后把真实权益误判成免费版。
  const claimedActive = source.active === true || source.isPro === true || Number(source.is_pro) === 1;
  const active = claimedActive && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
  return {
    protocol: ENTITLEMENT_VERSION,
    active,
    plan: String(source.plan || source.productId || source.product_id || (active ? 'pro' : 'free')),
    expiresAt,
    source: String(source.source || 'server'),
    fetchedAt: new Date().toISOString()
  };
}

function canUse(feature, entitlement) {
  if (feature === 'offline-study' || feature === 'library-search') return true;
  return Boolean(entitlement?.active);
}

module.exports = { ENTITLEMENT_VERSION, normalizeEntitlement, canUse };
