/*
 * 每周学习回顾：周期、指标、关键词、高光、再见一面的词 —— 全部由网页同一份
 * analytics/weekly.ts 算出来（src/shared/web.js），content_json 也就和网页 / App 同一个形状，
 * 这张 weekly_reports 表是跨端同步的，形状不一样对端就读不出来。
 * 页面只做展示：先看最近一份，往下是历史列表；打开一份就标记已读。
 */
const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const features = require('../../runtime/extended-features');

const SLOT_LABEL = { word: '单词', grammar: '语法', kanji: '汉字' };

const decorate = (snapshot) => {
  if (!snapshot) return null;
  const { report } = snapshot;
  const max = Math.max(...report.metrics.daily.map((day) => day.reviews), 1);
  const label = features.web.weeklyReports.reportWindowLabel(report.window);
  return {
    weekStart: report.window.start,
    label,
    compact: features.web.weeklyReports.reportWindowLabelCompact(report.window),
    readAt: snapshot.readAt,
    keyword: report.keyword ? report.keyword.keyword : '',
    references: report.references.map((item) => item.text),
    highlight: report.highlight ? report.highlight.text : '',
    revisitWords: report.revisitWords || [],
    metrics: {
      ...report.metrics,
      minutesText: report.metrics.minutes >= 60 ? `${Math.floor(report.metrics.minutes / 60)} 小时 ${report.metrics.minutes % 60} 分` : `${report.metrics.minutes} 分钟`,
      kinds: [['word', report.metrics.wordReviews], ['grammar', report.metrics.grammarReviews], ['kanji', report.metrics.kanjiReviews]]
        .filter(([, count]) => count > 0).map(([kind, count]) => ({ kind, label: SLOT_LABEL[kind], count })),
      daily: report.metrics.daily.map((day) => ({
        ...day,
        label: `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))}`,
        width: Math.round(day.reviews / max * 100)
      }))
    }
  };
};

Page({
  data: { ready: false, error: '', current: null, history: [] },

  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      // 最近一个已结束周期没有报告就现算一份（没有任何作答和时长时返回 null，不造空周报）
      features.weeklyReport(0);
      const history = features.listWeeklyReports();
      const current = this.data.current
        ? history.find((item) => item.report.window.start === this.data.current.weekStart) || history[0]
        : history[0];
      this.setData({ ready: true, current: decorate(current || null), history: history.map((item) => decorate(item)) });
      if (current && current.readAt == null) await features.markWeeklyReportRead(current.report.window.start);
    } catch (error) {
      console.error('[weekly] 读取失败', error);
      this.setData({ error: '先到「单词」下载离线词库，再来看周报。' });
    }
  },

  async open(event) {
    const weekStart = event.currentTarget.dataset.week;
    const snapshot = this.data.history.find((item) => item.weekStart === weekStart);
    if (!snapshot) return;
    this.setData({ current: snapshot });
    if (snapshot.readAt == null) await features.markWeeklyReportRead(weekStart);
  }
});
