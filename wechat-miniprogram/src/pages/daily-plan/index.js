const { ensureDatabase, getDatabase, getStatus, saveDatabase } = require('../../runtime/database-store');
const core = require('../../core/study-core');

const { dailyPlan, studyMode, wordApi, mixedCards, preferences } = core.web;
const KINDS = dailyPlan.PLAN_KINDS;
const COLORS = { words: '#6FA83E', grammar: '#F3B14D', kanji: '#B9A7F2', confusion: '#F2A7C8' };
const ACTIVE = { classic: ['words'], quick: ['words'], mixed: KINDS, mistakes: [], reverse: [], kanji: [] };
const TAU = Math.PI * 2;
const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = CENTER - 18;
const clean = (value) => Math.max(0, Math.min(2000, Math.floor(Number(value) || 0)));
const copyPlan = (view) => Object.fromEntries(view.segments.map((part) => [part.kind, { fresh: part.fresh, review: part.review }]));

Page({
  data: {
    ready: false, busy: false, error: '', mode: 'classic', active: [],
    rows: [], total: 0, minutes: 0, daysLeft: 0, focus: '', focusRow: null, canUndo: false,
    target: 'N3', presetMinutes: 0, note: ''
  },

  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      this.offset = -Math.PI / 2;
      this.history = [];
      this.load();
    } catch (error) {
      console.error('[daily-plan] 读取失败', error);
      this.setData({ error: '先到「单词」下载离线词库。' });
    }
  },

  load() {
    const db = getDatabase();
    const view = core.withDb(db, () => dailyPlan.dailyPlanView());
    this.shownView = view; // 必须保留面板渲染时的 view；保存时不能重算，否则会悄悄改掉没动的 cap。
    this.plan = copyPlan(view);
    this.lastSavedPlan = copyPlan(view);
    const mode = studyMode.getStudyMode();
    this.setData({
      ready: true, error: '', mode, active: ACTIVE[mode] || [],
      daysLeft: view.daysLeft, canUndo: Boolean(this.history.length),
      target: preferences.getStudyPreferences().jlptTarget
    });
    this.render();
    this.updatePreset();
  },

  render() {
    const rows = this.shownView.segments.map((segment) => {
      const value = this.plan[segment.kind];
      return { ...segment, ...value, count: value.fresh + value.review, color: COLORS[segment.kind],
        active: this.data.active.includes(segment.kind), low: value.fresh < segment.suggest.fresh || value.review < segment.suggest.review };
    });
    const total = rows.reduce((sum, row) => sum + (row.active ? row.count : 0), 0);
    const minutes = Math.round(rows.reduce((sum, row) => sum + row.count * dailyPlan.SECONDS_PER_CARD[row.kind], 0) / 60);
    this.setData({ rows, total, minutes, focusRow: rows.find((row) => row.kind === this.data.focus) || null });
    this.drawRing();
  },

  bounds() {
    const counts = KINDS.map((kind) => this.plan[kind].fresh + this.plan[kind].review);
    const lengths = counts.map(dailyPlan.segmentLength);
    const sum = lengths.reduce((a, b) => a + b, 0);
    const angles = lengths.map((length) => sum ? length / sum * TAU : TAU / 4);
    const bounds = [this.offset ?? -Math.PI / 2];
    angles.forEach((angle) => bounds.push(bounds[bounds.length - 1] + angle));
    return { counts, angles, bounds };
  },

  drawRing() {
    if (!this.data.ready || typeof wx.createCanvasContext !== 'function') return;
    const ctx = wx.createCanvasContext('dailyPlanRing', this);
    const { bounds } = this.bounds();
    ctx.setLineWidth(22);
    ctx.setStrokeStyle('#e5ddcf');
    ctx.beginPath(); ctx.arc(CENTER, CENTER, RADIUS, 0, TAU); ctx.stroke();
    KINDS.forEach((kind, index) => {
      if (bounds[index + 1] - bounds[index] < 0.0001) return;
      ctx.beginPath();
      ctx.setStrokeStyle(COLORS[kind]);
      ctx.setGlobalAlpha(this.data.active.includes(kind) ? (this.data.focus && this.data.focus !== kind ? 0.35 : 1) : 0.18);
      ctx.arc(CENTER, CENTER, RADIUS, bounds[index], Math.min(bounds[index + 1], bounds[index] + TAU - 0.0001));
      ctx.stroke();
    });
    ctx.setGlobalAlpha(1);
    bounds.slice(1).forEach((angle, index) => {
      const x = CENTER + RADIUS * Math.cos(angle);
      const y = CENTER + RADIUS * Math.sin(angle);
      ctx.beginPath(); ctx.setFillStyle('#fff'); ctx.setStrokeStyle('#c9bdab'); ctx.setLineWidth(2);
      ctx.arc(x, y, 13, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.setFillStyle(COLORS[KINDS[(index + 1) % 4]]);
      ctx.arc(x, y, 5, 0, TAU); ctx.fill();
    });
    ctx.setTextAlign('center'); ctx.setFillStyle('#3a2e22'); ctx.setFontSize(32);
    ctx.fillText(this.data.active.length ? String(this.data.total) : '—', CENTER, CENTER + 2);
    ctx.setFontSize(12); ctx.setFillStyle('#806f5c');
    ctx.fillText(this.data.active.length ? '今天 · 项' : '不按圆环排', CENTER, CENTER + 23);
    ctx.draw();
  },

  point(event) {
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    if (!touch || !this.ringRect) return null;
    const x = (touch.clientX - this.ringRect.left) / this.ringRect.width * SIZE - CENTER;
    const y = (touch.clientY - this.ringRect.top) / this.ringRect.height * SIZE - CENTER;
    return { x, y, angle: Math.atan2(y, x) };
  },

  touchStart(event) {
    if (this.data.busy) return;
    this.dragKnob = null;
    this.dragChanged = false;
    wx.createSelectorQuery().in(this).select('#dailyPlanRing').boundingClientRect((rect) => {
      if (!rect) return;
      this.ringRect = rect; // 只在按下时量一次，移动时不触发布局。
      const point = this.point(event);
      if (!point) return;
      const { bounds } = this.bounds();
      const distances = bounds.slice(1).map((angle) => Math.hypot(point.x - RADIUS * Math.cos(angle), point.y - RADIUS * Math.sin(angle)));
      const nearest = distances.indexOf(Math.min(...distances));
      if (distances[nearest] <= 25) this.dragKnob = nearest;
      else {
        let angle = point.angle;
        while (angle < bounds[0]) angle += TAU;
        const index = bounds.findIndex((end, i) => i > 0 && angle <= end) - 1;
        this.setData({ focus: KINDS[Math.max(0, index)] });
        this.drawRing();
      }
    }).exec();
  },

  touchMove(event) {
    if (this.dragKnob == null) return;
    this.pendingAngle = this.point(event)?.angle;
    if (this.pendingAngle == null || this.frame) return;
    this.frame = setTimeout(() => {
      this.frame = null;
      this.moveKnob(this.dragKnob, this.pendingAngle);
    }, 16);
  },

  moveKnob(k, angle) {
    const { counts, angles, bounds } = this.bounds();
    const a = k, b = (k + 1) % 4, total = counts[a] + counts[b];
    if (!total) return;
    let theta = angle - bounds[a];
    while (theta < 0) theta += TAU;
    while (theta >= TAU) theta -= TAU;
    const target = Math.min(angles[a] + angles[b], theta) / (angles[a] + angles[b]);
    const share = (n) => dailyPlan.segmentLength(n) / (dailyPlan.segmentLength(n) + dailyPlan.segmentLength(total - n));
    let lo = 0, hi = total;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (share(mid) < target) lo = mid; else hi = mid; }
    const nextA = Math.abs(share(lo) - target) <= Math.abs(share(hi) - target) ? lo : hi;
    if (nextA === counts[a]) return;
    this.dragChanged = true;
    const split = (kind, count) => {
      const old = this.plan[kind], oldTotal = old.fresh + old.review;
      const fresh = oldTotal ? Math.round(count * old.fresh / oldTotal) : 0;
      return { fresh, review: count - fresh };
    };
    this.plan = { ...this.plan, [KINDS[a]]: split(KINDS[a], nextA), [KINDS[b]]: split(KINDS[b], total - nextA) };
    if (k === 3) {
      const updated = counts.slice(); updated[3] = nextA; updated[0] = total - nextA;
      const lengths = updated.map(dailyPlan.segmentLength);
      const sum = lengths.reduce((x, y) => x + y, 0);
      this.offset = bounds[3] - lengths.slice(0, 3).reduce((x, y) => x + y / sum * TAU, 0);
    }
    this.render(); // 只更新画面；松手后才写盘和重排任务。
  },

  touchEnd() {
    if (this.dragKnob == null) return;
    if (this.frame) { clearTimeout(this.frame); this.frame = null; this.moveKnob(this.dragKnob, this.pendingAngle); }
    this.dragKnob = null;
    if (this.dragChanged) setTimeout(() => this.commit(false), 0);
    this.dragChanged = false;
  },

  pickFocus(event) {
    const focus = String(event.currentTarget.dataset.kind);
    const next = this.data.focus === focus ? '' : focus;
    this.setData({ focus: next, focusRow: this.data.rows.find((row) => row.kind === next) || null });
    this.drawRing();
  },

  changeSplit(event) {
    if (this.data.busy) return;
    const kind = this.data.focus;
    if (!kind) return;
    const total = this.plan[kind].fresh + this.plan[kind].review;
    const fresh = Math.min(total, clean(event.detail.value));
    this.plan[kind] = { fresh, review: total - fresh };
    this.render();
    this.commit(false);
  },

  editNumber(event) {
    if (this.data.busy) return;
    const { kind, field } = event.currentTarget.dataset;
    if (!KINDS.includes(kind) || !['fresh', 'review'].includes(field)) return;
    const value = clean(event.detail.value);
    if (this.plan[kind][field] === value) return;
    this.plan[kind] = { ...this.plan[kind], [field]: value };
    this.render();
    this.commit(field === 'fresh');
  },

  arrange() {
    if (this.data.busy) return;
    this.plan = dailyPlan.arrangedPlan(this.shownView);
    this.render();
    this.commit(false);
  },

  editTotal(event) {
    if (this.data.busy) return;
    const active = this.data.active;
    if (!active.length) return;
    const wanted = clean(event.detail.value);
    const current = active.reduce((sum, kind) => sum + this.plan[kind].fresh + this.plan[kind].review, 0);
    if (wanted === current) return;
    const next = { ...this.plan };
    if (!current) next[active[0]] = { fresh: wanted, review: 0 };
    else {
      const ratio = wanted / current;
      active.forEach((kind) => {
        next[kind] = { fresh: Math.round(this.plan[kind].fresh * ratio), review: Math.round(this.plan[kind].review * ratio) };
      });
      const actual = active.reduce((sum, kind) => sum + next[kind].fresh + next[kind].review, 0);
      let delta = wanted - actual;
      for (const kind of active) {
        for (const field of ['review', 'fresh']) {
          const change = Math.max(-next[kind][field], delta);
          next[kind][field] += change;
          delta -= change;
          if (!delta) break;
        }
        if (!delta) break;
      }
    }
    this.plan = next;
    this.render();
    this.commit(false);
  },

  topUp() {
    if (this.data.busy) return;
    const row = this.data.focusRow;
    if (!row) return;
    this.plan[row.kind] = {
      fresh: Math.max(this.plan[row.kind].fresh, row.suggest.fresh),
      review: Math.max(this.plan[row.kind].review, row.suggest.review)
    };
    this.render();
    this.commit(false);
  },

  undo() {
    if (!this.history?.length || this.data.busy) return;
    this.plan = this.history.pop();
    this.render();
    this.commit(false, false);
  },

  updatePreset() {
    try {
      const preset = core.withDb(getDatabase(), () => dailyPlan.examPreset(this.data.target));
      this.setData({ presetMinutes: preset.minutes });
    } catch { this.setData({ presetMinutes: 0 }); }
  },

  async applyPreset() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const result = core.withDb(getDatabase(), () => dailyPlan.applyExamPreset(this.data.target));
      await this.replan();
      this.setData({ note: `已按 ${this.data.target} 设好：每天约 ${result.minutes} 分钟` });
      this.load();
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },

  async commit(standing, recordHistory = true) {
    if (this.data.busy) return;
    if (JSON.stringify(this.plan) === JSON.stringify(this.lastSavedPlan)) return;
    const before = this.lastSavedPlan;
    this.setData({ busy: true });
    try {
      core.withDb(getDatabase(), () => dailyPlan.saveDailyPlan(this.plan, standing, this.shownView));
      await this.replan();
      if (recordHistory) this.history.push(before);
      this.load();
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },

  async replan() {
    core.withDb(getDatabase(), () => {
      wordApi.refreshTodayWordPlan();
      mixedCards.refreshMixedCardTasks(getDatabase());
    });
    await saveDatabase();
  },

  fail(error) {
    console.error('[daily-plan] 保存失败', error);
    this.setData({ error: '保存失败，请稍后重试' });
  }
});
