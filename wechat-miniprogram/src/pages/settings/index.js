const { ensureDatabase, getDatabase, getStatus } = require('../../runtime/database-store');
const { cachedEntitlement, fetchEntitlement } = require('../../runtime/entitlements');
const { pendingOrderNo, requestPayment, verifyPendingPayment } = require('../../runtime/payment');
const config = require('../../config');
const core = require('../../core/study-core');
const { authStatus, linkWechatToExistingAccount, requestWechatLinkCode: sendWechatLinkCode, signInWithWechat } = require('../../runtime/auth');
const { updateFromManifest } = require('../../runtime/content-update');
const { syncNow } = require('../../runtime/sync-client');
const { exportBackup, importBackup } = require('../../runtime/backup');
const { status: reminderStatus } = require('../../runtime/reminder');

Page({
  data: {
    ready: false, entitlement: { active: false, source: 'loading' }, auth: { signedIn: false, userId: '' }, busy: false, result: '', pendingPayment: false, showWechatLink: false, linkEmail: '', linkCode: '', soundOn: true, reminder: { configured: false, credits: 0, lastSentOn: '' },
    plans: [
      { id: 'shushugo_pro_monthly', name: '月卡', priceYuan: 10, priceCents: 1000 },
      { id: 'shushugo_pro_quarterly', name: '季卡', priceYuan: 24, priceCents: 2400 },
      { id: 'shushugo_pro_yearly', name: '年卡', priceYuan: 68, priceCents: 6800 },
      { id: 'shushugo_pro_lifetime', name: '永久版', priceYuan: 298, priceCents: 29800 }
    ]
  },

  async onLoad() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.setData({ ready: true, entitlement: cachedEntitlement(), auth: authStatus(), soundOn: core.web.preferences.getStudyPreferences().zooSounds, pendingPayment: Boolean(pendingOrderNo()) });
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

  requireCurrentConsent(flow) {
    if (core.getState(getDatabase(), 'consent_privacy_version', '') === config.privacyVersion) return true;
    wx.navigateTo({ url: `/pages/legal/index?consent=1&flow=${encodeURIComponent(flow)}` });
    return false;
  },

  resumeConsentFlow(flow) {
    if (flow === 'wechat-link') return this.openWechatLink();
    if (flow === 'wechat-link-code') return this.sendWechatLinkCode();
    if (flow === 'wechat-link-submit') return this.linkWechatAccount();
    if (flow === 'team-signin') return;
    return this.signIn();
  },

  async signIn() {
    if (this.data.busy) return;
    // 没读过当前版本的协议就先去协议页；服务端也按这个版本号判「是否同意当前版本」，
    // 本机没记录就直接发过去等于替用户点了同意。
    if (core.getState(getDatabase(), 'consent_privacy_version', '') !== config.privacyVersion) {
      wx.navigateTo({ url: '/pages/legal/index?consent=1&flow=signin' });
      return;
    }
    this.setData({ busy: true, result: '正在请求微信登录…' });
    try {
      let auth;
      try {
        auth = await signInWithWechat();
      } catch (error) {
        if (error?.data?.code !== 'WECHAT_ACCOUNT_NOT_FOUND') throw error;
        const choice = await new Promise((resolve) => wx.showModal({
          title: '微信尚未关联收集日账号',
          content: '已有邮箱或 Apple 账号？请先验证账号邮箱并关联微信；没有账号时再创建新账号。',
          confirmText: '新建账号',
          cancelText: '关联账号',
          success: resolve,
          fail: () => resolve({ confirm: false })
        }));
        if (!choice.confirm) {
          this.setData({ showWechatLink: true, result: '输入已有收集日账号的邮箱，验证后即可关联当前微信。' });
          return;
        }
        auth = await signInWithWechat({ createAccount: true });
      }
      this.setData({ auth, result: '微信账号已绑定' });
    } catch (error) {
      console.error('[settings] 微信登录失败', error);
      this.setData({ result: error?.data?.detail || '微信登录失败，请稍后重试' });
    } finally {
      this.setData({ busy: false });
    }
  },

  openWechatLink() {
    if (!this.requireCurrentConsent('wechat-link')) return;
    this.setData({ showWechatLink: true, result: '' });
  },
  inputLinkEmail(event) { this.setData({ linkEmail: event.detail.value }); },
  inputLinkCode(event) { this.setData({ linkCode: String(event.detail.value || '').replace(/\D/g, '').slice(0, 6) }); },
  async sendWechatLinkCode() {
    if (this.data.busy) return;
    if (!this.requireCurrentConsent('wechat-link-code')) return;
    const email = String(this.data.linkEmail || '').trim();
    if (!email.includes('@')) { this.setData({ result: '请输入已有收集日账号的邮箱。' }); return; }
    this.setData({ busy: true, result: '正在发送邮箱验证码…' });
    try {
      await sendWechatLinkCode(email);
      this.setData({ result: '如果该邮箱对应收集日账号，验证码已发送；请查收邮件。' });
    } catch (error) {
      console.error('[settings] 微信关联验证码发送失败', error);
      this.setData({ result: error?.data?.detail || '验证码发送失败，请稍后重试。' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async linkWechatAccount() {
    if (this.data.busy) return;
    if (!this.requireCurrentConsent('wechat-link-submit')) return;
    if (!String(this.data.linkEmail || '').includes('@') || !/^\d{6}$/.test(this.data.linkCode)) {
      this.setData({ result: '请填写账号邮箱和 6 位验证码。' });
      return;
    }
    if (this.data.auth.signedIn) {
      const choice = await new Promise((resolve) => wx.showModal({
        title: '关联到已有账号？',
        content: '后续云同步会使用验证邮箱对应的账号。本机学习记录仍留在本机；已绑定到其他账号的微信身份需要单独处理。',
        confirmText: '继续关联',
        cancelText: '取消',
        success: resolve,
        fail: () => resolve({ confirm: false })
      }));
      if (!choice.confirm) return;
    }
    this.setData({ busy: true, result: '正在验证邮箱并关联微信…' });
    try {
      const auth = await linkWechatToExistingAccount(this.data.linkEmail, this.data.linkCode);
      this.setData({ auth, showWechatLink: false, linkCode: '', result: '微信已关联到已有账号。后续云同步会使用该账号。' });
    } catch (error) {
      console.error('[settings] 微信账号关联失败', error);
      this.setData({ result: error?.data?.detail || '微信关联失败，请稍后重试。' });
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

  async buyPro(event) {
    if (this.data.busy) return;
    const { id, priceCents } = event.currentTarget.dataset;
    this.setData({ busy: true, result: '正在创建支付订单…' });
    try {
      const result = await requestPayment(id, Number(priceCents));
      this.setData({
        pendingPayment: Boolean(result.pending),
        result: result.paid ? '已购买，正在刷新权益…' : result.cancelled ? '已取消支付' : result.pending ? '支付结果暂未确认，可稍后重新确认订单。' : '支付未完成'
      });
      this.setData({ busy: false });
      if (result.paid) await this.refreshEntitlement();
    } catch (error) {
      console.error('[settings] 支付失败', error);
      this.setData({ result: error.message === 'PAYMENT_PRICE_CHANGED' ? '支付价格与页面不一致，请更新小程序后重试' : error?.data?.code === 'PRO_ALREADY_ACTIVE' ? error.data.detail : '支付未完成，请稍后重试' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async checkPendingPayment() {
    if (this.data.busy) return;
    this.setData({ busy: true, result: '正在重新确认最近一笔支付…' });
    try {
      const result = await verifyPendingPayment();
      this.setData({
        pendingPayment: Boolean(result.pending),
        result: result.paid ? '支付已确认，正在刷新权益…' : '微信暂未确认到账，可以稍后再试。'
      });
      if (result.paid) {
        this.setData({ busy: false });
        await this.refreshEntitlement();
      }
    } catch (error) {
      console.error('[settings] 支付补查失败', error);
      this.setData({ result: '重新确认失败，请稍后再试' });
    } finally {
      this.setData({ busy: false, pendingPayment: Boolean(pendingOrderNo()) });
    }
  },
  async run(label, task) {
    if (this.data.busy) return;
    this.setData({ busy: true, result: `${label}…` });
    try { const result = await task(); this.setData({ result: `${label}完成：${result || 'OK'}` }); }
    catch (error) { console.error(`[settings] ${label}失败`, error); this.setData({ result: `${label}失败，请稍后重试` }); }
    finally { this.setData({ busy: false }); }
  },
  handleContentUpdate() { return this.run('检查内容更新', async () => { const result = await updateFromManifest(); return result.updated ? `已更新 ${result.version}` : `当前已是 ${result.version}`; }); },
  handleSync() {
    if (!authStatus().signedIn) {
      this.setData({ result: '请先登录收集日账号，再同步学习进度。' });
      return;
    }
    return this.run('同步进度', async () => { const result = await syncNow(); return `已合并 ${result.merged?.insertedReviews ?? 0} 条学习记录`; });
  },
  handleExportBackup() { return this.run('导出学习备份', async () => { const result = await exportBackup(); if (typeof wx.shareFileMessage === 'function') wx.shareFileMessage({ filePath: result.path, fileName: 'shushugo-learning-backup.db' }); return `${(result.bytes / 1024 / 1024).toFixed(2)} MiB`; }); },
  handleImportBackup() {
    this.run('合并学习备份', async () => {
      const selection = await new Promise((resolve, reject) => wx.chooseMessageFile({ count: 1, type: 'file', extension: ['db', 'sqlite'], success: resolve, fail: reject }));
      const filePath = selection?.tempFiles?.[0]?.path; if (!filePath) throw new Error('没有选择备份文件');
      const result = await importBackup(filePath); return `已合并 ${result.insertedReviews ?? 0} 条学习记录`;
    });
  }
});
