const config = require('../config');
const { requestJson } = require('./wx-promise');
const { getDatabase, saveDatabase } = require('./database-store');
const core = require('../core/study-core');
const { normalizeEntitlement } = require('../core/entitlements');
const { authHeaders } = require('./auth');

const KEY = 'entitlement_cache';

function cachedEntitlement() {
  const raw = core.getState(getDatabase(), KEY, '');
  if (!raw) return normalizeEntitlement({ active: false, source: 'local-default' });
  try { return normalizeEntitlement(JSON.parse(raw)); } catch { return normalizeEntitlement({ active: false, source: 'cache-invalid' }); }
}

async function fetchEntitlement() {
  if (!config.entitlementUrl) return cachedEntitlement();
  const payload = await requestJson(config.entitlementUrl, { header: authHeaders() });
  const normalized = normalizeEntitlement(payload);
  core.setState(getDatabase(), KEY, JSON.stringify(normalized));
  await saveDatabase();
  return normalized;
}

module.exports = { cachedEntitlement, fetchEntitlement };
