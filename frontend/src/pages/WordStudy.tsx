import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { AlertCircle, Eye, GitCompareArrows, RotateCcw, Star, StickyNote, X } from "lucide-react";
import { WordAnswer, WordCard, WordSessionResponse, WordStats } from "../types/vocabulary";
import { addWordStudySeconds, continueKanjiStudy, continueStage2Study, continueTodayPlanStudy, getWordSession, jumpToSimilarWord, markTodayWordCheckin, startEncore as startEncoreSession, submitWordAnswer, toggleFavorite, undoLastWordAnswer, updateWordNote } from "../lib/api";
import { getStudyPreferences, PREFERENCES_EVENT, StudyPreferences } from "../lib/studyPreferences";
import { addStudyTime, checkAchievements } from "../lib/userProfile";
import { triggerMemoryHaptic } from "../lib/haptics";
import { playPronunciation } from "../lib/speech";
import { playComplete, playDontKnow, playFlip, playKnow } from "../lib/zoo-sounds";
import {
  ExampleBlock,
  FinishPanel,
  KanjiAnswer,
  ReadingLine,
  TransitivityBadge
} from "../features/word-study/WordStudyPanels";
import {
  answerOptions,
  cardLabel,
  kanaToRomaji,
  primaryAnswerText,
} from "../features/word-study/word-study-utils";
import type { StudyMode } from "../types/app";
import { studyModeInfo } from "../lib/studyMode";
import type { WordSessionOptions } from "../lib/study-types";

interface WordStudyProps {
  initialMode?: StudyMode;
  onDailyModeComplete?: (mode: StudyMode) => void;
}

/* ——— 甩卡评分:左=忘记(Again) / 右=认识(Good) ——— */
/** 位移超过它才算「甩出去」,低于则弹回 */
const SWIPE_COMMIT_PX = 96;
/** 位移多少像素后才锁定手势方向(横甩 or 纵向橡皮筋) */
const AXIS_LOCK_PX = 8;
/** 跟手旋转的角度上限。卡片几乎占满整屏,角度必须比 Tinder 那种小卡片小得多,
 *  超过 4° 整页看着就像要翻掉。 */
const SWIPE_MAX_ROTATE = 4;
/** 飞出动画时长,结束后才提交答案 */
const SWIPE_FLING_MS = 240;
/** 飞出距离:超过任何手机屏宽即可 */
const FLING_DISTANCE = 900;

const answerHotkeys: Record<string, WordAnswer> = {
  v: "forgot",
  b: "fuzzy",
  n: "know",
  m: "known_forever"
};

const answerHotkeyLabels: Record<WordAnswer, string> = {
  forgot: "V",
  fuzzy: "B",
  know: "N",
  known_forever: "M"
};

const reservedRevealKeys = new Set([
  "Tab",
  "Escape",
  "CapsLock",
  "Control",
  "Shift",
  "Meta",
  "Enter",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace",
  "Delete",
  "Insert",
  "PrintScreen",
  "Pause",
  "ContextMenu"
]);

const isEditableTarget = (target: EventTarget | null) => {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
};

const isInteractiveActivationKey = (key: string) => key === "Enter" || key === " ";

const yieldToBrowser = () => new Promise<void>((resolve) => {
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

const isDailyModeComplete = (mode: StudyMode, stats: WordStats) => {
  if (mode === "classic") return stats.stage1Done;
  if (mode === "reverse") return stats.stage2Total > 0 && stats.stage2Completed >= stats.stage2Total;
  if (mode === "kanji") return stats.kanjiTotal > 0 && stats.kanjiCompleted >= stats.kanjiTotal;
  return false;
};

export const WordStudy = ({ initialMode = "classic", onDailyModeComplete }: WordStudyProps) => {
  const [card, setCard] = useState<WordCard | null>(null);
  const [stats, setStats] = useState<WordStats | null>(null);
  const [phase, setPhase] = useState("loading");
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteMemoryOpen, setNoteMemoryOpen] = useState(false);
  const [similarMeaningOpen, setSimilarMeaningOpen] = useState(false);
  const [activePopover, setActivePopover] = useState<"note" | "noteMemory" | "similarMeaning" | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [localStudySeconds, setLocalStudySeconds] = useState(0);
  const [preferences, setPreferences] = useState<StudyPreferences>(() => getStudyPreferences());
  const [error, setError] = useState("");
  const lastStudyTickRef = useRef(Date.now());
  const trackingActiveRef = useRef(false);
  const submittingRef = useRef(false);
  const completionReportedRef = useRef(false);
  const dragStartYRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // 甩卡:起点与锁定的方向放 ref(手势过程中不需要触发渲染),位移同时存 ref 供 touchend 读最新值
  const gestureRef = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);
  const swipeXRef = useRef(0);
  const [swipeX, setSwipeX] = useState(0);
  const [flingDir, setFlingDir] = useState<0 | 1 | -1>(0);
  // 被点评分按钮的即时反馈:认识=弹一下发光,不认识=轻轻摇头(不惩罚)
  const [rateFeedback, setRateFeedback] = useState<{ value: WordAnswer; good: boolean } | null>(null);
  const sessionOptions = useMemo<WordSessionOptions>(
    () => initialMode === "mistakes" ? { focus: "mistakes" } : {},
    [initialMode]
  );

  const markedKanji = useMemo(() => {
    return (card?.kanjiComponents ?? []).filter((component) => component.marked);
  }, [card]);

  // 罗马音必须基于假名读音 card.kana:外来语卡片的 secondaryAnswerText 是英文源词
  //（camera/コーヒー…),传进去会被逐字母拆成 "c a m e r a" 这种乱码。
  const romaji = useMemo(() => card ? kanaToRomaji(card.kana) : "", [card]);

  const loadNext = async (mode: StudyMode = initialMode) => {
    setLoading(true);
    setError("");
    try {
      await yieldToBrowser();
      let data: WordSessionResponse;
      if (mode === "reverse") {
        data = continueStage2Study();
      } else if (mode === "kanji") {
        data = continueKanjiStudy();
      } else if (mode === "mistakes") {
        data = getWordSession(sessionOptions);
      } else {
        // 经典 = 今日计划:进来先把 phase 摆正,否则会被上一次停在反向/汉字的
        // 当天状态劫持 —— 选了经典却出反向题。
        data = continueTodayPlanStudy();
      }
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
      if (!data.card && !completionReportedRef.current && isDailyModeComplete(mode, data.stats)) {
        completionReportedRef.current = true;
        onDailyModeComplete?.(mode);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取本地词库");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNext(initialMode);
  }, [initialMode]);

  useEffect(() => {
    const handlePreferences = (event: Event) => {
      setPreferences((event as CustomEvent<StudyPreferences>).detail ?? getStudyPreferences());
    };
    window.addEventListener(PREFERENCES_EVENT, handlePreferences);
    return () => window.removeEventListener(PREFERENCES_EVENT, handlePreferences);
  }, []);

  // 具体读什么、用文件还是用系统语音,都在 lib/speech.ts 里决定;这里只管开关。
  const speakCard = useCallback((target: WordCard) => {
    if (!preferences.autoPlay) return;
    void playPronunciation(target.kanji, target.kana, preferences.voiceId);
  }, [preferences.autoPlay, preferences.voiceId]);

  const sendStudySeconds = useCallback(async (seconds: number) => {
    if (seconds <= 0) return null;
    setLocalStudySeconds((value) => value + seconds);
    try {
      const data = addWordStudySeconds(seconds);
      setStats(data.stats);
      setLocalStudySeconds(0);

      // 同步到用户资料（分钟）
      const minutes = Math.floor(seconds / 60);
      if (minutes > 0) {
        await addStudyTime(minutes);
        // 检查是否解锁新成就
        await checkAchievements();
      }

      return data.stats;
    } catch {
      // Time tracking should never interrupt review.
      return null;
    }
  }, []);

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
  }, [sendStudySeconds]);

  useEffect(() => {
    setNoteText(card?.note ?? "");
    setNoteEditorOpen(false);
    setNoteMemoryOpen(false);
    setSimilarMeaningOpen(false);
    setActivePopover(null);
  }, [card?.id]);

  const submitAnswer = useCallback(async (answer: WordAnswer) => {
    // submittingRef is synchronous, so a second tap is blocked immediately —
    // before React can re-render the `disabled`/`submitting` state — which is
    // what the `submitting` state alone could miss on a fast double-tap.
    if (!card || submittingRef.current || submitting) return;
    submittingRef.current = true;
    triggerMemoryHaptic(answer);
    // 认识 → 上行两音;不认识 → 柔和下行两音。同时播 0.2s 按钮反馈动画,
    // 让「按一下」有分量(动画时长与下面的 stall 对齐)。
    const good = answer === "know" || answer === "known_forever";
    if (good) playKnow();
    else playDontKnow();
    setRateFeedback({ value: answer, good });
    setSubmitting(true);
    setError("");
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      const data = submitWordAnswer(card.id, answer, sessionOptions);
      if (!data.card) playComplete();
      let nextStats = data.stats;
      if (!data.card && trackingActiveRef.current) {
        trackingActiveRef.current = false;
        const trackedStats = await sendStudySeconds(elapsedStudySeconds());
        if (trackedStats) nextStats = trackedStats;
      }
      setCard(data.card);
      setStats(nextStats);
      setPhase(data.phase);
      setRevealed(false);
      // 同一个顽固词可能被立即再次排到。它的 id 没变，下面依赖 card.id 的
      // effect 不会执行，所以必须在「一次作答已结束」这个轮次边界主动收起
      // 上次翻面弹出的备注；下一次翻面时仍会照常重新弹出。
      setNoteText(data.card?.note ?? "");
      setNoteEditorOpen(false);
      setNoteMemoryOpen(false);
      setSimilarMeaningOpen(false);
      setActivePopover(null);
      if (!data.card && !completionReportedRef.current && isDailyModeComplete(initialMode, nextStats)) {
        completionReportedRef.current = true;
        onDailyModeComplete?.(initialMode);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setRateFeedback(null);
    }
  }, [card, initialMode, onDailyModeComplete, sendStudySeconds, sessionOptions, submitting]);

  const revealAnswer = useCallback(() => {
    if (!card || loading || revealed || submitting) return;
    setRevealed(true);
    playFlip();
    setNoteEditorOpen(false);
    if (card.note) {
      setNoteMemoryOpen(true);
      setActivePopover("noteMemory");
    } else {
      setNoteMemoryOpen(false);
      setActivePopover(similarMeaningOpen ? "similarMeaning" : null);
    }
    speakCard(card);
  }, [card, loading, revealed, similarMeaningOpen, speakCard, submitting]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Keep browser/app shortcuts and text editing untouched.
      if (
        event.defaultPrevented
        || event.repeat
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || isEditableTarget(event.target)
      ) return;

      const key = event.key.toLowerCase();
      if (revealed) {
        const answer = answerHotkeys[key];
        if (!answer || !card || submitting) return;
        event.preventDefault();
        void submitAnswer(answer);
        return;
      }

      if (!card || loading || submitting || reservedRevealKeys.has(event.key)) return;
      // A focused button/link should retain its native Enter/Space behavior.
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest("button, a") && isInteractiveActivationKey(event.key)) return;

      event.preventDefault();
      revealAnswer();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [card, loading, revealed, submitting, submitAnswer, revealAnswer]);

  const undo = async () => {
    setSubmitting(true);
    setError("");
    try {
      const data = undoLastWordAnswer(sessionOptions);
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
      const data = updateWordNote(card.id, noteText);
      setCard((current) => current && current.id === data.wordId ? { ...current, note: data.note } : current);
      setNoteText(data.note);
      setNoteEditorOpen(false);
      setNoteMemoryOpen(false);
      setActivePopover(similarMeaningOpen ? "similarMeaning" : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "便签保存失败");
    } finally {
      setNoteSaving(false);
    }
  };

  const toggleCardFavorite = () => {
    if (!card) return;
    setError("");
    try {
      const result = toggleFavorite("word", card.id);
      setCard({ ...card, isFavorite: result.isFavorite });
    } catch (err) {
      setError(err instanceof Error ? err.message : "收藏失败");
    }
  };

  const toggleSimilarMeaning = () => {
    if (!card?.similarMeaning) return;
    setSimilarMeaningOpen((open) => {
      const next = !open;
      setActivePopover(next ? "similarMeaning" : (noteEditorOpen ? "note" : noteMemoryOpen ? "noteMemory" : null));
      return next;
    });
  };

  const jumpToSimilar = (targetWordId: number) => {
    if (!card || submittingRef.current || submitting) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const data = jumpToSimilarWord(card.id, targetWordId, sessionOptions);
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
      setNoteEditorOpen(false);
      setNoteMemoryOpen(false);
      setSimilarMeaningOpen(false);
      setActivePopover(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法切换到相似词");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const isReversePhase = phase === "stage2";
  const isKanjiPhase = phase === "kanji";
  // 文案统一来自 studyMode 的模式目录,别再在这儿摊三串三元表达式:
  // 加一个模式要改三处、少改一处就出现「标题写经典、角标写 Vocabulary」。
  const activeModeInfo = studyModeInfo(isReversePhase ? "reverse" : isKanjiPhase ? "kanji" : initialMode);
  const pageTitle = activeModeInfo.title;
  // 并进松鼠轨道里的短模式名(轨道那行只有 10.5px,放不下"经典模式"四个字加进度数)
  const shortMode = activeModeInfo.short;
  const pageLabel = activeModeInfo.label;

  const startExtraPhase = async (phaseName: "stage2" | "kanji") => {
    setLoading(true);
    setError("");
    try {
      await yieldToBrowser();
      const data = phaseName === "stage2" ? continueStage2Study() : continueKanjiStudy();
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

  const checkInToday = () => {
    try {
      setStats(markTodayWordCheckin());
    } catch (err) {
      setError(err instanceof Error ? err.message : "打卡失败");
    }
  };

  const startEncore = async (size?: number) => {
    setLoading(true);
    setError("");
    try {
      await yieldToBrowser();
      const data = startEncoreSession(size);
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法继续学习");
    } finally {
      setLoading(false);
    }
  };

  const showStudyToolbar = loading || Boolean(card);
  const canDragWordPage = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    return !element?.closest("button, input, select, textarea, a, [data-word-scrollable='true']");
  };
  // 甩卡比纵向橡皮筋宽松:释义区是纵向滚动容器,横向甩它不冲突,所以不排除 scrollable。
  const canSwipeCard = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    return !element?.closest("button, input, select, textarea, a");
  };

  // 甩卡只在「答案已显示」时生效:没看答案就甩等于瞎评分。
  const swipeEnabled = Boolean(card) && revealed && !submitting;

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    gestureRef.current = { x: touch.clientX, y: touch.clientY, axis: null };
    if (!canDragWordPage(event.target)) return;
    dragStartYRef.current = touch.clientY;
    setDragging(true);
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;

    // 先看清楚是横的还是竖的再锁死方向,免得甩到一半变成上下橡皮筋。
    if (!gesture.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
    }

    if (gesture.axis === "x") {
      if (!swipeEnabled || !canSwipeCard(event.target)) return;
      event.preventDefault();
      swipeXRef.current = dx;
      setSwipeX(dx);
      return;
    }

    if (dragStartYRef.current == null || !canDragWordPage(event.target)) return;
    event.preventDefault();
    const resistance = Math.sign(dy) * Math.min(Math.abs(dy) * 0.28, 42);
    setDragOffset(resistance);
  };

  const resetDrag = () => {
    const gesture = gestureRef.current;
    const swiped = swipeXRef.current;
    gestureRef.current = null;
    dragStartYRef.current = null;
    setDragging(false);
    setDragOffset(0);
    swipeXRef.current = 0;

    // 甩过阈值 → 卡片顺着惯性飞出去,飞完再提交(右=认识 / 左=忘记)
    if (gesture?.axis === "x" && swipeEnabled && Math.abs(swiped) >= SWIPE_COMMIT_PX) {
      const direction = swiped > 0 ? 1 : -1;
      setFlingDir(direction);
      window.setTimeout(() => {
        setFlingDir(0);
        setSwipeX(0);
        submitAnswer(direction > 0 ? "know" : "forgot");
      }, SWIPE_FLING_MS);
      return;
    }
    setSwipeX(0);
  };

  // 跟手位移 →(飞出时换成整屏宽度)
  const cardShift = flingDir ? flingDir * FLING_DISTANCE : swipeX;
  const cardRotate = Math.max(-SWIPE_MAX_ROTATE, Math.min(SWIPE_MAX_ROTATE, cardShift / 40));
  const swipeProgress = Math.min(Math.abs(swipeX) / SWIPE_COMMIT_PX, 1);

  return (
    <div
      className="word-study-shell mx-auto flex max-w-4xl flex-col justify-center lg:max-w-[1200px]"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={resetDrag}
      onTouchCancel={resetDrag}
      style={{
        transform: `translate3d(0, ${dragOffset}px, 0)`,
        transition: dragging ? "transform 80ms linear" : "transform 420ms cubic-bezier(0.2, 0.9, 0.2, 1)"
      }}
    >
      <section
        className={`dictionary-card relative flex h-full min-h-0 flex-col rounded-2xl ${showStudyToolbar ? "px-3 pb-2 pt-3 sm:p-8 lg:p-7" : "px-3 pb-2 pt-3 sm:p-5"}`}
        style={{
          transform: cardShift ? `translate3d(${cardShift}px,0,0) rotate(${cardRotate}deg)` : undefined,
          opacity: flingDir ? 0 : undefined,
          // 跟手时不要过渡(否则会有拖影),飞出与回弹才给过渡
          transition: flingDir
            ? `transform ${SWIPE_FLING_MS}ms cubic-bezier(.4,0,1,1), opacity ${SWIPE_FLING_MS}ms ease-in`
            : swipeX
              ? "none"
              : "transform 300ms cubic-bezier(.2,.9,.2,1)"
        }}
      >
        {/* 甩卡印章:右=捡到松子,左=松子空了(不惩罚,只是「再来一遍」) */}
        {swipeEnabled && swipeX > AXIS_LOCK_PX && (
          <span className="zoo-stamp good" style={{ opacity: swipeProgress }}>
            🌰 认识
          </span>
        )}
        {swipeEnabled && swipeX < -AXIS_LOCK_PX && (
          <span className="zoo-stamp bad" style={{ opacity: swipeProgress }}>
            ◦ 再来
          </span>
        )}

        {/* 标题栏 = 操作一行,模式名和进度并进下面的松鼠轨道。
            全尺寸都走普通文档流(不再 lg:absolute),桌面端也就不需要给正文留 pt 了。 */}
        <div className="shrink-0 lg:mx-auto lg:w-[min(900px,100%)]">
        {showStudyToolbar && <div className="mb-2 flex min-w-0 items-center gap-2 lg:mb-3">
          <div className="hidden min-w-0 shrink-0 lg:block">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/65">{pageLabel}</p>
            <h1 className="text-lg font-semibold leading-tight">{pageTitle}</h1>
          </div>
          {/* 手机端只在非默认模式下标一下:经典模式是常态,标了是噪音;
              反向/汉字/词汇不标的话用户会不知道自己在哪个模式里。 */}
          {shortMode !== "经典" && (
            <span className="shrink-0 rounded-lg bg-[#81D8CF]/20 px-2 py-1 text-xs font-bold lg:hidden">
              {shortMode}
            </span>
          )}
          <button
            onClick={toggleCardFavorite}
            disabled={!card}
            className={`focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 hover:bg-[#81D8CF]/15 disabled:opacity-50 lg:ml-auto ${card?.isFavorite ? "bg-[#81D8CF] !text-[#2f3333]" : "bg-[#81D8CF]/10"}`}
            title={card?.isFavorite ? "取消收藏" : "收藏单词"}
          >
            <Star size={17} fill={card?.isFavorite ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => {
              setNoteMemoryOpen(false);
              setNoteEditorOpen((open) => {
                const next = !open;
                setActivePopover(next ? "note" : (similarMeaningOpen ? "similarMeaning" : null));
                return next;
              });
            }}
            disabled={!card}
            className={`focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 hover:bg-[#81D8CF]/15 disabled:opacity-50 ${card?.note ? "bg-[#81D8CF]/20" : "bg-[#81D8CF]/10"}`}
            title={card?.note ? "编辑便签" : "添加便签"}
          >
            <StickyNote size={17} />
          </button>
          <button
            onClick={undo}
            disabled={submitting}
            className="focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15 disabled:opacity-50"
            title="上一个"
          >
            <RotateCcw size={17} />
          </button>
          {card?.similarMeaning && !isReversePhase && !isKanjiPhase && (
            <button
              onClick={toggleSimilarMeaning}
              className={`focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 hover:bg-[#81D8CF]/15 ${similarMeaningOpen ? "bg-[#81D8CF] !text-[#2f3333]" : "bg-[#81D8CF]/10"}`}
              title="查看相似释义词"
              aria-label="查看相似释义词"
              aria-expanded={similarMeaningOpen}
            >
              <GitCompareArrows size={17} />
            </button>
          )}
        </div>}

        {noteMemoryOpen && card?.note && (
          <div
            className="word-note-popover note-memory-card word-note-float overflow-y-auto rounded-2xl border p-4 text-left shadow-2xl backdrop-blur-md"
            style={{ zIndex: activePopover === "noteMemory" ? 50 : 35 }}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Memory Note</p>
                <p className="jp mt-1 text-lg font-semibold">{cardLabel(card)}</p>
              </div>
              <button
                onClick={() => {
                  setNoteMemoryOpen(false);
                  setActivePopover(similarMeaningOpen ? "similarMeaning" : null);
                }}
                className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-[#81D8CF]/15"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-white/88">{card.note}</p>
          </div>
        )}

        {noteEditorOpen && card && (
          <div
            className="word-note-popover word-note-float overflow-y-auto rounded-2xl border p-4 text-left shadow-lg"
            style={{ zIndex: activePopover === "note" ? 50 : 35 }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Word Note</p>
                <p className="jp mt-1 text-lg font-semibold">{cardLabel(card)}</p>
              </div>
              <button
                onClick={() => {
                  setNoteEditorOpen(false);
                  setActivePopover(similarMeaningOpen ? "similarMeaning" : null);
                }}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/15 bg-white/5"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              className="min-h-36 w-full resize-none rounded-2xl border border-white/20 bg-[#2f3333] p-3 text-sm leading-6 text-white placeholder:text-white/45"
              placeholder="写下自己的记忆法、易混点、例句或吐槽..."
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-white/45">留空并保存即可清除便签</p>
              <button
                onClick={saveNote}
                disabled={noteSaving}
                className="focus-ring rounded-2xl bg-[#81D8CF] px-4 py-2 text-sm font-bold !text-[#2f3333] disabled:opacity-50"
              >
                {noteSaving ? "保存中" : "保存"}
              </button>
            </div>
          </div>
        )}

        {similarMeaningOpen && card?.similarMeaning && (
          <div
            className="word-note-popover similar-meaning-popover word-note-float overflow-y-auto rounded-2xl border p-4 text-left shadow-2xl backdrop-blur-md"
            style={{ zIndex: activePopover === "similarMeaning" ? 50 : 35 }}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">相似释义词</p>
                <p className="mt-1 text-base font-semibold">{card.similarMeaning.title}</p>
              </div>
              <button
                onClick={() => {
                  setSimilarMeaningOpen(false);
                  setActivePopover(noteEditorOpen ? "note" : noteMemoryOpen ? "noteMemory" : null);
                }}
                className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-[#81D8CF]/15"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>
            <p className="mb-3 text-sm leading-6 text-white/72">{card.similarMeaning.distinction}</p>
            <div className="space-y-2">
              {card.similarMeaning.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => jumpToSimilar(item.id)}
                  disabled={submitting}
                  className="focus-ring block w-full rounded-xl border border-[#5aa7ff]/30 bg-[#5aa7ff]/10 p-3 text-left transition-colors hover:bg-[#5aa7ff]/20 disabled:opacity-50"
                  title={`切换到${item.kanji}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="jp-serif text-xl font-semibold leading-none text-[#5aa7ff]">{item.kanji}</p>
                    <p className="jp text-sm text-[#5aa7ff]/80">{item.kana}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/78">{item.meaning}</p>
                </button>
              ))}
            </div>
          </div>
        )}
        </div>

        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#81D8CF]/40 bg-[#81D8CF]/20 p-4 text-sm text-white">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
              <p className="font-bold">暂时读不到本地词库</p>
              <p className="mt-1 text-white/75">请检查应用内是否包含 nihongo.db。</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid min-h-[360px] place-items-center text-center text-white/75">正在读取下一题...</div>
        ) : card ? (
          <div key={card.id} className="zoo-enter flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
            {/* 松鼠的小路搬到了顶部 Master 栏(components/SquirrelTrail),
                卡片里不再为进度条留高度,全部让给答案区。 */}

            {/* 手机端题目框尽量压扁:题目通常就几个字,省下的高度让给答案区(长题目仍由内层 max-h 滚动)。
                「题目」这个标签在手机上省掉 —— 顶上那个框是题目本来就一目了然。 */}
            <div className="grid min-h-0 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#464949] px-3 py-2 text-center sm:min-h-28 sm:p-4 lg:mx-auto lg:min-h-36 lg:w-[min(900px,100%)] lg:p-6">
              <div className="w-full">
                {/* 等级/词性挪到题目面,并且放在滚动区外面 —— 释义有长到要滚的
                    (「…的省略语；super超,上,高级,超级」这种),标签不能跟着滚没。 */}
                <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1.5">
                  {card.jlptLevel && (
                    <span className="rounded-sm border border-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white/60">{card.jlptLevel}</span>
                  )}
                  {card.pos && (
                    <span className="rounded-sm bg-[#81D8CF]/10 px-1.5 py-0.5 text-[11px] font-bold text-white/60">{card.pos}</span>
                  )}
                  {/* 正向题(中文→日文)不亮自他:那等于提前告诉你答案是 開く 还是 開ける。
                      反向题的日文词就在眼前,标了才有意义。 */}
                  {isReversePhase && <TransitivityBadge card={card} />}
                  {card.honorificLabel && (
                    <span className="rounded-sm border border-[#81D8CF]/45 bg-[#81D8CF]/18 px-1.5 py-0.5 text-[11px] font-black text-[#81D8CF]">
                      {card.honorificLabel}
                    </span>
                  )}
                </div>
                <div data-word-scrollable="true" className="max-h-24 w-full overflow-y-auto px-1 sm:max-h-28">
                  {isReversePhase ? (
                    <>
                      <p className="jp-serif break-words text-4xl font-semibold leading-tight sm:text-6xl lg:text-7xl">{primaryAnswerText(card)}</p>
                      <ReadingLine card={card} className="jp mt-1 text-xl text-white/72 sm:text-2xl lg:text-3xl" />
                    </>
                  ) : (
                    <p className="break-words text-xl font-semibold leading-snug sm:text-3xl lg:text-4xl">
                      {card.questionMeaning || card.meaning}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div data-word-scrollable="true" className="grid min-h-0 flex-1 place-items-center overflow-y-auto rounded-2xl border border-white/15 bg-[#424545] p-4 text-center sm:p-6 lg:mx-auto lg:w-[min(1040px,100%)] lg:p-10">
              {revealed ? (
                <div className="w-full">
                  {isReversePhase ? (
                    <>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">释义</p>
                      <p className="mx-auto mt-4 max-w-2xl text-2xl font-semibold leading-9 text-white/88">{card.meaning}</p>
                    </>
                  ) : (
                    <>
                      <p className="jp-serif text-6xl font-semibold leading-none sm:text-7xl lg:text-8xl xl:text-[9rem]">
                        <KanjiAnswer card={card} />
                      </p>
                      {/* 自他跟读音同一行:它是这个词的属性,不值得单占一行。
                          等级/词性已经在题目面常驻,这里不再重复。 */}
                      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                        <ReadingLine
                          card={card}
                          className="jp text-3xl text-white/86 sm:text-4xl lg:text-5xl xl:text-6xl"
                        />
                        <TransitivityBadge card={card} />
                      </div>
                      {card.englishOrigin && (
                        <div className="mx-auto mt-3 w-fit rounded-2xl border border-[#81D8CF]/30 bg-[#81D8CF]/10 px-4 py-2">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">英语原词</p>
                          <p className="mt-0.5 text-2xl font-semibold text-white/90 sm:text-3xl">{card.englishOrigin}</p>
                        </div>
                      )}
                    </>
                  )}
                  {preferences.showRomaji && romaji && (
                    <p className="mt-2 text-sm font-semibold tracking-normal text-white/52">{romaji}</p>
                  )}
                  {/* 正向题的释义就是题面本身,答案面再抄一遍纯属占地方。
                      题面显示的是精简过的 questionMeaning,完整释义补在这里 —— 只在
                      两者确实不一样时才出现。 */}
                  {!isReversePhase && card.meaning !== (card.questionMeaning || card.meaning) && (
                    <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-white/72 lg:text-lg lg:leading-8">
                      {card.meaning}
                    </p>
                  )}
                  <ExampleBlock card={card} />
                  {(markedKanji.length > 0 || card.verbPair || card.confusions.length > 0) && !isReversePhase && (
                    <div className="mx-auto mt-4 grid max-w-2xl gap-3 text-left sm:grid-cols-2">
                      {markedKanji.length > 0 && (
                        <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-4">
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
                        <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-4">
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

                      {card.confusions.length > 0 && (
                        <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-4 sm:col-span-2">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">易混词</p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {card.confusions.slice(0, 3).map((item) => (
                              <div key={`${item.kind}-${item.kanji}-${item.kana}`} className="rounded-xl border border-white/10 bg-[#81D8CF]/10 p-3">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="jp-serif text-xl font-semibold leading-none">{item.kanji}</p>
                                  <span className="rounded-sm border border-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white/45">{item.kind}</span>
                                </div>
                                <p className="jp mt-1 text-sm text-white/58">{item.kana}</p>
                                <p className="mt-2 text-xs leading-5 text-white/70">{item.meaning}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-2xl font-semibold text-white/70">答案已隐藏</p>
                  <p className="mt-3 text-sm text-white/55">{isReversePhase ? "先回忆中文释义" : "先回忆假名和汉字"}</p>
                </div>
              )}
            </div>

            <div className="relative h-16 lg:mx-auto lg:w-[min(900px,100%)]">
              {!revealed ? (
                <button
                  onClick={revealAnswer}
                  title="点击或按任意普通键显示答案"
                  className="focus-ring zoo-pop zoo-gloss inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] px-4 text-base font-bold !text-[#2f3333]"
                >
                  <Eye size={18} />
                  <span>显示答案</span>
                  <span className="text-xs font-semibold opacity-65">（按任意键）</span>
                </button>
              ) : (
                <>
                  <div className="grid h-16 grid-cols-4 gap-3">
                    {answerOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => submitAnswer(option.value)}
                        aria-keyshortcuts={answerHotkeyLabels[option.value]}
                        disabled={submitting}
                        className={`focus-ring zoo-pop h-16 rounded-2xl border border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15 disabled:opacity-50${
                          rateFeedback?.value === option.value
                            ? rateFeedback.good
                              ? " zoo-flash-good"
                              : " zoo-flash-bad"
                            : ""
                        }`}
                      >
                        <span className="block text-[10px] font-black tracking-[0.18em] text-white/45">{answerHotkeyLabels[option.value]}</span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                  {/* 甩卡提示只给触屏设备(桌面没这手势,写了反而是噪音) */}
                  <p className="zoo-swipe-hint">← 左滑「再来」　右滑「认识」→</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <FinishPanel
            stats={stats}
            phase={phase}
            localSeconds={localStudySeconds}
            onCheckIn={checkInToday}
            onContinueStage2={() => startExtraPhase("stage2")}
            onContinueKanji={() => startExtraPhase("kanji")}
            onEncore={startEncore}
          />
        )}
      </section>
    </div>
  );
};
