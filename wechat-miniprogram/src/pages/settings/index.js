const { ensureDatabase, getDatabase, getStatus, restoreDatabase, saveDatabase } = require('../../runtime/database-store');
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
  data: { ready: false, entitlement: { active: false, source: 'loading' }, auth: { signedIn: false, userId: '' }, busy: false, result: '', reminder: { configured: false, credits: 0, lastSentOn: '' } },

  async onLoad() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true, entitlement: cachedEntitlement(), auth: authStatus() });
      reminderStatus().then((reminder) => this.setData({ reminder })).catch(() => undefined);
    } catch (error) {
      this.setData({ result: error?.message || error?.errMsg || JSON.stringify(error) });
    }
  },

  openReminderSetting() {
    wx.openSetting({ withSubscriptions: true });
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
      this.setData({ auth, result: `已绑定账号 ${auth.userId}` });
    } catch (error) {
      this.setData({ result: `登录失败：${error?.message || error?.errMsg || JSON.stringify(error)}` });
    } finally {
      this.setData({ busy: false });
    }
  },

  async refreshEntitlement() {
    if (this.data.busy) return;
    this.setData({ busy: true, result: '正在读取服务端权益…' });
    try {
      const entitlement = await fetchEntitlement();
      this.setData({ entitlement, result: '权益状态已更新' });
    } catch (error) {
      this.setData({ result: `权益读取失败：${error?.message || error?.errMsg || JSON.stringify(error)}` });
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
      this.setData({ result: `支付未完成：${error?.message || error?.errMsg || JSON.stringify(error)}` });
    } finally {
      this.setData({ busy: false });
    }
  }
  ,
  async run(label, task) {
    if (this.data.busy) return;
    this.setData({ busy: true, result: `${label}…` });
    try { const result = await task(); this.setData({ result: `${label}完成：${result || 'OK'}` }); }
    catch (error) { this.setData({ result: `${label}失败：${error?.message || error?.errMsg || JSON.stringify(error)}` }); }
    finally { this.setData({ busy: false }); }
  },
  handleContentUpdate() { return this.run('检查内容更新', async () => { const result = await updateFromManifest(); return result.updated ? `已更新 ${result.version}` : `当前已是 ${result.version}`; }); },
  handleSync() { return this.run('同步进度', async () => { const result = await syncNow(); return `合并流水 ${result.merged?.insertedReviews ?? 0} 条`; }); },
  handleSave() { return this.run('导出并原子写盘', async () => { const result = await saveDatabase(); return `${(result.bytes / 1024 / 1024).toFixed(2)} MiB`; }); },
  handleRestore() { return this.run('冷启动恢复', async () => { const db = await restoreDatabase(); return `words=${db.exec('SELECT COUNT(*) FROM words')[0]?.values?.[0]?.[0] ?? 0}`; }); },
  handleDue() { return this.run('到期查询', async () => { const row = getDatabase().exec("SELECT COUNT(*) FROM progress WHERE known_forever = 0 AND seen_count > 0 AND (fsrs_due IS NULL OR fsrs_due <= datetime('now'))"); return `到期 ${row[0]?.values?.[0]?.[0] ?? 0} 张`; }); },
  handleExportBackup() { return this.run('导出学习备份', async () => { const result = await exportBackup(); if (typeof wx.shareFileMessage === 'function') wx.shareFileMessage({ filePath: result.path, fileName: 'shushugo-learning-backup.db' }); return `${(result.bytes / 1024 / 1024).toFixed(2)} MiB`; }); },
  handleImportBackup() {
    this.run('合并学习备份', async () => {
      const selection = await new Promise((resolve, reject) => wx.chooseMessageFile({ count: 1, type: 'file', extension: ['db', 'sqlite'], success: resolve, fail: reject }));
      const filePath = selection?.tempFiles?.[0]?.path; if (!filePath) throw new Error('没有选择备份文件');
      const result = await importBackup(filePath); return `新增流水 ${result.insertedReviews ?? 0} 条`;
    });
  }
});
