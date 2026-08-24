const { ensureDatabase, getDatabase, getStatus, restoreDatabase, saveDatabase } = require('../../runtime/database-store');
const { cachedEntitlement, fetchEntitlement } = require('../../runtime/entitlements');
const { requestPayment } = require('../../runtime/payment');
const { authStatus, signInWithWechat } = require('../../runtime/auth');
const { updateFromManifest } = require('../../runtime/content-update');
const { syncNow } = require('../../runtime/sync-client');
const { exportBackup, importBackup } = require('../../runtime/backup');

Page({
  data: { ready: false, entitlement: { active: false, source: 'loading' }, auth: { signedIn: false, userId: '' }, busy: false, result: '' },

  async onLoad() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true, entitlement: cachedEntitlement(), auth: authStatus() });
    } catch (error) {
      this.setData({ result: error?.message || String(error) });
    }
  },

  async signIn() {
    if (this.data.busy) return;
    this.setData({ busy: true, result: '正在请求微信登录…' });
    try {
      const auth = await signInWithWechat();
      this.setData({ auth, result: `已绑定账号 ${auth.userId}` });
    } catch (error) {
      this.setData({ result: `登录失败：${error?.message || String(error)}` });
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
      this.setData({ result: `权益读取失败：${error?.message || String(error)}` });
    } finally {
      this.setData({ busy: false });
    }
  },

  async buyPro() {
    if (this.data.busy) return;
    this.setData({ busy: true, result: '正在创建支付订单…' });
    try {
      const result = await requestPayment('pro-monthly');
      this.setData({ result: result.paid ? '支付已返回，正在刷新权益…' : '支付未完成' });
      this.setData({ busy: false });
      await this.refreshEntitlement();
    } catch (error) {
      this.setData({ result: `支付未完成：${error?.message || String(error)}` });
    } finally {
      this.setData({ busy: false });
    }
  }
  ,
  async run(label, task) {
    if (this.data.busy) return;
    this.setData({ busy: true, result: `${label}…` });
    try { const result = await task(); this.setData({ result: `${label}完成：${result || 'OK'}` }); }
    catch (error) { this.setData({ result: `${label}失败：${error?.message || String(error)}` }); }
    finally { this.setData({ busy: false }); }
  },
  handleContentUpdate() { this.run('检查内容更新', async () => { const result = await updateFromManifest(); return result.updated ? `已更新 ${result.version}` : `当前已是 ${result.version}`; }); },
  handleSync() { this.run('同步进度', async () => { const result = await syncNow(); return `合并流水 ${result.merged?.insertedReviews ?? 0} 条`; }); },
  handleSave() { this.run('导出并原子写盘', async () => { const result = await saveDatabase(); return `${(result.bytes / 1024 / 1024).toFixed(2)} MiB`; }); },
  handleRestore() { this.run('冷启动恢复', async () => { const db = await restoreDatabase(); return `words=${db.exec('SELECT COUNT(*) FROM words')[0]?.values?.[0]?.[0] ?? 0}`; }); },
  handleDue() { this.run('到期查询', async () => { const row = getDatabase().exec("SELECT COUNT(*) FROM progress WHERE known_forever = 0 AND seen_count > 0 AND (fsrs_due IS NULL OR fsrs_due <= datetime('now'))"); return `到期 ${row[0]?.values?.[0]?.[0] ?? 0} 张`; }); },
  handleExportBackup() { this.run('导出学习备份', async () => { const result = await exportBackup(); if (typeof wx.shareFileMessage === 'function') wx.shareFileMessage({ filePath: result.path, fileName: 'shushugo-learning-backup.db' }); return `${(result.bytes / 1024 / 1024).toFixed(2)} MiB`; }); },
  handleImportBackup() {
    this.run('合并学习备份', async () => {
      const selection = await new Promise((resolve, reject) => wx.chooseMessageFile({ count: 1, type: 'file', extension: ['db', 'sqlite'], success: resolve, fail: reject }));
      const filePath = selection?.tempFiles?.[0]?.path; if (!filePath) throw new Error('没有选择备份文件');
      const result = await importBackup(filePath); return `新增流水 ${result.insertedReviews ?? 0} 条`;
    });
  }
});
