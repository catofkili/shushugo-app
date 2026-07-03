import { useState } from "react";
import { Brain, CalendarDays, CheckCircle2, Clock3, Download, Share2, X } from "lucide-react";
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
  onCheckIn?: () => void;
  onContinueStage2?: () => void;
  onContinueKanji?: () => void;
}

export const FinishPanel = ({ stats, phase, localSeconds, onCheckIn, onContinueStage2, onContinueKanji }: FinishPanelProps) => {
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState("");
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

  const drawRoundRect = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
  };

  const generateShareImage = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#f7fbfa";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#d9f5ef";
    context.fillRect(0, 0, canvas.width, 300);

    context.fillStyle = "#234440";
    context.font = "700 52px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillText("今日单词完成", 84, 145);
    context.font = "500 30px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillStyle = "#4d706b";
    context.fillText(studyDate, 86, 198);

    const statItems = [
      { label: "背诵数量", value: `${todayWordCount} 个` },
      { label: "背词用时", value: formatDuration(totalSeconds) },
      { label: "累计打卡", value: `${checkinDays} 天` }
    ];
    statItems.forEach((item, index) => {
      const x = 84 + index * 310;
      drawRoundRect(context, x, 270, 270, 150, 28);
      context.fillStyle = "#ffffff";
      context.fill();
      context.strokeStyle = "#b7e7df";
      context.lineWidth = 3;
      context.stroke();
      context.fillStyle = "#6d8581";
      context.font = "600 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      context.fillText(item.label, x + 30, 325);
      context.fillStyle = "#234440";
      context.font = "800 40px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      context.fillText(item.value, x + 30, 385);
    });

    drawRoundRect(context, 84, 500, 912, 690, 36);
    context.fillStyle = "#ffffff";
    context.fill();
    context.strokeStyle = "#c7ece5";
    context.lineWidth = 3;
    context.stroke();

    context.fillStyle = "#234440";
    context.font = "800 38px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillText(calendar.title, 134, 575);
    context.font = "600 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillStyle = "#5d7772";
    context.fillText(checkedToday ? "今日已打卡" : "今日未打卡", 790, 575);

    const labels = ["日", "一", "二", "三", "四", "五", "六"];
    labels.forEach((label, index) => {
      context.fillStyle = "#7b918d";
      context.font = "700 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      context.textAlign = "center";
      context.fillText(label, 154 + index * 126, 645);
    });

    calendar.cells.forEach((cell, index) => {
      if (!cell) return;
      const column = index % 7;
      const row = Math.floor(index / 7);
      const x = 154 + column * 126;
      const y = 710 + row * 76;
      const dayChecked = checkins.has(cell.date);
      const isToday = cell.date === studyDate;
      context.beginPath();
      context.arc(x, y, 31, 0, Math.PI * 2);
      context.fillStyle = dayChecked ? "#81d8cf" : isToday ? "#e3f7f3" : "#f3f6f5";
      context.fill();
      if (isToday) {
        context.strokeStyle = "#234440";
        context.lineWidth = 4;
        context.stroke();
      }
      context.fillStyle = dayChecked ? "#173d38" : "#5a716d";
      context.font = "800 25px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      context.fillText(String(cell.day), x, y + 9);
    });
    context.textAlign = "left";

    context.fillStyle = "#4d706b";
    context.font = "600 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillText("Master Nihongo", 84, 1300);
    context.fillStyle = "#234440";
    context.font = "800 34px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillText("今天也把日语往前推了一点。", 84, 1355);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    const file = new File([blob], `master-nihongo-${studyDate}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "今日单词完成" });
      return;
    }
    const url = URL.createObjectURL(blob);
    if (shareImageUrl) URL.revokeObjectURL(shareImageUrl);
    setShareImageUrl(url);
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "今日单词完成" }).catch(() => undefined);
    }
  };

  const closeShareImage = () => {
    if (shareImageUrl) URL.revokeObjectURL(shareImageUrl);
    setShareImageUrl("");
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

      {shareImageUrl && (
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
            <img src={shareImageUrl} alt="今日单词完成分享图" className="max-h-[70vh] w-full rounded-xl object-contain" />
            <a
              href={shareImageUrl}
              download={`master-nihongo-${studyDate}.png`}
              className="focus-ring mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#81D8CF] text-sm font-bold !text-[#2f3333]"
            >
              <Download size={16} />
              保存图片
            </a>
          </div>
        </div>
      )}

      {showAnalytics && <AnalyticsDashboard onClose={() => setShowAnalytics(false)} />}
    </>
  );
};
