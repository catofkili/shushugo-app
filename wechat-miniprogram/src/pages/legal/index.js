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
  data: { loading: true, error: '', docs: [], needConsent: false, busy: false, consentFlow: 'signin' },

  onLoad(options = {}) {
    this.setData({ needConsent: options.consent === '1', consentFlow: options.flow || 'signin' });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const legal = await requestJson(`${apiBase()}/legal`);
      this.setData({ docs: [legal.terms, legal.privacy], loading: false });
    } catch (error) {
      console.error('[legal] 协议读取失败', error);
      this.setData({ loading: false, error: '暂时无法读取，请稍后重试' });
    }
  },

  async agree() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      core.setState(getDatabase(), CONSENT_KEY, config.privacyVersion);
      await saveDatabase();
      const settings = getCurrentPages().find((page) => page.route === 'pages/settings/index');
      const flow = this.data.consentFlow;
      wx.navigateBack();
      // 回到设置页继续用户刚才选择的账号操作；直接进入协议页则只记录同意。
      if (settings) setTimeout(() => settings.resumeConsentFlow(flow), 300);
    } finally {
      this.setData({ busy: false });
    }
  }
});

module.exports.hasConsented = hasConsented;
