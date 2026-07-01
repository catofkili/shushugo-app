import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarDays, Clock3, Eye, RotateCcw, Settings, StickyNote, X } from "lucide-react";
import { WordAnswer, WordCard, WordSessionResponse, WordStats } from "../types/vocabulary";

const answerOptions: { value: WordAnswer; label: string }[] = [
  { value: "forgot", label: "忘记" },
  { value: "fuzzy", label: "模糊" },
  { value: "know", label: "认识" },
  { value: "known_forever", label: "熟知" }
];

const hasAscii = (text: string) => /[A-Za-z]/.test(text);
const hasKatakana = (text: string) => /[\u30a0-\u30ff]/.test(text);

const isLoanwordSourceCard = (card: WordCard) => hasAscii(card.kanji) && hasKatakana(card.kana);

const primaryAnswerText = (card: WordCard) => isLoanwordSourceCard(card) ? card.kana : card.kanji;

const secondaryAnswerText = (card: WordCard) => {
  if (isLoanwordSourceCard(card)) return card.kanji;
  return card.kana;
};

const cardLabel = (card: WordCard) => {
  const primary = primaryAnswerText(card);
  const secondary = secondaryAnswerText(card);
  return primary === secondary ? primary : `${primary} / ${secondary}`;
};

const answerReadingText = (card: WordCard) => {
  const primary = primaryAnswerText(card);
  const secondary = secondaryAnswerText(card);
  if (!secondary || secondary === primary || hasAscii(secondary)) return "";
  return secondary;
};

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return `${hours}小时${restMinutes.toString().padStart(2, "0")}分`;
  }
  if (minutes > 0) return `${minutes}分${remainder.toString().padStart(2, "0")}秒`;
  return `${remainder}秒`;
};

const monthDays = (studyDate: string) => {
  const base = studyDate ? new Date(`${studyDate}T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = Array.from({ length: firstDay.getDay() }, () => null);
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return {
      day,
      date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    };
  });
  return {
    title: `${year}年${month + 1}月`,
    cells: [...prefix, ...days]
  };
};

const KanjiAnswer = ({ card }: { card: WordCard }) => {
  if (isLoanwordSourceCard(card)) {
    return <>{card.kana}</>;
  }

  const components = card.kanjiComponents ?? [];
  const componentByChar = new Map(components.map((component) => [component.char, component]));

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

const FinishPanel = ({
  stats,
  phase,
  localSeconds,
  onContinueStage2,
  onContinueKanji
}: {
  stats: WordStats | null;
  phase: string;
  localSeconds: number;
  onContinueStage2?: () => void;
  onContinueKanji?: () => void;
}) => {
  const studyDate = stats?.studyDate ?? new Date().toISOString().slice(0, 10);
  const calendar = monthDays(studyDate);
  const checkins = new Set(stats?.checkins ?? []);
  const dailyStats = new Map((stats?.dailyStudyStats ?? []).map((item) => [item.date, item]));
  const totalSeconds = (stats?.wordStudySecondsToday ?? 0) + localSeconds;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-white/15 bg-[#464949] p-4 text-center sm:p-5">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">Daily Complete</p>
        <h2 className="mt-3 text-3xl font-semibold">今日单词完成</h2>
        <div className="mx-auto mt-4 grid max-w-lg gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-white/15 bg-[#373b3b] p-3 text-left sm:p-4">
            <div className="flex items-center gap-2 text-white/65">
              <Clock3 size={17} />
              <p className="text-xs font-bold uppercase tracking-[0.16em]">背词用时</p>
            </div>
            <p className="mt-3 text-2xl font-semibold">{formatDuration(totalSeconds)}</p>
            <p className="mt-2 text-xs text-white/55">只统计单词学习页打开期间</p>
          </div>
          <div className="rounded-md border border-white/15 bg-[#373b3b] p-3 text-left sm:p-4">
            <div className="flex items-center gap-2 text-white/65">
              <CalendarDays size={17} />
              <p className="text-xs font-bold uppercase tracking-[0.16em]">打卡状态</p>
            </div>
            <p className="mt-3 text-2xl font-semibold">{checkins.has(studyDate) ? "已打卡" : "待打卡"}</p>
            <p className="mt-2 text-xs text-white/55">学习日：{studyDate}</p>
          </div>
        </div>

        {stats?.stage1Done && (
          <div className="mx-auto mt-4 grid max-w-lg gap-2 sm:grid-cols-2">
            <button
              onClick={onContinueStage2}
              disabled={!onContinueStage2 || !stats.stage2Total || stats.stage2Completed >= stats.stage2Total}
              className="focus-ring rounded-md border border-[#81D8CF]/30 bg-[#81D8CF]/12 p-4 text-left disabled:opacity-45"
            >
              <p className="font-bold text-white">反向学习</p>
              <p className="mt-1 text-xs text-white/60">出日语，回忆释义 {stats.stage2Completed}/{stats.stage2Total}</p>
            </button>
            <button
              onClick={onContinueKanji}
              disabled={!onContinueKanji || (stats.kanjiTotal > 0 && stats.kanjiCompleted >= stats.kanjiTotal)}
              className="focus-ring rounded-md border border-[#81D8CF]/30 bg-[#81D8CF]/12 p-4 text-left disabled:opacity-45"
            >
              <p className="font-bold text-white">汉字学习</p>
              <p className="mt-1 text-xs text-white/60">
                {stats.kanjiTotal > 0 ? `看释义，回忆汉字 ${stats.kanjiCompleted}/${stats.kanjiTotal}` : "生成今日汉字队列后开始"}
              </p>
            </button>
          </div>
        )}

        <div className="mx-auto mt-4 max-w-lg rounded-md border border-white/15 bg-[#3f4343] p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="font-semibold">{calendar.title}</p>
            <p className="text-xs text-white/55">phase: {phase}</p>
          </div>
          <div className="rounded-md border border-white/10 bg-[#343838] p-3">
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
                  <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 hidden w-44 -translate-y-1/2 rounded-md border border-white/15 bg-[#202323] p-3 text-left shadow-xl group-hover:block group-focus:block">
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
  );
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const WordStudy = () => {
  const [card, setCard] = useState<WordCard | null>(null);
  const [stats, setStats] = useState<WordStats | null>(null);
  const [phase, setPhase] = useState("loading");
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteMemoryOpen, setNoteMemoryOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [autoKnownBubble, setAutoKnownBubble] = useState("");
  const [localStudySeconds, setLocalStudySeconds] = useState(0);
  const [error, setError] = useState("");
  const lastStudyTickRef = useRef(Date.now());
  const trackingActiveRef = useRef(false);

  const progressText = useMemo(() => {
    if (!stats?.stage1ProgressTotal) return "";
    return `${stats.stage1ProgressDone}/${stats.stage1ProgressTotal}`;
  }, [stats]);

  const markedKanji = useMemo(() => {
    return (card?.kanjiComponents ?? []).filter((component) => component.marked);
  }, [card]);

  const loadNext = async () => {
    setLoading(true);
    setError("");
    setAutoKnownBubble("");
    try {
      const data = await request<WordSessionResponse>("/api/next");
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法连接词库");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNext();
  }, []);

  const sendStudySeconds = async (seconds: number) => {
    if (seconds <= 0) return null;
    setLocalStudySeconds((value) => value + seconds);
    try {
      const data = await request<{ seconds: number; stats: WordStats }>("/api/word-study-time", {
        method: "POST",
        body: JSON.stringify({ seconds })
      });
      setStats(data.stats);
      setLocalStudySeconds(0);
      return data.stats;
    } catch {
      // Time tracking should never interrupt review.
      return null;
    }
  };

  const elapsedStudySeconds = () => {
    const now = Date.now();
    const elapsed = Math.floor((now - lastStudyTickRef.current) / 1000);
    lastStudyTickRef.current = now;
    if (document.visibilityState !== "visible" || elapsed <= 0) return 0;
    return Math.min(elapsed, 60);
  };

  useEffect(() => {
    trackingActiveRef.current = Boolean(card);
    lastStudyTickRef.current = Date.now();
  }, [card?.id]);

  useEffect(() => {
    const flushStudyTime = async () => {
      if (!trackingActiveRef.current) return;
      await sendStudySeconds(elapsedStudySeconds());
    };

    const interval = window.setInterval(flushStudyTime, 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushStudyTime();
      } else {
        lastStudyTickRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      flushStudyTime();
    };
  }, []);

  useEffect(() => {
    setNoteText(card?.note ?? "");
    setNoteEditorOpen(false);
    setNoteMemoryOpen(false);
  }, [card?.id]);

  const submitAnswer = async (answer: WordAnswer) => {
    if (!card || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const answeredCard = card;
      const data = await request<WordSessionResponse>("/api/answer", {
        method: "POST",
        body: JSON.stringify({ wordId: card.id, answer })
      });
      let nextStats = data.stats;
      if (data.autoKnown && answer === "know") {
        setStats(nextStats);
        setPhase(data.phase);
        setAutoKnownBubble(`${cardLabel(answeredCard)} 已自动加入熟知`);
        await delay(1050);
        setAutoKnownBubble("");
      }
      if (!data.card && trackingActiveRef.current) {
        trackingActiveRef.current = false;
        const trackedStats = await sendStudySeconds(elapsedStudySeconds());
        if (trackedStats) nextStats = trackedStats;
      }
      setCard(data.card);
      setStats(nextStats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const undo = async () => {
    setSubmitting(true);
    setError("");
    try {
      const data = await request<WordSessionResponse>("/api/undo", {
        method: "POST",
        body: JSON.stringify({})
      });
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤回失败");
    } finally {
      setSubmitting(false);
    }
  };

  const saveNote = async () => {
    if (!card || noteSaving) return;
    setNoteSaving(true);
    setError("");
    try {
      const data = await request<{ wordId: number; note: string }>("/api/word-note", {
        method: "POST",
        body: JSON.stringify({ wordId: card.id, note: noteText })
      });
      setCard((current) => current && current.id === data.wordId ? { ...current, note: data.note } : current);
      setNoteText(data.note);
      setNoteEditorOpen(false);
      setNoteMemoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "便签保存失败");
    } finally {
      setNoteSaving(false);
    }
  };

  const setAutoKnownEnabled = async (enabled: boolean) => {
    setSettingsSaving(true);
    setError("");
    setStats((current) => current ? { ...current, settings: { ...(current.settings ?? { autoKnownEnabled: true }), autoKnownEnabled: enabled } } : current);
    try {
      const data = await request<{ settings: { autoKnownEnabled: boolean }; stats: WordStats }>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ autoKnownEnabled: enabled })
      });
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "设置保存失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  const startExtraPhase = async (path: "/api/continue-stage2" | "/api/continue-kanji") => {
    setLoading(true);
    setError("");
    try {
      const data = await request<WordSessionResponse>(path, {
        method: "POST",
        body: JSON.stringify({})
      });
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法进入下一阶段");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-13rem)] min-h-[520px] max-w-4xl flex-col justify-center lg:h-[calc(100vh-4rem)] lg:min-h-[600px]">
      <section className="dictionary-card relative flex h-full min-h-0 flex-col rounded-md p-5 sm:p-8">
        <div className="mb-5 flex shrink-0 items-center justify-between gap-3 border-b border-white/15 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/65">Vocabulary</p>
            <h1 className="mt-1 text-xl font-semibold">单词学习</h1>
          </div>
          <div className="flex items-center gap-2">
            {progressText && <span className="rounded-sm border border-white/15 px-2 py-1 text-xs text-white/70">{progressText}</span>}
            <button
              onClick={() => {
                setNoteMemoryOpen(false);
                setNoteEditorOpen(false);
                setSettingsOpen((open) => !open);
              }}
              className={`focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/20 hover:bg-[#81D8CF]/15 ${stats?.settings?.autoKnownEnabled ?? true ? "bg-[#81D8CF]/20" : "bg-[#81D8CF]/10"}`}
              title="设置"
            >
              <Settings size={17} />
            </button>
            <button
              onClick={() => {
                setNoteMemoryOpen(false);
                setSettingsOpen(false);
                setNoteEditorOpen((open) => !open);
              }}
              disabled={!card}
              className={`focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/20 hover:bg-[#81D8CF]/15 disabled:opacity-50 ${card?.note ? "bg-[#81D8CF]/20" : "bg-[#81D8CF]/10"}`}
              title={card?.note ? "编辑便签" : "添加便签"}
            >
              <StickyNote size={17} />
            </button>
            <button
              onClick={undo}
              disabled={submitting}
              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/20 bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15 disabled:opacity-50"
              title="上一个"
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>

        {settingsOpen && (
          <div className="absolute right-5 top-20 z-20 w-[min(380px,calc(100%-2.5rem))] rounded-md border border-white/20 bg-[#373b3b] p-4 text-left shadow-lg sm:right-8 sm:top-24">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Settings</p>
                <p className="mt-1 text-sm font-semibold text-white/86">单词学习</p>
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-white/5"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <label className="flex items-center justify-between gap-4 rounded-md border border-white/15 bg-[#2f3333] px-3 py-3">
              <span>
                <span className="block text-sm font-bold text-white/86">首见三连自动熟知</span>
                <span className="mt-1 block text-xs leading-5 text-white/50">连续三次当天第一次见面点认识时启用</span>
              </span>
              <input
                type="checkbox"
                checked={stats?.settings?.autoKnownEnabled ?? true}
                disabled={settingsSaving}
                onChange={(event) => setAutoKnownEnabled(event.target.checked)}
                className="h-5 w-5 accent-[#81D8CF]"
              />
            </label>
          </div>
        )}

        {noteMemoryOpen && card?.note && (
          <div className="note-memory-card absolute right-5 top-20 z-20 w-[min(380px,calc(100%-2.5rem))] rounded-md p-4 text-left sm:right-8 sm:top-24">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Memory Note</p>
                <p className="jp mt-1 text-lg font-semibold">{cardLabel(card)}</p>
              </div>
              <button
                onClick={() => setNoteMemoryOpen(false)}
                className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/10"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-white/88">{card.note}</p>
          </div>
        )}

        {noteEditorOpen && card && (
          <div className="absolute right-5 top-20 z-20 w-[min(380px,calc(100%-2.5rem))] rounded-md border border-white/20 bg-[#373b3b] p-4 text-left shadow-lg sm:right-8 sm:top-24">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Word Note</p>
                <p className="jp mt-1 text-lg font-semibold">{cardLabel(card)}</p>
              </div>
              <button
                onClick={() => setNoteEditorOpen(false)}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-white/5"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              className="min-h-36 w-full resize-none rounded-md border border-white/20 bg-[#2f3333] p-3 text-sm leading-6 text-white placeholder:text-white/45"
              placeholder="写下自己的记忆法、易混点、例句或吐槽..."
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-white/45">留空并保存即可清除便签</p>
              <button
                onClick={saveNote}
                disabled={noteSaving}
                className="focus-ring rounded-md bg-[#81D8CF] px-4 py-2 text-sm font-bold !text-[#2f3333] disabled:opacity-50"
              >
                {noteSaving ? "保存中" : "保存"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-md border border-[#81D8CF]/40 bg-[#81D8CF]/20 p-4 text-sm text-white">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">暂时连不上词库接口</p>
              <p className="mt-1 text-white/75">请先启动后端：在项目目录运行 python3 server.py。</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid min-h-[360px] place-items-center text-center text-white/75">正在读取下一题...</div>
        ) : card ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="relative grid min-h-28 shrink-0 place-items-center rounded-md border border-white/15 bg-[#464949] p-5 text-center">
              {card.pos && (
                <span className="absolute right-3 top-3 max-w-28 truncate text-[10px] font-semibold leading-none text-white/28">
                  {card.pos}
                </span>
              )}
              <div className="w-full px-4">
                <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
                  {card.honorificLabel && (
                    <span className="rounded-sm border border-[#81D8CF]/45 bg-[#81D8CF]/18 px-2 py-1 text-xs font-black text-[#81D8CF]">
                      {card.honorificLabel}
                    </span>
                  )}
                  <p className="text-2xl font-semibold leading-8 sm:text-3xl">
                    {card.questionMeaning || card.meaning}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto rounded-md border border-white/15 bg-[#424545] p-6 text-center">
              {revealed ? (
                <div className="w-full">
                  <p className="jp-serif text-7xl font-semibold leading-none sm:text-8xl">
                    <KanjiAnswer card={card} />
                  </p>
                  {answerReadingText(card) && (
                    <p className="jp mt-6 text-4xl text-white/86 sm:text-5xl">{answerReadingText(card)}</p>
                  )}
                  {card.englishOrigin && (
                    <div className="mx-auto mt-6 w-fit rounded-md border border-[#81D8CF]/30 bg-[#81D8CF]/10 px-5 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">英语原词</p>
                      <p className="mt-1 text-2xl font-semibold text-white/90 sm:text-3xl">{card.englishOrigin}</p>
                    </div>
                  )}
                  {(markedKanji.length > 0 || card.verbPair) && (
                    <div className="mx-auto mt-5 grid max-w-2xl gap-3 text-left sm:grid-cols-2">
                      {markedKanji.length > 0 && (
                        <div className="rounded-md border border-white/15 bg-[#373b3b] p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">和式汉字</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {markedKanji.map((component) => (
                              <span
                                key={`${component.char}-${component.simplified}`}
                                className="inline-flex items-center gap-2 rounded-sm border border-[#81D8CF]/25 bg-[#81D8CF]/20 px-2.5 py-1.5 text-sm font-semibold"
                              >
                                <span className="jp-serif kanji-variant-mark text-xl leading-none">{component.char}</span>
                                <span className="text-white/45">→</span>
                                <span className="text-white/86">{component.simplified}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {card.verbPair && (
                        <div className="rounded-md border border-white/15 bg-[#373b3b] p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">自他动词对应</p>
                          <div className="mt-3 flex items-baseline justify-between gap-3">
                            <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/70">{card.verbPair.pairVoice}</span>
                            <div className="text-right">
                              <p className="jp-serif text-2xl font-semibold leading-none">{card.verbPair.kanji}</p>
                              <p className="jp mt-1 text-base text-white/65">{card.verbPair.kana}</p>
                            </div>
                          </div>
                          {card.verbPair.meaning && <p className="mt-3 text-sm leading-6 text-white/75">{card.verbPair.meaning}</p>}
                          {card.verbPair.note && <p className="mt-2 text-xs leading-5 text-white/55">{card.verbPair.note}</p>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-2xl font-semibold text-white/70">答案已隐藏</p>
                  <p className="mt-3 text-sm text-white/55">先回忆假名和汉字</p>
                </div>
              )}
            </div>

            <div className="h-16">
              {!revealed ? (
                <button
                  onClick={() => {
                    setRevealed(true);
                    setNoteEditorOpen(false);
                    if (card?.note) setNoteMemoryOpen(true);
                  }}
                  className="focus-ring inline-flex h-16 w-full items-center justify-center gap-2 rounded-md bg-[#81D8CF] px-4 text-base font-bold !text-[#2f3333]"
                >
                  <Eye size={18} />
                  显示答案
                </button>
              ) : (
                <div className="grid h-16 grid-cols-4 gap-3">
                  {answerOptions.map((option) => (
                    <div key={option.value} className="relative h-16">
                      {option.value === "know" && autoKnownBubble && (
                        <div className="pointer-events-none absolute bottom-[calc(100%+0.55rem)] left-1/2 z-30 w-max max-w-[220px] -translate-x-1/2 rounded-md border border-[#81D8CF]/50 bg-[#202323] px-3 py-2 text-center text-xs font-bold leading-5 text-[#81D8CF] shadow-xl">
                          {autoKnownBubble}
                          <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-[#81D8CF]/50 bg-[#202323]" />
                        </div>
                      )}
                      <button
                        onClick={() => submitAnswer(option.value)}
                        disabled={submitting}
                        className="focus-ring h-16 w-full rounded-md border border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15 disabled:opacity-50"
                      >
                        {option.label}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <FinishPanel
            stats={stats}
            phase={phase}
            localSeconds={localStudySeconds}
            onContinueStage2={() => startExtraPhase("/api/continue-stage2")}
            onContinueKanji={() => startExtraPhase("/api/continue-kanji")}
          />
        )}
      </section>
    </div>
  );
};
