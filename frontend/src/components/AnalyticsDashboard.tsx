/**
 * 学习分析面板
 * 在 Stage 1 完成后展示
 */

import { BarChart3, Brain, Clock, TrendingUp, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { getStudyAnalytics, StudyAnalytics } from "../lib/analytics/stats";

interface AnalyticsDashboardProps {
  onClose: () => void;
}

export function AnalyticsDashboard({ onClose }: AnalyticsDashboardProps) {
  const [analytics, setAnalytics] = useState<StudyAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const data = getStudyAnalytics();
      setAnalytics(data);
    } catch (error) {
      console.error("Failed to load analytics:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="rounded-2xl border border-white/15 bg-[#464949] p-6">
          <p className="text-white">正在加载分析数据...</p>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="rounded-2xl border border-white/15 bg-[#464949] p-6">
          <p className="text-white">无法加载分析数据</p>
          <button onClick={onClose} className="mt-4 rounded-xl bg-[#81D8CF] px-4 py-2 font-bold text-[#2f3333]">
            关闭
          </button>
        </div>
      </div>
    );
  }

  const { studyTime, mastery, errors, efficiency } = analytics;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm">
      <div className="min-h-screen p-4 pb-20">
        <div className="mx-auto max-w-4xl">
          {/* 头部 */}
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/15 bg-[#464949] p-4">
            <div>
              <h1 className="text-xl font-bold text-white">学习分析</h1>
              <p className="mt-1 text-xs text-white/60">今日任务已完成 🎉</p>
            </div>
            <button
              onClick={onClose}
              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-[#3c3f3f] hover:bg-[#4a4f4f]"
            >
              <X size={18} />
            </button>
          </div>

          {/* 学习时长卡片 */}
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
              <div className="flex items-center gap-2 text-white/65">
                <Clock size={17} />
                <p className="text-xs font-bold uppercase tracking-[0.16em]">累计学习</p>
              </div>
              <p className="mt-3 text-3xl font-bold text-white">{studyTime.totalHours}h</p>
              <p className="mt-1 text-xs text-white/50">平均每天 {studyTime.avgDailyMinutes} 分钟</p>
            </div>

            <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
              <div className="flex items-center gap-2 text-white/65">
                <Zap size={17} />
                <p className="text-xs font-bold uppercase tracking-[0.16em]">连续打卡</p>
              </div>
              <p className="mt-3 text-3xl font-bold text-[#81D8CF]">{studyTime.streakDays}</p>
              <p className="mt-1 text-xs text-white/50">天</p>
            </div>

            <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
              <div className="flex items-center gap-2 text-white/65">
                <Brain size={17} />
                <p className="text-xs font-bold uppercase tracking-[0.16em]">记忆力</p>
              </div>
              <p className="mt-3 text-3xl font-bold text-white">{efficiency.memoryStrengthLabel}</p>
              <p className="mt-1 text-xs text-white/50">指数 {efficiency.memoryStrength}</p>
            </div>
          </div>

          {/* JLPT 等级掌握度 */}
          <div className="mb-4 rounded-2xl border border-white/15 bg-[#464949] p-4">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 size={18} className="text-white/65" />
              <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-white/65">JLPT 掌握度</h2>
            </div>
            <div className="space-y-3">
              {mastery.byLevel.map((level) => (
                <div key={level.level}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-bold text-white">{level.level}</span>
                    <span className="text-white/60">
                      {level.mastered}/{level.total} ({level.percentage}%)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#3c3f3f]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#81D8CF] to-[#5fb3a8]"
                      style={{ width: `${level.percentage}%` }}
                    />
                  </div>
                  {mastery.estimatedDaysToComplete[level.level] !== undefined && (
                    <p className="mt-1 text-xs text-white/45">
                      预计 {mastery.estimatedDaysToComplete[level.level]} 天完成
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 学习效率 */}
          <div className="mb-4 rounded-2xl border border-white/15 bg-[#464949] p-4">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-white/65" />
              <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-white/65">学习效率</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-[#3c3f3f] p-3">
                <p className="text-xs text-white/60">平均掌握次数</p>
                <p className="mt-1 text-2xl font-bold text-white">{efficiency.avgReviewsToMaster}</p>
                <p className="mt-1 text-xs text-white/50">次复习后掌握</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#3c3f3f] p-3">
                <p className="text-xs text-white/60">学习速度</p>
                <p className="mt-1 text-2xl font-bold text-white">{efficiency.newWordsPerHour}</p>
                <p className="mt-1 text-xs text-white/50">个新词/小时</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#3c3f3f] p-3">
                <p className="text-xs text-white/60">7天保持率</p>
                <p className="mt-1 text-2xl font-bold text-[#81D8CF]">{efficiency.retentionRate7Days}%</p>
                <p className="mt-1 text-xs text-white/50">7天后还记得</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#3c3f3f] p-3">
                <p className="text-xs text-white/60">效率趋势</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {efficiency.efficiencyTrend === 'improving' && '📈 进步中'}
                  {efficiency.efficiencyTrend === 'stable' && '➡️ 稳定'}
                  {efficiency.efficiencyTrend === 'declining' && '📉 需加强'}
                </p>
              </div>
            </div>
          </div>

          {/* 词性掌握度 */}
          {mastery.byPartOfSpeech.length > 0 && (
            <div className="mb-4 rounded-2xl border border-white/15 bg-[#464949] p-4">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-white/65">词性掌握度</h2>
              <div className="space-y-2">
                {mastery.byPartOfSpeech.map((pos) => (
                  <div key={pos.pos} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#3c3f3f] p-3">
                    <div>
                      <p className="font-bold text-white">{pos.pos}</p>
                      <p className="text-xs text-white/50">{pos.count} 个单词</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-[#81D8CF]">{pos.avgScore.toFixed(1)}</p>
                      <p className="text-xs text-white/50">平均分</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 最困难的单词 */}
          {errors.mostDifficultWords.length > 0 && (
            <div className="mb-4 rounded-2xl border border-white/15 bg-[#464949] p-4">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-white/65">薄弱词汇 TOP 10</h2>
              <div className="space-y-2">
                {errors.mostDifficultWords.slice(0, 10).map((word, index) => (
                  <div key={word.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#3c3f3f] p-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#81D8CF]/20 text-xs font-bold text-[#81D8CF]">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="jp font-bold text-white">{word.kanji}</p>
                      <p className="text-xs text-white/60">{word.meaning}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-400">{word.errorRate}%</p>
                      <p className="text-xs text-white/50">{word.totalReviews}次</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-white/50">错误率 = (忘记×2 + 模糊) / 总复习次数</p>
            </div>
          )}

          {/* 错误类型分布 */}
          <div className="mb-4 rounded-2xl border border-white/15 bg-[#464949] p-4">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-white/65">答题分布</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-center">
                <p className="text-xs text-white/60">忘记</p>
                <p className="mt-1 text-2xl font-bold text-white">{errors.errorTypeDistribution.forgot}</p>
              </div>
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-center">
                <p className="text-xs text-white/60">模糊</p>
                <p className="mt-1 text-2xl font-bold text-white">{errors.errorTypeDistribution.fuzzy}</p>
              </div>
              <div className="rounded-xl border border-[#81D8CF]/20 bg-[#81D8CF]/10 p-3 text-center">
                <p className="text-xs text-white/60">认识</p>
                <p className="mt-1 text-2xl font-bold text-white">{errors.errorTypeDistribution.know}</p>
              </div>
            </div>
          </div>

          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="focus-ring w-full rounded-2xl bg-[#81D8CF] py-4 text-base font-bold text-[#2f3333]"
          >
            继续学习
          </button>
        </div>
      </div>
    </div>
  );
}
