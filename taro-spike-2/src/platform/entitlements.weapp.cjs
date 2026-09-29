const { getState, setState, persistSoon } = require('../../../frontend/src/lib/database/db-utils');
const { normalizeEntitlement } = require('../../../wechat-miniprogram/src/core/entitlements');

const KEY = 'entitlement_cache';

function cachedEntitlement() {
  const raw = getState(KEY, '');
  if (!raw) return normalizeEntitlement({ active: false, source: 'local-default' });
  try { return normalizeEntitlement(JSON.parse(raw)); }
  catch { return normalizeEntitlement({ active: false, source: 'cache-invalid' }); }
}

/** 共享替身的 saveEntitlements 调它：云端下发的权益落进 app_state，界面才认得出会员。 */
function storeEntitlement(payload) {
  setState(KEY, JSON.stringify(normalizeEntitlement(payload)));
  persistSoon();
}

module.exports = { cachedEntitlement, storeEntitlement };
