/**
 * 学习记忆程度气泡
 * 在 Stage 1 完成页轻量展示，不再进入完整分析界面。
 */

import { Brain, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getStudyAnalytics, StudyAnalytics } from "../lib/analytics/stats";

interface AnalyticsDashboardProps {
  onClose: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function AnalyticsDashboard({ onClose }: AnalyticsDashboardProps) {
  const [analytics, setAnalytics] = useState<StudyAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      setAnalytics(getStudyAnalytics());
    } catch (error) {
      console.error("Failed to load memory analytics:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const memoryStats = useMemo(() => {
    if (!analytics) return null;
    const reviewedWords = analytics.mastery.byLevel.reduce((sum, level) => sum + level.total, 0);
    const masteredWords = analytics.mastery.byLevel.reduce((sum, level) => sum + level.mastered, 0);
    const reviewActions =
      analytics.errors.errorTypeDistribution.forgot +
      analytics.errors.errorTypeDistribution.fuzzy +
      analytics.errors.errorTypeDistribution.know;
    const memoryStrength = clamp(analytics.efficiency.memoryStrength, 0, 2);
    const memoryPercent = Math.round((memoryStrength / 2) * 100);
    const masteredPercent = reviewedWords > 0 ? Math.round((masteredWords / reviewedWords) * 100) : 0;

    return {
      reviewedWords,
      masteredWords,
      reviewActions,
      memoryPercent,
      masteredPercent,
      retentionRate: analytics.efficiency.retentionRate7Days,
      label: analytics.efficiency.memoryStrengthLabel
    };
  }, [analytics]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-5 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="学习记忆程度"
      onClick={onClose}
    >
      <div
        className="memory-bubble relative w-full max-w-[360px] rounded-[42px] border border-[#81D8CF]/35 bg-[#f8fdfb] p-6 text-left text-[#163f35] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="focus-ring absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full border border-[#81D8CF]/30 bg-white/78 text-[#2d6b56]"
          title="关闭"
          aria-label="关闭学习记忆程度"
        >
          <X size={15} />
        </button>

        <div className="grid h-16 w-16 place-items-center rounded-full bg-[#81D8CF]/20 text-[#1e6a5f] ring-1 ring-[#81D8CF]/35">
          <Brain size={30} />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#4d8378]">Memory</p>
        <h2 className="mt-1 text-2xl font-black leading-tight">学习记忆程度</h2>

        {loading && <p className="mt-5 text-sm font-semibold text-[#4d706b]">正在读取你的学习记录...</p>}

        {!loading && !memoryStats && (
          <p className="mt-5 text-sm font-semibold text-[#4d706b]">暂时没有可用的记忆数据。</p>
        )}

        {memoryStats && (
          <>
            <div className="mt-6 flex items-end gap-3">
              <span className="text-6xl font-black leading-none text-[#163f35]">{memoryStats.memoryPercent}</span>
              <span className="pb-2 text-lg font-black text-[#2d6b56]">/ 100</span>
            </div>
            <p className="mt-2 text-xl font-black text-[#1e6a5f]">{memoryStats.label}</p>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-[#d7eee9]">
              <div
                className="h-full rounded-full bg-[#81D8CF] shadow-[0_0_18px_rgba(129,216,207,0.5)]"
                style={{ width: `${memoryStats.memoryPercent}%` }}
              />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2">
              <div className="rounded-3xl border border-[#81D8CF]/24 bg-white/70 p-3">
                <p className="text-[11px] font-bold text-[#5a837b]">已学习词</p>
                <p className="mt-1 text-xl font-black text-[#163f35]">{memoryStats.reviewedWords}</p>
              </div>
              <div className="rounded-3xl border border-[#81D8CF]/24 bg-white/70 p-3">
                <p className="text-[11px] font-bold text-[#5a837b]">已掌握</p>
                <p className="mt-1 text-xl font-black text-[#163f35]">
                  {memoryStats.masteredWords}
                  <span className="ml-1 text-sm text-[#4d706b]">{memoryStats.masteredPercent}%</span>
                </p>
              </div>
              <div className="rounded-3xl border border-[#81D8CF]/24 bg-white/70 p-3">
                <p className="text-[11px] font-bold text-[#5a837b]">复习记录</p>
                <p className="mt-1 text-xl font-black text-[#163f35]">{memoryStats.reviewActions}</p>
              </div>
              <div className="rounded-3xl border border-[#81D8CF]/24 bg-white/70 p-3">
                <p className="text-[11px] font-bold text-[#5a837b]">7日保持</p>
                <p className="mt-1 text-xl font-black text-[#163f35]">{memoryStats.retentionRate}%</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
