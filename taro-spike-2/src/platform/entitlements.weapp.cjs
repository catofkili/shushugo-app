const { getState } = require('../../../frontend/src/lib/database/db-utils');
const { normalizeEntitlement } = require('../../../wechat-miniprogram/src/core/entitlements');

const KEY = 'entitlement_cache';

function cachedEntitlement() {
  const raw = getState(KEY, '');
  if (!raw) return normalizeEntitlement({ active: false, source: 'local-default' });
  try { return normalizeEntitlement(JSON.parse(raw)); }
  catch { return normalizeEntitlement({ active: false, source: 'cache-invalid' }); }
}

module.exports = { cachedEntitlement };
