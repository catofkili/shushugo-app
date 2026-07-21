import { useState } from "react";
import { Brain, CalendarDays, CheckCircle2, Clock3, ImageDown, Loader2, Minus, Pencil, Plus, Share2, X } from "lucide-react";
import { AnalyticsDashboard } from "../../components/AnalyticsDashboard";
import { estimatedMinutesFor } from "../../lib/comeback";
import { studyDate as currentStudyDate } from "../../lib/database/db-utils";
import { saveImageToGallery, shareImage } from "../../lib/share-image";
import {
  getStudyPreferences,
  INTENSITY_ANCHORS,
  INTENSITY_MAX,
  INTENSITY_MIN,
  saveStudyPreferences
} from "../../lib/studyPreferences";
import type { WordCard, WordStats } from "../../types/vocabulary";
import { encoreDayColor, MILESTONES, pickEncoreHook } from "./encore-style";
import { renderShareCard } from "./share-card";
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
  onCheckIn?: () => void;
  onContinueStage2?: () => void;
  onContinueKanji?: () => void;
  onEncore?: (size?: number) => void;
}

export const FinishPanel = ({ stats, phase, localSeconds, onCheckIn, onContinueStage2, onContinueKanji, onEncore }: FinishPanelProps) => {
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [shareCard, setShareCard] = useState<{ url: string; blob: Blob } | null>(null);
  const [shareBusy, setShareBusy] = useState<"save" | "share" | null>(null);
  const [shareNotice, setShareNotice] = useState("");
  const studyDate = stats?.studyDate ?? currentStudyDate();
  const calendar = monthDays(studyDate);
  const checkins = new Set(stats?.checkins ?? []);
  const dailyStats = new Map((stats?.dailyStudyStats ?? []).map((item) => [item.date, item]));
  const totalSeconds = (stats?.wordStudySecondsToday ?? 0) + localSeconds;
  const todayStats = dailyStats.get(studyDate);
  const todayWordCount = todayStats?.wordCount ?? stats?.reviewedToday ?? 0;
  const checkedToday = checkins.has(studyDate);
  const checkinDays = checkins.size;
  const isStage1Complete = phase === "stage1" && stats?.stage1Done;
  const compactPhaseLabel = phase === "done" ? "全部完成" : phase === "stage1" ? "第一阶段" : phase;
  const encore = stats?.encore;
  const showEncore = phase === "done" && Boolean(encore?.available) && Boolean(onEncore);

  // 「继续学习」按钮的每日装扮与数量。数量由算法给:积压递减批或强度的一半;
  // 铅笔调的是唯一旋钮「学习强度」,不再单独设本次数量。
  const [showIntensityPanel, setShowIntensityPanel] = useState(false);
  const [intensity, setIntensity] = useState(() => getStudyPreferences().dailyGoal);
  const encoreColor = encoreDayColor(studyDate);
  const encoreInventory = encore ? encore.remaining + encore.unseenRemaining : 0;
  // 积压未清时数量跟积压走(强度不影响);清空后 = 强度的一半,随滑杆即时变化
  const recommendedSize = encore
    ? (encore.remaining > 0 ? encore.size : Math.min(Math.max(Math.round(intensity / 2), 5), encore.unseenRemaining))
    : 0;
  const encoreHook = encore
    ? pickEncoreHook({
        studyDate,
        todayWordCount,
        weekEncoreCount: encore.weekEncoreCount,
        recommendedSize,
        totalLearned: encore.totalLearned
      })
    : null;
  const encoreCount = Math.max(1, Math.min(encoreHook?.suggestedSize ?? recommendedSize, encoreInventory));
  const encoreMinutes = encore ? estimatedMinutesFor(encoreCount, encore.secondsPerWord) : 0;

  const applyIntensity = (value: number) => {
    const next = Math.min(Math.max(Math.round(value), INTENSITY_MIN), INTENSITY_MAX);
    setIntensity(next);
    saveStudyPreferences({ ...getStudyPreferences(), dailyGoal: next });
  };

  const shareFileName = `master-nihongo-${studyDate}.png`;

  const generateShareImage = async () => {
    // 今天是否冲破了某个累计里程碑(今天学之前 < 里程碑 ≤ 现在)
    const totalLearned = encore?.totalLearned ?? 0;
    const milestoneReached = MILESTONES.find(
      (m) => totalLearned >= m && totalLearned - todayWordCount < m
    ) ?? 0;
    const blob = await renderShareCard({
      studyDate,
      todayWordCount,
      totalSeconds,
      checkins,
      encoreWords: encore?.todayEncoreWords ?? 0,
      milestoneReached
    });
    if (shareCard) URL.revokeObjectURL(shareCard.url);
    setShareNotice("");
    setShareCard({ url: URL.createObjectURL(blob), blob });
  };

  const handleSaveImage = async () => {
    if (!shareCard || shareBusy) return;
    setShareBusy("save");
    setShareNotice("");
    try {
      const result = await saveImageToGallery(shareCard.blob, shareFileName);
      setShareNotice(result === "gallery" ? "已保存到相册 ✓" : "已开始下载 ✓");
    } catch {
      setShareNotice("保存失败,请在 设置 > Master Nihongo 里允许访问相册后重试");
    } finally {
      setShareBusy(null);
    }
  };

  const handleShareImage = async () => {
    if (!shareCard || shareBusy) return;
    setShareBusy("share");
    setShareNotice("");
    try {
      const result = await shareImage(shareCard.blob, shareFileName, "今日单词完成");
      if (result === "unsupported") setShareNotice("当前浏览器不支持直接分享,请先保存图片");
    } catch {
      setShareNotice("分享失败,请重试");
    } finally {
      setShareBusy(null);
    }
  };

  const closeShareImage = () => {
    if (shareCard) URL.revokeObjectURL(shareCard.url);
    setShareCard(null);
    setShareNotice("");
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-1 text-center sm:p-2">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-3">
          <div className="flex shrink-0 items-center justify-between gap-3 text-left">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Daily Complete</p>
              <h2 className="mt-1 text-2xl font-semibold sm:text-3xl">今日单词完成</h2>
            </div>
            <span className="shrink-0 rounded-full border border-[#81D8CF]/35 bg-[#81D8CF]/14 px-3 py-1 text-xs font-bold text-[#81D8CF]">
              {compactPhaseLabel}
            </span>
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-2">
            <div className="rounded-xl bg-[#373b3b] px-3 py-2 text-left ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 text-white/58">
                <Clock3 size={14} />
                <p className="text-[11px] font-bold">用时</p>
              </div>
              <p className="mt-1 truncate text-base font-semibold">{formatDuration(totalSeconds)}</p>
            </div>
            <div className="rounded-xl bg-[#373b3b] px-3 py-2 text-left ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 text-white/58">
                <CalendarDays size={14} />
                <p className="text-[11px] font-bold">单词</p>
              </div>
              <p className="mt-1 truncate text-base font-semibold">{todayWordCount} 个</p>
            </div>
            <div className="rounded-xl bg-[#373b3b] px-3 py-2 text-left ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 text-white/58">
                <CheckCircle2 size={14} />
                <p className="text-[11px] font-bold">累计</p>
              </div>
              <p className="mt-1 truncate text-base font-semibold">{checkinDays} 天</p>
            </div>
          </div>

          <div className="rounded-2xl bg-[#3f4343] p-3 ring-1 ring-white/10 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-left">
                <p className="font-semibold">{calendar.title}</p>
                <p className="mt-0.5 text-xs text-white/50">学习日：{studyDate}</p>
              </div>
              <button
                onClick={onCheckIn}
                disabled={checkedToday || !onCheckIn}
                className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#81D8CF]/35 bg-[#81D8CF]/14 px-3 text-xs font-bold text-[#81D8CF] disabled:opacity-70"
              >
                <CheckCircle2 size={14} />
                {checkedToday ? "已打卡" : "打卡"}
              </button>
            </div>
            <div className="rounded-xl bg-[#343838] p-2 sm:p-2.5">
              <div className="grid grid-cols-7 gap-1 text-xs">
                {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
                  <span key={label} className="grid h-6 place-items-center text-white/45">{label}</span>
                ))}
                {calendar.cells.map((cell, index) => {
                  if (!cell) return <span key={`empty-${index}`} className="h-7 sm:h-8" />;
                  const checked = checkins.has(cell.date);
                  const isToday = cell.date === studyDate;
                  const dayStats = dailyStats.get(cell.date);
                  const daySeconds = (dayStats?.seconds ?? 0) + (isToday ? localSeconds : 0);
                  const wordCount = dayStats?.wordCount ?? 0;
                  const hasActivity = checked || daySeconds > 0 || wordCount > 0;
                  return (
                    <span
                      key={cell.date}
                      className="group relative grid h-7 place-items-center sm:h-8"
                      tabIndex={0}
                      aria-label={`${cell.date}，学习时间 ${formatDuration(daySeconds)}，单词 ${wordCount} 个`}
                    >
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ring-1 sm:h-7 sm:w-7 sm:text-xs ${
                          checked
                            ? "bg-[#81D8CF]/18 text-white ring-[#81D8CF] shadow-[0_0_0_3px_rgba(129,216,207,0.12)]"
                            : hasActivity
                              ? "bg-white/10 text-white/70 ring-white/10"
                              : "text-white/55 ring-transparent"
                        } ${isToday ? "shadow-[0_0_0_3px_rgba(129,216,207,0.35)]" : ""}`}
                      >
                        {cell.day}
                      </span>
                      <span className="study-calendar-tooltip pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-44 -translate-x-1/2 rounded-2xl border border-white/15 bg-[#202323] p-3 text-left shadow-xl group-hover:block group-focus:block">
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

          {showEncore && encore && (
            <div className="shrink-0 rounded-2xl bg-[#3f4343] p-3 text-left ring-1 ring-white/10 sm:p-4">
              {encore.fatigued ? (
                <>
                  <p className="mb-2 text-xs text-white/60">最近的正确率有点下滑——今天已经很棒了，剩下的词明天清效率更高。</p>
                  <button
                    onClick={() => onEncore?.(encoreCount)}
                    className="focus-ring inline-flex h-11 w-full items-center justify-center rounded-2xl border border-white/20 bg-white/8 text-sm font-bold text-white/75"
                  >
                    仍要再来 {encoreCount} 个 · 约 {encoreMinutes} 分钟
                  </button>
                </>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs text-white/60">
                      {encoreHook?.lead}
                      {stats?.comeback?.active && ` · 回归计划 第 ${stats.comeback.dayIndex}/${stats.comeback.planDays} 天`}
                    </p>
                    <span
                      className="shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold"
                      style={{ color: encoreColor.hex, borderColor: `${encoreColor.hex}59` }}
                    >
                      {encoreColor.weekdayJp}・{encoreColor.colorName}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onEncore?.(encoreCount)}
                      className="encore-cta focus-ring relative inline-flex h-14 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-2xl text-lg font-bold"
                      style={{ backgroundColor: encoreColor.hex, color: encoreColor.ink }}
                    >
                      继续学习 {encoreCount} 个 · 约 {encoreMinutes} 分钟
                      <span className="encore-shine" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => setShowIntensityPanel((value) => !value)}
                      aria-label="调整学习强度"
                      aria-expanded={showIntensityPanel}
                      className="focus-ring grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/8 text-white/75"
                    >
                      <Pencil size={18} />
                    </button>
                  </div>
                  {showIntensityPanel && (
                    <div className="mt-2 rounded-xl bg-[#343838] p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-white/70">学习强度 · 每日新词 {intensity} 个</p>
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => applyIntensity(intensity - 1)}
                            aria-label="强度减 1"
                            className="focus-ring grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/8 text-white/70"
                          >
                            <Minus size={13} />
                          </button>
                          <button
                            onClick={() => applyIntensity(intensity + 1)}
                            aria-label="强度加 1"
                            className="focus-ring grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/8 text-white/70"
                          >
                            <Plus size={13} />
                          </button>
                        </span>
                      </div>
                      <input
                        type="range"
                        min={INTENSITY_MIN}
                        max={INTENSITY_MAX}
                        step={1}
                        value={intensity}
                        onChange={(event) => applyIntensity(Number(event.target.value))}
                        aria-label="学习强度"
                        className="w-full accent-[#81D8CF]"
                        style={{ accentColor: encoreColor.hex }}
                      />
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {INTENSITY_ANCHORS.map((anchor) => (
                          <button
                            key={anchor.value}
                            onClick={() => applyIntensity(anchor.value)}
                            className={`focus-ring h-8 rounded-full px-3 text-xs font-bold ${
                              intensity === anchor.value
                                ? "text-[#2f3333]"
                                : "border border-white/15 bg-white/8 text-white/70"
                            }`}
                            style={intensity === anchor.value ? { backgroundColor: encoreColor.hex } : undefined}
                          >
                            {anchor.label} {anchor.value}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-white/45">
                        明日新词按此配额;{encore.remaining > 0
                          ? "本次加餐清积压,数量不受强度影响"
                          : `本次加餐 = 强度一半 ≈ ${recommendedSize} 个`}
                      </p>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-white/40">
                    {encore.remaining > 0
                      ? `待清积压还剩 ${encore.remaining} 个,优先复习`
                      : `积压已清空,这批是新词 · 库存 ${encore.unseenRemaining} 个`}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="grid shrink-0 gap-2 sm:grid-cols-3">
            {isStage1Complete && (
              <>
                <button
                  onClick={onContinueStage2}
                  disabled={!onContinueStage2 || !stats?.stage2Total || stats.stage2Completed >= stats.stage2Total}
                  className="focus-ring rounded-xl border border-[#81D8CF]/30 bg-[#81D8CF]/12 p-3 text-left disabled:opacity-45"
                >
                  <p className="text-sm font-bold text-white">反向学习</p>
                  <p className="mt-1 text-xs text-white/60">出日语，回忆释义 {stats?.stage2Completed ?? 0}/{stats?.stage2Total ?? 0}</p>
                </button>
                <button
                  onClick={onContinueKanji}
                  disabled={!onContinueKanji || Boolean(stats?.kanjiTotal && stats.kanjiCompleted >= stats.kanjiTotal)}
                  className="focus-ring rounded-xl border border-[#81D8CF]/30 bg-[#81D8CF]/12 p-3 text-left disabled:opacity-45"
                >
                  <p className="text-sm font-bold text-white">汉字学习</p>
                  <p className="mt-1 text-xs text-white/60">
                    {stats?.kanjiTotal ? `看释义，回忆汉字 ${stats.kanjiCompleted}/${stats.kanjiTotal}` : "生成今日汉字队列后开始"}
                  </p>
                </button>
              </>
            )}
            <button
              onClick={() => setShowAnalytics(true)}
              className="focus-ring rounded-xl border border-[#81D8CF]/30 bg-[#81D8CF]/10 p-3 text-left transition-all hover:bg-[#81D8CF]/20"
            >
              <div className="flex items-center gap-2">
                <Brain size={17} className="text-[#81D8CF]" />
                <span>
                  <span className="block text-sm font-bold text-white">记忆程度</span>
                  <span className="mt-0.5 block text-xs text-white/60">基于实际复习数据</span>
                </span>
              </div>
            </button>
            <button
              onClick={() => void generateShareImage()}
              className="focus-ring rounded-xl border border-[#81D8CF]/30 bg-[#81D8CF]/10 p-3 text-left transition-all hover:bg-[#81D8CF]/20"
            >
              <div className="flex items-center gap-2">
                <Share2 size={17} className="text-[#81D8CF]" />
                <span>
                  <span className="block text-sm font-bold text-white">生成炫耀图</span>
                  <span className="mt-0.5 block text-xs text-white/60">数量、用时、打卡</span>
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {shareCard && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#2f3333] p-3 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-white">今日炫耀图</p>
              <button
                onClick={closeShareImage}
                className="focus-ring grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/8 text-white"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>
            <img src={shareCard.url} alt="今日单词完成分享图" className="max-h-[62vh] w-full rounded-xl object-contain" />
            {shareNotice && <p className="mt-2 text-center text-xs font-semibold text-[#81D8CF]">{shareNotice}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => void handleSaveImage()}
                disabled={shareBusy !== null}
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#81D8CF]/40 bg-[#81D8CF]/14 text-sm font-bold text-[#81D8CF] disabled:opacity-60"
              >
                {shareBusy === "save" ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />}
                保存到相册
              </button>
              <button
                onClick={() => void handleShareImage()}
                disabled={shareBusy !== null}
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#81D8CF] text-sm font-bold !text-[#2f3333] disabled:opacity-60"
              >
                {shareBusy === "share" ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
                发给好友
              </button>
            </div>
          </div>
        </div>
      )}

      {showAnalytics && <AnalyticsDashboard onClose={() => setShowAnalytics(false)} />}
    </>
  );
};
