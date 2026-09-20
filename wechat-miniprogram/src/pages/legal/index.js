// 协议正文从 Worker 的 /api/legal 取（小程序打不开外链：web-view 要备案域名），
// 和网页版 /privacy、/terms 同一份内容源。带 ?consent=1 进来时底部多一颗「同意并绑定」，
// 点了才把版本号记进本机 app_state，settings 页据此决定要不要再拦一次。
const config = require('../../config');
const { requestJson } = require('../../runtime/wx-promise');
const { getDatabase, saveDatabase } = require('../../runtime/database-store');
const core = require('../../core/study-core');

const CONSENT_KEY = 'consent_privacy_version';

function apiBase() {
  const base = String(config.authUrl || config.syncUrl || '').replace(/\/$/, '');
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

function hasConsented() {
  return core.getState(getDatabase(), CONSENT_KEY, '') === config.privacyVersion;
}

Page({
  data: { loading: true, error: '', docs: [], needConsent: false, busy: false },

  onLoad(options = {}) {
    this.setData({ needConsent: options.consent === '1' });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const legal = await requestJson(`${apiBase()}/legal`);
      this.setData({ docs: [legal.terms, legal.privacy], loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error?.message || error?.errMsg || JSON.stringify(error) });
    }
  },

  async agree() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      core.setState(getDatabase(), CONSENT_KEY, config.privacyVersion);
      await saveDatabase();
      const settings = getCurrentPages().find((page) => page.route === 'pages/settings/index');
      wx.navigateBack();
      // 回到设置页再发起绑定；settings 不在栈里（直接进的协议页）就只记同意。
      if (settings) setTimeout(() => settings.signIn(), 300);
    } finally {
      this.setData({ busy: false });
    }
  }
});

module.exports.hasConsented = hasConsented;
