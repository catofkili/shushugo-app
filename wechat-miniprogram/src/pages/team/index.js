const config = require('../../config');
const core = require('../../core/study-core');
const analytics = require('../../core/analytics');
const { authStatus, signInWithWechat } = require('../../runtime/auth');
const { ensureDatabase, getDatabase, getStatus } = require('../../runtime/database-store');
const teamApi = require('../../runtime/team');

const emojis = ['🌱', '🐿️', '🐦', '🚃', '🦉', '🍊', '📚', '⛩️'];
const targets = ['N5', 'N4', 'N3', 'N2', 'N1', '全部'];

function activity() {
  const db = getDatabase();
  const summary = analytics.studySummary(db);
  const grammar = Number(core.firstValue(db, 'SELECT COUNT(*) FROM grammar_reviews WHERE reviewed_on = ?', [summary.day], 0));
  const hasKanjiReviews = Number(core.firstValue(db, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'kanji_unit_reviews'", [], 0)) > 0;
  const kanji = hasKanjiReviews
    ? Number(core.firstValue(db, 'SELECT COUNT(*) FROM kanji_unit_reviews WHERE reviewed_on = ?', [summary.day], 0))
    : 0;
  const completed = Number(core.firstValue(db, 'SELECT COUNT(*) FROM checkins WHERE checked_on = ?', [summary.day], 0)) > 0;
  return { studyDay: summary.day, studyCount: Number(summary.today) + grammar + kanji, completed };
}

function errorText(error) {
  return String(error?.message || '操作失败，请稍后再试').replace(/^接口请求失败（HTTP [^)]+）[：:]?/, '');
}

Page({
  data: {
    ready: false,
    needsInit: false,
    auth: { signedIn: false },
    busy: false,
    result: '',
    team: null,
    plaza: [],
    inviteCode: '',
    nickname: '',
    draft: { name: '', targetLevel: 'N3', emoji: '🌱', visibility: 'public' },
    emojis,
    targets,
    visibilities: ['公开', '仅邀请'],
    targetIndex: 2,
    emojiIndex: 0,
    visibilityIndex: 0,
    editing: false
  },

  onLoad(options = {}) {
    const inviteCode = String(options.invite || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8);
    this.setData({ inviteCode });
    wx.showShareMenu({ menus: ['shareAppMessage'] });
  },

  async onShow() {
    if (!getStatus().ready) {
      // 首次安装时本机还没有库，restoreDatabase 只会恢复已有的那份，新用户会永远停在这里。
      try { await ensureDatabase(); }
      catch (error) {
        this.setData({ needsInit: true, ready: true, result: errorText(error) });
        return;
      }
    }
    const auth = authStatus();
    this.setData({ ready: true, needsInit: false, auth });
    if (auth.signedIn) await this.refresh();
  },

  async onPullDownRefresh() {
    try { if (this.data.auth.signedIn) await this.refresh(); }
    finally { wx.stopPullDownRefresh(); }
  },

  async refresh() {
    if (this.data.busy) return;
    this.setData({ busy: true, result: '' });
    try {
      const local = activity();
      const [current, plaza] = await Promise.all([teamApi.myTeam(local.studyDay), teamApi.plaza(local.studyDay)]);
      const synced = current ? await teamApi.reportActivity(local) : null;
      this.setData({ team: synced, plaza: plaza.filter((item) => item.id !== synced?.id) });
    } catch (error) {
      console.error('[team] 刷新失败', error);
      this.setData({ result: errorText(error) });
    } finally {
      this.setData({ busy: false });
    }
  },

  async signIn() {
    if (this.data.busy) return;
    if (core.getState(getDatabase(), 'consent_privacy_version', '') !== config.privacyVersion) {
      wx.navigateTo({ url: '/pages/legal/index?consent=1&flow=team-signin' });
      return;
    }
    this.setData({ busy: true, result: '正在绑定微信账号…' });
    try {
      let auth;
      try {
        auth = await signInWithWechat();
      } catch (error) {
        if (error?.data?.code !== 'WECHAT_ACCOUNT_NOT_FOUND') throw error;
        const choice = await new Promise((resolve) => wx.showModal({
          title: '微信尚未关联收集日账号',
          content: '已有邮箱或 Apple 账号？先关联微信，避免创建重复账号。没有账号时可以创建新账号。',
          confirmText: '新建账号',
          cancelText: '去关联',
          success: resolve,
          fail: () => resolve({ confirm: false })
        }));
        if (!choice.confirm) {
          wx.switchTab({ url: '/pages/settings/index' });
          return;
        }
        auth = await signInWithWechat({ createAccount: true });
      }
      this.setData({ auth, result: '微信账号已绑定' });
    } catch (error) {
      console.error('[team] 登录失败', error);
      this.setData({ result: error?.data?.detail || errorText(error) });
    } finally {
      this.setData({ busy: false });
    }
    if (this.data.auth.signedIn) await this.refresh();
  },

  inputNickname(event) { this.setData({ nickname: event.detail.value }); },
  inputName(event) { this.setData({ 'draft.name': event.detail.value }); },
  inputInvite(event) { this.setData({ inviteCode: String(event.detail.value || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8) }); },
  changeTarget(event) {
    const targetIndex = Number(event.detail.value);
    this.setData({ targetIndex, 'draft.targetLevel': targets[targetIndex] });
  },
  changeEmoji(event) {
    const emojiIndex = Number(event.detail.value);
    this.setData({ emojiIndex, 'draft.emoji': emojis[emojiIndex] });
  },
  changeVisibility(event) {
    const visibilityIndex = Number(event.detail.value);
    this.setData({ visibilityIndex, 'draft.visibility': visibilityIndex ? 'invite' : 'public' });
  },

  async run(task, success) {
    if (this.data.busy) return;
    this.setData({ busy: true, result: '' });
    try {
      await task();
      this.setData({ result: success || '' });
    } catch (error) {
      console.error('[team] 操作失败', error);
      this.setData({ result: errorText(error) });
    } finally {
      this.setData({ busy: false });
    }
  },

  createTeam() {
    this.run(async () => {
      await teamApi.create({ ...this.data.draft, displayName: this.data.nickname });
      const local = activity();
      this.setData({ team: await teamApi.reportActivity(local) });
    }, '队伍创建好了，可以分享邀请给队友。');
  },

  joinTeam(event) {
    const teamId = event.currentTarget.dataset.id;
    this.run(async () => {
      await teamApi.join({
        ...(teamId ? { teamId } : { inviteCode: this.data.inviteCode }),
        displayName: this.data.nickname
      });
      const local = activity();
      this.setData({ team: await teamApi.reportActivity(local), inviteCode: '' });
    }, '加入成功，今天的学习进度已同步。');
  },

  cheer(event) {
    const memberId = event.currentTarget.dataset.id;
    this.run(async () => {
      const local = activity();
      this.setData({ team: await teamApi.cheer(memberId, local.studyDay) });
    }, '已经给队友加油。');
  },

  reportTeam(event) {
    const teamId = event.currentTarget.dataset.id;
    const reasons = ['广告或联系方式', '不当内容', '冒充或欺骗', '其他'];
    wx.showActionSheet({
      itemList: reasons,
      success: (choice) => {
        const reason = reasons[choice.tapIndex];
        if (!reason) return;
        this.run(async () => {
          await teamApi.report(teamId, reason);
          this.setData({ plaza: this.data.plaza.filter((item) => item.id !== teamId) });
        }, '已收到举报，这支队伍已从你的广场隐藏。');
      }
    });
  },

  copyInvite() {
    if (!this.data.team) return;
    wx.setClipboardData({ data: this.data.team.inviteCode });
  },

  editTeam() {
    const current = this.data.team;
    if (!current) return;
    this.setData({
      editing: true,
      draft: { name: current.name, targetLevel: current.targetLevel, emoji: current.emoji, visibility: current.visibility },
      targetIndex: Math.max(0, targets.indexOf(current.targetLevel)),
      emojiIndex: Math.max(0, emojis.indexOf(current.emoji)),
      visibilityIndex: current.visibility === 'invite' ? 1 : 0
    });
  },

  cancelEdit() { this.setData({ editing: false }); },

  saveTeam() {
    this.run(async () => {
      this.setData({ team: await teamApi.update(this.data.draft), editing: false });
    }, '队伍设置已保存。');
  },

  regenerateInvite() {
    wx.showModal({
      title: '更新邀请码',
      content: '旧邀请码会立即失效，确定更新吗？',
      success: (choice) => {
        if (!choice.confirm) return;
        this.run(async () => {
          const inviteCode = await teamApi.regenerateInvite();
          this.setData({ 'team.inviteCode': inviteCode });
        }, '已经生成新的邀请码。');
      }
    });
  },

  leaveTeam() {
    const content = this.data.team?.isOwner && this.data.team?.memberCount > 1
      ? '退出后会把队长移交给最早加入的队友，确定退出吗？'
      : '确定退出这支队伍吗？';
    wx.showModal({
      title: '退出队伍',
      content,
      success: (choice) => {
        if (!choice.confirm) return;
        this.run(async () => {
          await teamApi.leave();
          this.setData({ team: null, plaza: await teamApi.plaza(activity().studyDay) });
        }, '已经退出队伍。');
      }
    });
  },

  onShareAppMessage() {
    const team = this.data.team;
    if (!team) return { title: '收集日 · 一起学日语', path: '/pages/team/index' };
    return {
      title: `加入「${team.name}」，一起坚持学日语`,
      path: `/pages/team/index?invite=${encodeURIComponent(team.inviteCode)}`
    };
  }
});
