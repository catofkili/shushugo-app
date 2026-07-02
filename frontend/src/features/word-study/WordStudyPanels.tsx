import { useState } from "react";
import { BarChart3, CalendarDays, Clock3 } from "lucide-react";
import { AnalyticsDashboard } from "../../components/AnalyticsDashboard";
import { studyDate as currentStudyDate } from "../../lib/database/db-utils";
import type { WordCard, WordStats } from "../../types/vocabulary";
import { formatDuration, isLoanwordSourceCard, monthDays } from "./word-study-utils";

export const KanjiAnswer = ({ card }: { card: WordCard }) => {
  if (isLoanwordSourceCard(card)) return <>{card.kana}</>;

  const componentByChar = new Map((card.kanjiComponents ?? []).map((component) => [component.char, component]));

  return (
    <>
      {[...card.kanji].map((char, index) => {
        const component = componentByChar.get(char);
        const isVariant = Boolean(component?.marked);
        return (
          <span
            key={`${char}-${index}`}
            className={isVariant ? "kanji-variant-mark" : undefined}
            title={isVariant && component ? `${component.char} → ${component.simplified}` : undefined}
          >
            {char}
          </span>
        );
      })}
    </>
  );
};

interface FinishPanelProps {
  stats: WordStats | null;
  phase: string;
  localSeconds: number;
  onContinueStage2?: () => void;
  onContinueKanji?: () => void;
}

export const FinishPanel = ({ stats, phase, localSeconds, onContinueStage2, onContinueKanji }: FinishPanelProps) => {
  const [showAnalytics, setShowAnalytics] = useState(false);
  const studyDate = stats?.studyDate ?? currentStudyDate();
  const calendar = monthDays(studyDate);
  const checkins = new Set(stats?.checkins ?? []);
  const dailyStats = new Map((stats?.dailyStudyStats ?? []).map((item) => [item.date, item]));
  const totalSeconds = (stats?.wordStudySecondsToday ?? 0) + localSeconds;
  const isStage1Complete = phase === "stage1" && stats?.stage1Done;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/15 bg-[#464949] p-4 text-center sm:p-5">
        <div className="mx-auto w-full max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">Daily Complete</p>
          <h2 className="mt-3 text-3xl font-semibold">今日单词完成</h2>
          <div className="mx-auto mt-4 grid max-w-lg gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-3 text-left sm:p-4">
              <div className="flex items-center gap-2 text-white/65">
                <Clock3 size={17} />
                <p className="text-xs font-bold uppercase tracking-[0.16em]">背词用时</p>
              </div>
              <p className="mt-3 text-2xl font-semibold">{formatDuration(totalSeconds)}</p>
              <p className="mt-2 text-xs text-white/55">只统计单词学习页打开期间</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-3 text-left sm:p-4">
              <div className="flex items-center gap-2 text-white/65">
                <CalendarDays size={17} />
                <p className="text-xs font-bold uppercase tracking-[0.16em]">打卡状态</p>
              </div>
              <p className="mt-3 text-2xl font-semibold">{checkins.has(studyDate) ? "已打卡" : "待打卡"}</p>
              <p className="mt-2 text-xs text-white/55">学习日：{studyDate}</p>
            </div>
          </div>

          {isStage1Complete && (
            <div className="mx-auto mt-4 grid max-w-lg gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={onContinueStage2}
                  disabled={!onContinueStage2 || !stats?.stage2Total || stats.stage2Completed >= stats.stage2Total}
                  className="focus-ring rounded-2xl border border-[#81D8CF]/30 bg-[#81D8CF]/12 p-4 text-left disabled:opacity-45"
                >
                  <p className="font-bold text-white">反向学习</p>
                  <p className="mt-1 text-xs text-white/60">出日语，回忆释义 {stats?.stage2Completed ?? 0}/{stats?.stage2Total ?? 0}</p>
                </button>
                <button
                  onClick={onContinueKanji}
                  disabled={!onContinueKanji || Boolean(stats?.kanjiTotal && stats.kanjiCompleted >= stats.kanjiTotal)}
                  className="focus-ring rounded-2xl border border-[#81D8CF]/30 bg-[#81D8CF]/12 p-4 text-left disabled:opacity-45"
                >
                  <p className="font-bold text-white">汉字学习</p>
                  <p className="mt-1 text-xs text-white/60">
                    {stats?.kanjiTotal ? `看释义，回忆汉字 ${stats.kanjiCompleted}/${stats.kanjiTotal}` : "生成今日汉字队列后开始"}
                  </p>
                </button>
              </div>
              <button
                onClick={() => setShowAnalytics(true)}
                className="focus-ring w-full rounded-2xl border border-[#81D8CF]/30 bg-[#81D8CF]/10 p-4 text-left transition-all hover:bg-[#81D8CF]/20"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20">
                    <BarChart3 size={22} className="text-[#81D8CF]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-white">查看学习分析</p>
                    <p className="mt-0.5 text-xs text-white/60">了解你的学习进度和薄弱点</p>
                  </div>
                  <span className="text-2xl">📊</span>
                </div>
              </button>
            </div>
          )}

          <div className="mx-auto mt-4 max-w-lg rounded-2xl border border-white/15 bg-[#3f4343] p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-semibold">{calendar.title}</p>
              <p className="text-xs text-white/55">phase: {phase}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#343838] p-3">
              <div className="grid grid-cols-7 gap-1 text-xs">
                {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
                  <span key={label} className="grid h-7 place-items-center text-white/45">{label}</span>
                ))}
                {calendar.cells.map((cell, index) => {
                  if (!cell) return <span key={`empty-${index}`} className="h-10" />;
                  const checked = checkins.has(cell.date);
                  const isToday = cell.date === studyDate;
                  const dayStats = dailyStats.get(cell.date);
                  const daySeconds = (dayStats?.seconds ?? 0) + (isToday ? localSeconds : 0);
                  const wordCount = dayStats?.wordCount ?? 0;
                  const hasActivity = checked || daySeconds > 0 || wordCount > 0;
                  return (
                    <span
                      key={cell.date}
                      className="group relative grid h-10 place-items-center"
                      tabIndex={0}
                      aria-label={`${cell.date}，学习时间 ${formatDuration(daySeconds)}，单词 ${wordCount} 个`}
                    >
                      <span
                        className={`grid h-8 w-8 place-items-center rounded-full border text-sm font-semibold ${
                          checked
                            ? "border-[#81D8CF] bg-[#81D8CF]/18 text-white shadow-[0_0_0_3px_rgba(129,216,207,0.12)]"
                            : hasActivity
                              ? "border-white/10 bg-white/10 text-white/70"
                              : "border-transparent text-white/55"
                        } ${isToday ? "shadow-[0_0_0_3px_rgba(129,216,207,0.35)]" : ""}`}
                      >
                        {cell.day}
                      </span>
                      <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 hidden w-44 -translate-y-1/2 rounded-2xl border border-white/15 bg-[#202323] p-3 text-left shadow-xl group-hover:block group-focus:block">
                        <span className="block text-xs font-bold text-white/85">{cell.date}</span>
                        <span className="mt-2 block text-xs text-white/65">学习时间：{formatDuration(daySeconds)}</span>
                        <span className="mt-1 block text-xs text-white/65">学习单词：{wordCount} 个</span>
                        <span className="mt-1 block text-xs text-white/45">{checked ? "已打卡" : "未打卡"}</span>
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAnalytics && <AnalyticsDashboard onClose={() => setShowAnalytics(false)} />}
    </>
  );
};
