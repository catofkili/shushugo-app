const config = require('../config');
const { requestJson } = require('./wx-promise');
const { getDatabase, saveDatabase } = require('./database-store');
const core = require('../core/study-core');

const TOKEN_KEY = 'auth_access_token';
const USER_KEY = 'auth_user_id';

function authHeaders() {
  const token = core.getState(getDatabase(), TOKEN_KEY, '');
  return token ? { authorization: `Bearer ${token}` } : {};
}

function authStatus() {
  return { signedIn: Boolean(core.getState(getDatabase(), TOKEN_KEY, '')), userId: core.getState(getDatabase(), USER_KEY, '') };
}

function authApiUrl(path) {
  if (!config.authUrl) throw new Error('没有配置 authUrl；登录接口必须由服务端提供');
  const authBase = config.authUrl.replace(/\/$/, '');
  const authApi = /\/api$/i.test(authBase) ? authBase : `${authBase}/api`;
  return `${authApi}${path}`;
}

async function wechatCode() {
  const login = await new Promise((resolve, reject) => {
    wx.login({ success: resolve, fail: reject });
  });
  if (!login?.code) throw new Error('微信登录没有返回 code');
  return login.code;
}

async function saveSession(response) {
  const accessToken = response?.access_token || response?.accessToken;
  const userId = response?.user_id || response?.userId;
  if (!accessToken || !userId) throw new Error('登录响应缺少 access_token/user_id');
  const db = getDatabase();
  core.setState(db, TOKEN_KEY, accessToken);
  core.setState(db, USER_KEY, userId);
  await saveDatabase();
  return authStatus();
}

async function signInWithWechat({ createAccount = false } = {}) {
  const response = await requestJson(authApiUrl('/auth/wechat'), {
    method: 'POST',
    data: {
      code: await wechatCode(),
      create_account: createAccount,
      terms_version: config.termsVersion,
      privacy_version: config.privacyVersion
    },
    header: { 'content-type': 'application/json' }
  });
  return saveSession(response);
}

async function requestWechatLinkCode(email) {
  return requestJson(authApiUrl('/auth/request-wechat-link'), {
    method: 'POST',
    data: { email: String(email || '').trim() },
    header: { 'content-type': 'application/json' }
  });
}

async function linkWechatToExistingAccount(email, emailCode) {
  const response = await requestJson(authApiUrl('/auth/link-wechat'), {
    method: 'POST',
    data: {
      email: String(email || '').trim(),
      email_code: String(emailCode || '').trim(),
      code: await wechatCode(),
      terms_version: config.termsVersion,
      privacy_version: config.privacyVersion
    },
    header: { 'content-type': 'application/json' }
  });
  return saveSession(response);
}

module.exports = { authHeaders, authStatus, linkWechatToExistingAccount, requestWechatLinkCode, signInWithWechat };
