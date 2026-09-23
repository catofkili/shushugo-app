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

async function claimLevelPlanTrial() {
  const headers = authHeaders();
  if (!headers.authorization || !config.syncUrl) return cachedEntitlement();
  const base = config.syncUrl.replace(/\/$/, '');
  const api = /\/api$/i.test(base) ? base : `${base}/api`;
  const payload = await requestJson(`${api}/entitlements/trial`, { method: 'POST', header: headers });
  const normalized = normalizeEntitlement(payload);
  core.setState(getDatabase(), KEY, JSON.stringify(normalized));
  await saveDatabase();
  return normalized;
}

function notifyTrialExpiry() {
  const access = cachedEntitlement();
  if (access.active || access.source !== 'trial' || !access.expiresAt || Date.parse(access.expiresAt) > Date.now()) return false;
  const db = getDatabase();
  if (core.getState(db, 'level_trial_expiry_noticed', '') === access.expiresAt) return false;
  core.setState(db, 'level_trial_expiry_noticed', access.expiresAt);
  core.web.studyMode.saveStudyMode('classic');
  void saveDatabase();
  wx.showModal({ title: '7 天试用已结束', content: '现在计划会继续安排单词。开通 Pro 后，语法、汉字和辨析会按原计划恢复。', showCancel: false });
  return true;
}

module.exports = { cachedEntitlement, fetchEntitlement, claimLevelPlanTrial, notifyTrialExpiry };
