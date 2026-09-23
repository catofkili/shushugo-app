const { ensureDatabase, getDatabase, getStatus } = require('../../runtime/database-store');
const { cachedEntitlement, fetchEntitlement } = require('../../runtime/entitlements');
const { requestPayment } = require('../../runtime/payment');
const config = require('../../config');
const core = require('../../core/study-core');
const { authStatus, signInWithWechat } = require('../../runtime/auth');
const { updateFromManifest } = require('../../runtime/content-update');
const { syncNow } = require('../../runtime/sync-client');
const { exportBackup, importBackup } = require('../../runtime/backup');
const { status: reminderStatus } = require('../../runtime/reminder');

Page({
  data: { ready: false, entitlement: { active: false, source: 'loading' }, auth: { signedIn: false, userId: '' }, busy: false, result: '', soundOn: true, reminder: { configured: false, credits: 0, lastSentOn: '' } },

  async onLoad() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true, entitlement: cachedEntitlement(), auth: authStatus(), soundOn: core.web.preferences.getStudyPreferences().zooSounds });
      reminderStatus().then((reminder) => this.setData({ reminder })).catch(() => undefined);
    } catch (error) {
      console.error('[settings] 初始化失败', error);
      this.setData({ result: '设置加载失败，请稍后重试' });
    }
  },

  openReminderSetting() {
    wx.openSetting({ withSubscriptions: true });
  },

  toggleSound(event) {
    const soundOn = Boolean(event.detail.value);
    const prefs = core.web.preferences.getStudyPreferences();
    core.web.preferences.saveStudyPreferences({ ...prefs, zooSounds: soundOn });
    this.setData({ soundOn });
  },

  async signIn() {
    if (this.data.busy) return;
    // 没读过当前版本的协议就先去协议页；服务端也按这个版本号判「是否同意当前版本」，
    // 本机没记录就直接发过去等于替用户点了同意。
    if (core.getState(getDatabase(), 'consent_privacy_version', '') !== config.privacyVersion) {
      wx.navigateTo({ url: '/pages/legal/index?consent=1' });
      return;
    }
    this.setData({ busy: true, result: '正在请求微信登录…' });
    try {
      const auth = await signInWithWechat();
      this.setData({ auth, result: '微信账号已绑定' });
    } catch (error) {
      console.error('[settings] 微信登录失败', error);
      this.setData({ result: '微信登录失败，请稍后重试' });
    } finally {
      this.setData({ busy: false });
    }
  },

  async refreshEntitlement() {
    if (this.data.busy) return;
    this.setData({ busy: true, result: '正在更新账号权益…' });
    try {
      const entitlement = await fetchEntitlement();
      this.setData({ entitlement, result: '权益状态已更新' });
    } catch (error) {
      console.error('[settings] 权益读取失败', error);
      this.setData({ result: '权益更新失败，请稍后重试' });
    } finally {
      this.setData({ busy: false });
    }
  },

  async buyPro() {
    if (this.data.busy) return;
    this.setData({ busy: true, result: '正在创建支付订单…' });
    try {
      // 商品 id 和 Worker / iOS 同一套：shushugo_pro_monthly / _yearly / _lifetime
      const result = await requestPayment('shushugo_pro_lifetime');
      this.setData({ result: result.paid ? '已购买，正在刷新权益…' : result.cancelled ? '已取消支付' : '支付未完成' });
      this.setData({ busy: false });
      await this.refreshEntitlement();
    } catch (error) {
      console.error('[settings] 支付失败', error);
      this.setData({ result: '支付未完成，请稍后重试' });
    } finally {
      this.setData({ busy: false });
    }
  }
  ,
  async run(label, task) {
    if (this.data.busy) return;
    this.setData({ busy: true, result: `${label}…` });
    try { const result = await task(); this.setData({ result: `${label}完成：${result || 'OK'}` }); }
    catch (error) { console.error(`[settings] ${label}失败`, error); this.setData({ result: `${label}失败，请稍后重试` }); }
    finally { this.setData({ busy: false }); }
  },
  handleContentUpdate() { return this.run('检查内容更新', async () => { const result = await updateFromManifest(); return result.updated ? `已更新 ${result.version}` : `当前已是 ${result.version}`; }); },
  handleSync() { return this.run('同步进度', async () => { const result = await syncNow(); return `已合并 ${result.merged?.insertedReviews ?? 0} 条学习记录`; }); },
  handleExportBackup() { return this.run('导出学习备份', async () => { const result = await exportBackup(); if (typeof wx.shareFileMessage === 'function') wx.shareFileMessage({ filePath: result.path, fileName: 'shushugo-learning-backup.db' }); return `${(result.bytes / 1024 / 1024).toFixed(2)} MiB`; }); },
  handleImportBackup() {
    this.run('合并学习备份', async () => {
      const selection = await new Promise((resolve, reject) => wx.chooseMessageFile({ count: 1, type: 'file', extension: ['db', 'sqlite'], success: resolve, fail: reject }));
      const filePath = selection?.tempFiles?.[0]?.path; if (!filePath) throw new Error('没有选择备份文件');
      const result = await importBackup(filePath); return `已合并 ${result.insertedReviews ?? 0} 条学习记录`;
    });
  }
});
