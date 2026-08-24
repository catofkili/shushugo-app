import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { AlertCircle, ChevronRight, Eye, GitCompareArrows, Pencil, RotateCcw, Star, StickyNote, X } from "lucide-react";
import { WordAnswer, WordCard, WordSessionResponse, WordStats } from "../types/vocabulary";
import { addWordStudySeconds, advanceDailyRelief, advanceDailyTail, continueKanjiStudy, continueStage2Study, continueTodayPlanStudy, getDailyReliefNext, getDailyTailNext, getWordSession, getWordStats, hasDailyReviewTriggered, jumpToSimilarWord, markDailyReviewTriggered, markTodayWordCheckin, pickDailyReviewNext, shouldStartDailyReview, startEncore as startEncoreSession, submitKanjiUnitAnswer, submitWordAnswer, toggleFavorite, undoLastWordAnswer, questionMeaningRivals, updateWordNote, updateWordQuestionMeaning } from "../lib/api";
import { getStudyPreferences, PREFERENCES_EVENT, StudyPreferences } from "../lib/studyPreferences";
import { checkAchievements } from "../lib/userProfile";
import { triggerCountdownHaptic, triggerMemoryHaptic, triggerReliefHaptic, triggerRevealHaptic, triggerSwipeArmHaptic } from "../lib/haptics";
import { playPronunciation } from "../lib/speech";
import { playComplete, playCountdownTick, playDontKnow, playFlip, playKnow, playReliefDeal } from "../lib/zoo-sounds";
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
  moraCount,
  primaryAnswerText,
} from "../features/word-study/word-study-utils";
import { kanjiReadingSurface } from "../lib/orthography";
import type { StudyMode } from "../types/app";
import { studyModeInfo } from "../lib/studyMode";
import type { WordSessionOptions } from "../lib/study-types";
import { DistinctionSheet } from "../components/DistinctionSheet";
import { wordDistinctions } from "../lib/models/word-distinctions";
import { warmConfusionGroups } from "../lib/confusion-groups";
import { yieldToPaint } from "../lib/yield-to-paint";
import { accrueStudyTime, createStudyClock, drainStudySeconds, noteStudyInteraction } from "../lib/study-clock";

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
/**
 * 翻面之后多久内不收评分。
 * 「显示答案」和四颗评分键占的是同一行同一个位置(都是 h-16),翻面的那一下
 * 手指还在往下走的话会当场命中一颗 —— 而那一下是**真的写进 FSRS 的**。
 * 120ms 短到感知不到,长到能吃掉这种连击。按钮不变灰:变灰是噪音,
 * 而且会让人以为按不了。
 */
const REVEAL_INPUT_LOCK_MS = 120;
/** 评分反馈印章播多久(和 .zoo-rate-burst 的动画时长对齐,略留余量) */
const RATE_BURST_MS = 500;

/** 评分印章的字面。沿用甩卡印章的说法:🌰 = 收下了,◦ = 再来一遍(不惩罚) */
const rateBurstLabels: Record<WordAnswer, string> = {
  forgot: "◦ 再来",
  fuzzy: "◦ 模糊",
  know: "🌰 认识",
  known_forever: "🌰 熟知"
};

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

const DAILY_REVIEW_MAX_ATTEMPTS = 25;
const DAILY_REVIEW_MAX_FAILURES_PER_WORD = 3;
const DAILY_REVIEW_COOLDOWN_LENGTH = 3;

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

const isDailyModeComplete = (mode: StudyMode, stats: WordStats) => {
  if (mode === "classic") return stats.dailyPlanDone;
  if (mode === "reverse") return stats.stage2Total > 0 && stats.stage2Completed >= stats.stage2Total;
  if (mode === "kanji") return stats.kanjiTotal > 0 && stats.kanjiCompleted >= stats.kanjiTotal;
  return false;
};

/**
 * 开场「减负」自动发牌的节奏。原来是 420ms 停留 + 240ms 飞出 = 每张 660ms，
 * 一次发十来张要拖到七八秒 —— 它是个「昨天这些你都记得」的确认动画，不是内容，
 * 磨蹭比不做还糟。整体减半到每张 330ms。
 *
 * ⚠️ 这两个数必须和 master-home.css 里的动画时长对着改：
 *   RELIEF_LEAVE_MS ↔ .daily-relief-card-leaving 的 dailyReliefDealOut
 *   飞入动画 dailyReliefDealIn 要短于 RELIEF_DWELL_MS，否则卡片还没落定就开始飞走。
 */
const RELIEF_DWELL_MS = 210;
const RELIEF_LEAVE_MS = 120;

export const WordStudy = ({ initialMode = "classic", onDailyModeComplete }: WordStudyProps) => {
  const [card, setCard] = useState<WordCard | null>(null);
  const [unitKey, setUnitKey] = useState<string | null>(null);
  const [unitTarget, setUnitTarget] = useState<WordSessionResponse["unitTarget"]>(null);
  const [stats, setStats] = useState<WordStats | null>(null);
  const [phase, setPhase] = useState("loading");
  // 「上一个」还剩几步可撤(最多两步)。灰掉总比点一下跳到无关的词上强。
  const [canUndo, setCanUndo] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteMemoryOpen, setNoteMemoryOpen] = useState(false);
  const [distinctionOpen, setDistinctionOpen] = useState(false);
  // 辨析索引建好没。没建好就先不算 —— 详见 warmConfusionGroups
  const [distinctionsReady, setDistinctionsReady] = useState(false);
  const [activePopover, setActivePopover] = useState<"note" | "noteMemory" | "prompt" | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  const [localStudySeconds, setLocalStudySeconds] = useState(0);
  const [preferences, setPreferences] = useState<StudyPreferences>(() => getStudyPreferences());
  const [error, setError] = useState("");
  const studyClockRef = useRef(createStudyClock(Date.now()));
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
  /**
   * 评分的即时反馈印章。
   *
   * ⚠️ 它**不能**挂在评分按钮上。submitAnswer 里 setCard 和这个 state 落在同一个
   * commit,卡片按 key={card.id} 整棵换掉 —— 挂在按钮上的动画连元素带动画一起被
   * 卸载,一帧都播不出来(改版前的 rateFeedback + .zoo-flash-good 就是这么死的,
   * 而且完全不报错)。所以它渲染在不带 key 的 .dictionary-card 上,自己播完 .46s,
   * 下一张卡在它底下照常入场。
   *
   * seq 是给 React 换 key 用的:连着评两张时要重新播,而不是接着上一次的进度。
   */
  const [rateBurst, setRateBurst] = useState<{ good: boolean; label: string; seq: number } | null>(null);
  const rateBurstSeqRef = useRef(0);
  const rateBurstTimerRef = useRef<number | undefined>(undefined);
  /** 翻面的时刻,给 REVEAL_INPUT_LOCK_MS 那道闸用 */
  const revealedAtRef = useRef(0);
  /** 甩卡当前在阈值哪一侧(-1/0/1),只在**跨越**的那一帧给触觉,不是每帧都震 */
  const swipeArmedRef = useRef<0 | 1 | -1>(0);
  /** 连对了几个。只喂给音高台阶(playKnow),不进任何调度 —— 连胜梯子已经整体删掉了 */
  const correctStreakRef = useRef(0);
  const [reliefActive, setReliefActive] = useState(false);
  const [reliefLeaving, setReliefLeaving] = useState(false);
  const [dailyReviewActive, setDailyReviewActive] = useState(false);
  const [dailyReviewIntro, setDailyReviewIntro] = useState(false);
  const [tailActive, setTailActive] = useState(false);
  const dailyReviewResolvedRef = useRef<Set<number>>(new Set());
  const dailyReviewAttemptsRef = useRef(0);
  const dailyReviewFailuresRef = useRef<Map<number, number>>(new Map());
  const dailyReviewCooldownRef = useRef<number[]>([]);
  const [dailyReviewTriggeredToday] = useState(() => hasDailyReviewTriggered());
  const dailyReviewTriggeredRef = useRef(dailyReviewTriggeredToday);
  const sessionOptions = useMemo<WordSessionOptions>(
    () => initialMode === "mistakes" ? { focus: "mistakes" }
      : initialMode === "picked" ? { focus: "picked" }
        : {},
    [initialMode]
  );

  const markedKanji = useMemo(() => {
    return (card?.kanjiComponents ?? []).filter((component) => component.marked);
  }, [card]);

  // 罗马音必须基于假名读音 card.kana:外来语卡片的 secondaryAnswerText 是英文源词
  //（camera/コーヒー…),传进去会被逐字母拆成 "c a m e r a" 这种乱码。
  // 罗马字跟着答案走:字音单位卡的答案是这一段的读音,给整词罗马字(miru)
  // 和念整词是同一个错 —— 答案区写着「み」,底下标着 miru。
  const romaji = useMemo(() => {
    if (unitTarget?.reading) return kanaToRomaji(unitTarget.reading);
    return card ? kanaToRomaji(card.kana) : "";
  }, [card, unitTarget]);

  const remainingPlanWords = (target: WordStats | null): number => {
    if (!target) return 0;
    return Math.max(target.stage1ProgressTotal - target.stage1ProgressDone, 0);
  };

  const playCountdownFeedbackIfNeeded = (before: WordStats | null, after: WordStats | null) => {
    const beforeRemaining = remainingPlanWords(before);
    const afterRemaining = remainingPlanWords(after);
    if (afterRemaining < beforeRemaining && afterRemaining > 0 && afterRemaining <= 30) {
      triggerCountdownHaptic();
      playCountdownTick();
    }
  };

  const loadNext = async (mode: StudyMode = initialMode) => {
    setLoading(true);
    setError("");
    try {
      await yieldToPaint();
      let data: WordSessionResponse;
      if (mode === "classic") {
        const reliefCard = getDailyReliefNext();
        if (reliefCard) {
          data = continueTodayPlanStudy();
          setCard(reliefCard);
          setUnitKey(null);
          setUnitTarget(null);
          setStats(data.stats);
          setPhase("relief");
          setReliefActive(true);
          setReliefLeaving(false);
          setTailActive(false);
          setRevealed(true);
          return;
        }
      }
      if (mode === "reverse") {
        data = continueStage2Study();
      } else if (mode === "kanji") {
        data = continueKanjiStudy();
      } else if (mode === "mistakes" || mode === "picked") {
        data = getWordSession(sessionOptions);
      } else {
        // 经典 = 今日计划:进来先把 phase 摆正,否则会被上一次停在反向/汉字的
        // 当天状态劫持 —— 选了经典却出反向题。
        data = continueTodayPlanStudy();
      }
      if (mode === "classic" && !data.card && data.stats.stage1Done) {
        const tailCard = getDailyTailNext();
        if (tailCard) {
          setCard(tailCard);
          setUnitKey(null);
          setUnitTarget(null);
          setStats(data.stats);
          setPhase("daily-tail");
          setTailActive(true);
          setReliefActive(false);
          setRevealed(false);
          return;
        }
      }
      setCard(data.card);
      setUnitKey(data.unitKey ?? null);
      setUnitTarget(data.unitTarget ?? null);
      setStats(data.stats);
      setPhase(data.phase);
      setReliefActive(false);
      setReliefLeaving(false);
      setTailActive(false);
      setCanUndo(Boolean(data.canUndo));
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
    if (!reliefActive || !card || reliefLeaving || loading) return;
    const dealTimer = window.setTimeout(() => {
      triggerReliefHaptic();
      playReliefDeal();
      setReliefLeaving(true);
      window.setTimeout(() => {
        const before = stats;
        advanceDailyRelief();
        const nextRelief = getDailyReliefNext();
        if (nextRelief) {
          const refreshed = continueTodayPlanStudy();
          playCountdownFeedbackIfNeeded(before, refreshed.stats);
          setCard(nextRelief);
          setUnitKey(null);
          setUnitTarget(null);
          setStats(refreshed.stats);
          setPhase("relief");
          setRevealed(true);
          setReliefLeaving(false);
          return;
        }
        setReliefActive(false);
        setReliefLeaving(false);
        void loadNext(initialMode);
      }, RELIEF_LEAVE_MS);
    }, RELIEF_DWELL_MS);
    return () => window.clearTimeout(dealTimer);
  }, [card?.id, initialMode, loading, reliefActive, reliefLeaving, stats]);

  useEffect(() => {
    if (!dailyReviewIntro) return;
    const timer = window.setTimeout(() => setDailyReviewIntro(false), 1100);
    return () => window.clearTimeout(timer);
  }, [dailyReviewIntro]);

  useEffect(() => {
    const handlePreferences = (event: Event) => {
      setPreferences((event as CustomEvent<StudyPreferences>).detail ?? getStudyPreferences());
    };
    window.addEventListener(PREFERENCES_EVENT, handlePreferences);
    return () => window.removeEventListener(PREFERENCES_EVENT, handlePreferences);
  }, []);

  // 具体读什么、用文件还是用系统语音,都在 lib/speech.ts 里决定;这里只管开关。
  //
  // 字音单位卡念的是**这一段的读音**,不是整个例词:卡片问「見る 里的 見 读什么」,
  // 答案是 み,念成「みる」等于答非所问。例词只有音频文件,单段没有,会自动落到
  // 合成语音念那几个假名 —— 这正是要的。
  const speakCard = useCallback((target: WordCard) => {
    if (!preferences.autoPlay) return;
    if (unitTarget?.reading) {
      void playPronunciation(unitTarget.text ?? "", unitTarget.reading, preferences.voiceId);
      return;
    }
    void playPronunciation(target.kanji, target.kana, preferences.voiceId);
  }, [preferences.autoPlay, preferences.voiceId, unitTarget]);

  const sendStudySeconds = useCallback(async (seconds: number) => {
    if (seconds <= 0) return null;
    setLocalStudySeconds((value) => value + seconds);
    try {
      const data = addWordStudySeconds(seconds);
      setStats(data.stats);
      setLocalStudySeconds(0);

      // 学习时长写在数据库里(addWordStudySeconds),那才是跨设备合并的那份账本。
      // 这里只顺手看一眼成就 —— 它读的也是同一份账本。
      //
      // 原来这里还往 userProfile 里攒一份分钟数:`Math.floor(seconds / 60)`,
      // 而 flush 是每 15 秒一次,这个式子恒等于 0,所以那份计数器一次都没涨过,
      // 个人信息页常年「累计 0 小时 0 分钟」。整段删掉,不再攒第二份。
      await checkAchievements();

      return data.stats;
    } catch {
      // Time tracking should never interrupt review.
      return null;
    }
  }, []);

  const pageVisible = () => document.visibilityState === "visible";

  /** 结上一段的账，把攒够的整秒取出来落库(零头留着，见 study-clock.ts) */
  const elapsedStudySeconds = () => {
    const accrued = accrueStudyTime(studyClockRef.current, Date.now(), { visible: pageVisible() });
    const { seconds, state } = drainStudySeconds(accrued);
    studyClockRef.current = state;
    return seconds;
  };

  useEffect(() => {
    trackingActiveRef.current = Boolean(card);
    // 换卡本身就是一次交互(刚点过评分)，顺手把上一段结掉。
    studyClockRef.current = noteStudyInteraction(studyClockRef.current, Date.now(), { visible: pageVisible() });
  }, [card?.id, unitKey]);

  useEffect(() => {
    const flushStudyTime = async () => {
      if (!trackingActiveRef.current) return;
      await sendStudySeconds(elapsedStudySeconds());
    };

    // 「有没有在操作」的口径:点、按键、滚、划都算,**鼠标移动不算** ——
    // 鼠标扫过、页面轻微抖一下都会误判成还在学。
    const handleInteraction = () => {
      studyClockRef.current = noteStudyInteraction(studyClockRef.current, Date.now(), { visible: pageVisible() });
    };
    const interactionEvents = ["pointerdown", "keydown", "wheel", "scroll", "touchmove"] as const;
    interactionEvents.forEach((name) => {
      // scroll 只在实际滚动的那个容器上冒不上来，得用捕获;全部 passive,不挡手势。
      document.addEventListener(name, handleInteraction, { capture: true, passive: true });
    });

    const interval = window.setInterval(flushStudyTime, 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushStudyTime();
      } else {
        // 切回来的那一刻算一次交互:人刚回到这张卡上。
        handleInteraction();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      interactionEvents.forEach((name) => {
        document.removeEventListener(name, handleInteraction, { capture: true });
      });
      document.removeEventListener("visibilitychange", handleVisibility);
      flushStudyTime();
    };
  }, [sendStudySeconds]);

  useEffect(() => {
    setNoteText(card?.note ?? "");
    setNoteEditorOpen(false);
    setNoteMemoryOpen(false);
    setPromptEditorOpen(false);
    setDistinctionOpen(false);
    setActivePopover(null);
  }, [card?.id]);

  const submitAnswer = useCallback(async (answer: WordAnswer, source: "pointer" | "key" | "swipe" = "pointer") => {
    // submittingRef is synchronous, so a second tap is blocked immediately —
    // before React can re-render the `disabled`/`submitting` state — which is
    // what the `submitting` state alone could miss on a fast double-tap.
    if (!card || submittingRef.current || submitting || reliefActive || dailyReviewIntro) return;
    // 刚翻面的那几十毫秒不收**手指**评分 —— 见 REVEAL_INPUT_LOCK_MS。
    // 键盘不受这道闸:那条路上「显示答案」和评分是不同的键,不存在同一个位置连击的问题,
    // 拦一下只会吃掉快手用户的合法输入。甩卡也不受:它自己要先飞 240ms,早就过去了。
    if (source === "pointer" && performance.now() - revealedAtRef.current < REVEAL_INPUT_LOCK_MS) return;
    const answeredCardId = card.id;
    const answeredUnitKey = unitKey;
    const wasDailyReview = dailyReviewActive;
    const wasTail = tailActive;
    const beforeStats = stats;
    submittingRef.current = true;
    triggerMemoryHaptic(answer);
    // 认识 → 上行两音;不认识 → 柔和下行两音。同时播按钮反馈动画。
    //
    // 这里**不要**再为了「让按一下有分量」压一帧 200ms 的 stall:动画是 CSS 的,
    // 本来就能和下一张卡的计算并行播完,而那 200ms 是每次评分都实打实的一顿。
    const good = answer === "know" || answer === "known_forever";
    // 连对时音高顺着五声音阶往上爬。断掉时的**重置本身就是反馈** ——
    // 所以不需要任何「连击中断」的文案,答错音(柔和下行)后面接一个复位的起点,
    // 语义已经是通的。这个计数只喂声音,不进 FSRS、不进任何调度。
    if (good) {
      playKnow(correctStreakRef.current);
      correctStreakRef.current += 1;
    } else {
      correctStreakRef.current = 0;
      playDontKnow();
    }
    // 甩卡不补印章:跟手时的印章 + 飞出去那一下已经把话说完了,再来一个是重复。
    if (source !== "swipe") {
      rateBurstSeqRef.current += 1;
      setRateBurst({ good, label: rateBurstLabels[answer], seq: rateBurstSeqRef.current });
      window.clearTimeout(rateBurstTimerRef.current);
      rateBurstTimerRef.current = window.setTimeout(() => setRateBurst(null), RATE_BURST_MS);
    }
    setSubmitting(true);
    setError("");
    try {
      const data = answeredUnitKey && phase === "kanji"
        ? submitKanjiUnitAnswer(answeredUnitKey, answer)
        : submitWordAnswer(answeredCardId, answer, sessionOptions);
      let nextStats = data.stats;
      if (!data.card && trackingActiveRef.current) {
        trackingActiveRef.current = false;
        const trackedStats = await sendStudySeconds(elapsedStudySeconds());
        if (trackedStats) nextStats = trackedStats;
      }

      playCountdownFeedbackIfNeeded(beforeStats, nextStats);

      // 当日错题回顾只改变这一轮的出牌顺序，答题本身仍然走正式 FSRS。
      if (wasDailyReview) {
        dailyReviewAttemptsRef.current += 1;
        if (good) dailyReviewResolvedRef.current.add(answeredCardId);
        const failureCount = good
          ? (dailyReviewFailuresRef.current.get(answeredCardId) ?? 0)
          : (dailyReviewFailuresRef.current.get(answeredCardId) ?? 0) + 1;
        if (!good) dailyReviewFailuresRef.current.set(answeredCardId, failureCount);
        const shouldExitReview = dailyReviewAttemptsRef.current >= DAILY_REVIEW_MAX_ATTEMPTS
          || (!good && failureCount >= DAILY_REVIEW_MAX_FAILURES_PER_WORD);

        if (!shouldExitReview) {
          dailyReviewCooldownRef.current = [
            ...dailyReviewCooldownRef.current.filter((id) => id !== answeredCardId),
            answeredCardId
          ].slice(-DAILY_REVIEW_COOLDOWN_LENGTH);
        }
        const spacedExcluded = new Set([
          ...dailyReviewResolvedRef.current,
          ...dailyReviewCooldownRef.current
        ]);
        const nextReviewCard = shouldExitReview
          ? null
          : pickDailyReviewNext(spacedExcluded) ?? pickDailyReviewNext(dailyReviewResolvedRef.current);
        if (nextReviewCard) {
          setCard(nextReviewCard);
          setUnitKey(null);
          setUnitTarget(null);
          setStats(nextStats);
          setPhase("daily-mistakes");
          setCanUndo(false);
          setRevealed(false);
          return;
        }

        dailyReviewResolvedRef.current.clear();
        dailyReviewAttemptsRef.current = 0;
        dailyReviewFailuresRef.current.clear();
        dailyReviewCooldownRef.current = [];
        setDailyReviewActive(false);
        setDailyReviewIntro(false);
        const tailCard = !data.card && nextStats.stage1Done ? getDailyTailNext() : null;
        if (tailCard) {
          setCard(tailCard);
          setUnitKey(null);
          setUnitTarget(null);
          setStats(nextStats);
          setPhase("daily-tail");
          setTailActive(true);
          setCanUndo(false);
          setRevealed(false);
          playComplete();
          return;
        }
        setCard(data.card);
        setUnitKey(data.unitKey ?? null);
        setUnitTarget(data.unitTarget ?? null);
        setStats(nextStats);
        setPhase(data.phase);
        setCanUndo(Boolean(data.canUndo));
        setRevealed(false);
        if (!data.card) playComplete();
        if (!data.card && !completionReportedRef.current && isDailyModeComplete(initialMode, nextStats)) {
          completionReportedRef.current = true;
          onDailyModeComplete?.(initialMode);
        }
        return;
      }

      // 压轴卡不计入今日任务，但答题依然写入原有 FSRS。只有压轴全部答完，
      // 才允许进入真正的完成页和自动错题本切换。
      if (wasTail) {
        advanceDailyTail();
        const refreshedStats = getWordStats("stage1");
        playCountdownFeedbackIfNeeded(beforeStats, refreshedStats);
        const nextTailCard = getDailyTailNext();
        if (nextTailCard) {
          setCard(nextTailCard);
          setUnitKey(null);
          setUnitTarget(null);
          setStats(refreshedStats);
          setPhase("daily-tail");
          setTailActive(true);
          setCanUndo(false);
          setRevealed(false);
          return;
        }
        setTailActive(false);
        setCard(null);
        setUnitKey(null);
        setUnitTarget(null);
        setStats(refreshedStats);
        setPhase(data.phase);
        setCanUndo(false);
        setRevealed(false);
        playComplete();
        if (!completionReportedRef.current && isDailyModeComplete(initialMode, refreshedStats)) {
          completionReportedRef.current = true;
          onDailyModeComplete?.(initialMode);
        }
        return;
      }

      // 60%~80% 区间内发现四张以上「今天已经看到四次仍没清掉」的词，
      // 先完成一轮当日错题回顾，再回到原来的今日计划。
      if (
        initialMode === "classic"
        && phase === "stage1"
        && !dailyReviewTriggeredRef.current
        && shouldStartDailyReview()
      ) {
        const reviewCard = pickDailyReviewNext();
        if (reviewCard) {
          dailyReviewTriggeredRef.current = true;
          markDailyReviewTriggered();
          dailyReviewResolvedRef.current.clear();
          dailyReviewAttemptsRef.current = 0;
          dailyReviewFailuresRef.current.clear();
          dailyReviewCooldownRef.current = [];
          setDailyReviewActive(true);
          setDailyReviewIntro(true);
          setCard(reviewCard);
          setUnitKey(null);
          setUnitTarget(null);
          setStats(nextStats);
          setPhase("daily-mistakes");
          setCanUndo(false);
          setRevealed(false);
          return;
        }
      }

      const tailCard = !data.card && nextStats.stage1Done ? getDailyTailNext() : null;
      if (tailCard) {
        setCard(tailCard);
        setUnitKey(null);
        setUnitTarget(null);
        setStats(nextStats);
        setPhase("daily-tail");
        setTailActive(true);
        setCanUndo(false);
        setRevealed(false);
        playComplete();
        return;
      }

      setCard(data.card);
      setUnitKey(data.unitKey ?? null);
      setUnitTarget(data.unitTarget ?? null);
      setStats(nextStats);
      setPhase(data.phase);
      setReliefActive(false);
      setReliefLeaving(false);
      setTailActive(false);
      setCanUndo(Boolean(data.canUndo));
      setRevealed(false);
      // 同一个顽固词可能被立即再次排到。它的 id 没变，下面依赖 card.id 的
      // effect 不会执行，所以必须在「一次作答已结束」这个轮次边界主动收起
      // 上次翻面弹出的备注；下一次翻面时仍会照常重新弹出。
      setNoteText(data.card?.note ?? "");
      setNoteEditorOpen(false);
      setNoteMemoryOpen(false);
      setDistinctionOpen(false);
      setActivePopover(null);
      if (!data.card) playComplete();
      if (!data.card && !completionReportedRef.current && isDailyModeComplete(initialMode, nextStats)) {
        completionReportedRef.current = true;
        onDailyModeComplete?.(initialMode);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      // 这里**不要**清印章。改版前是 setRateFeedback(null),而它和上面那次 set
      // 落在同一个同步 tick 里(submitWordAnswer 是同步 SQLite,常见路径没有 await),
      // React 一批处理,中间态从来没渲染过。印章的收尾交给 RATE_BURST_MS 那个计时器。
    }
  }, [card, dailyReviewActive, dailyReviewIntro, initialMode, onDailyModeComplete, phase, reliefActive, sendStudySeconds, sessionOptions, stats, submitting, tailActive]);

  useEffect(() => () => window.clearTimeout(rateBurstTimerRef.current), []);

  const revealAnswer = useCallback(() => {
    if (!card || loading || revealed || submitting || reliefActive || dailyReviewIntro) return;
    revealedAtRef.current = performance.now();
    setRevealed(true);
    playFlip();
    // 翻面在此之前只有声音没有触觉,而它是整个循环里最高频的一下。
    triggerRevealHaptic();
    setNoteEditorOpen(false);
    if (card.note) {
      setNoteMemoryOpen(true);
      setActivePopover("noteMemory");
    } else {
      setNoteMemoryOpen(false);
      setActivePopover(null);
    }
    speakCard(card);
  }, [card, dailyReviewIntro, loading, reliefActive, revealed, speakCard, submitting]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Keep browser/app shortcuts and text editing untouched.
      if (
        event.defaultPrevented
        || event.repeat
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || distinctionOpen
        || isEditableTarget(event.target)
      ) return;

      const key = event.key.toLowerCase();
      if (revealed) {
        const answer = answerHotkeys[key];
        if (!answer || !card || submitting) return;
        event.preventDefault();
        void submitAnswer(answer, "key");
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
  }, [card, distinctionOpen, loading, revealed, submitting, submitAnswer, revealAnswer, unitKey, phase]);

  const undo = async () => {
    setSubmitting(true);
    setError("");
    try {
      const data = undoLastWordAnswer(sessionOptions);
      // 撤销了刚才那次作答,音高台阶也该跟着退回起点(不做精确回退:撤销很少用,
      // 而多爬一级和少爬一级都比「撤销了但还在高音上」说不通)
      correctStreakRef.current = 0;
      setCard(data.card);
      setUnitKey(data.unitKey ?? null);
      setUnitTarget(data.unitTarget ?? null);
      setStats(data.stats);
      setPhase(data.phase);
      setReliefActive(false);
      setReliefLeaving(false);
      setDailyReviewActive(false);
      setDailyReviewIntro(false);
      setTailActive(false);
      setCanUndo(Boolean(data.canUndo));
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
      setActivePopover(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "便签保存失败");
    } finally {
      setNoteSaving(false);
    }
  };

  /**
   * 保存改写后的题面。清空 = 恢复原文。
   *
   * **不顺手评分**：这时答案已经全露着，替用户按一个「记得」等于给 FSRS 灌假数据。
   * 底下那个「保存并记模糊」是用户自己点的，含义是「这次题面没分清，别算我忘了」。
   */
  const savePromptMeaning = async (thenAnswer?: WordAnswer) => {
    if (!card || promptSaving) return;
    setPromptSaving(true);
    setError("");
    try {
      const data = updateWordQuestionMeaning(card.id, promptText);
      setCard((current) => current && current.id === data.wordId
        ? { ...current, questionMeaning: data.questionMeaning, promptMeaning: data.promptMeaning }
        : current);
      setPromptText(data.isOverridden ? data.questionMeaning : "");
      setPromptEditorOpen(false);
      setActivePopover(null);
      if (thenAnswer) await submitAnswer(thenAnswer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "题面保存失败");
    } finally {
      setPromptSaving(false);
    }
  };

  const openPromptEditor = () => {
    if (!card) return;
    setPromptText(card.questionMeaning || card.promptMeaning || "");
    setNoteEditorOpen(false);
    setNoteMemoryOpen(false);
    setPromptEditorOpen(true);
    setActivePopover("prompt");
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

  const jumpToSimilar = (targetWordId: number) => {
    if (!card || submittingRef.current || submitting) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const data = jumpToSimilarWord(card.id, targetWordId, sessionOptions);
      setCard(data.card);
      setUnitKey(data.unitKey ?? null);
      setUnitTarget(data.unitTarget ?? null);
      setStats(data.stats);
      setPhase(data.phase);
      setReliefActive(false);
      setReliefLeaving(false);
      setDailyReviewActive(false);
      setDailyReviewIntro(false);
      setTailActive(false);
      setCanUndo(Boolean(data.canUndo));
      setRevealed(false);
      setNoteEditorOpen(false);
      setNoteMemoryOpen(false);
      setDistinctionOpen(false);
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
  const isUnitKanji = isKanjiPhase && Boolean(unitTarget);
  // 顶栏按钮和答案区那一行入口共用这一份 —— 两处从来就该是同一件事。
  // 反向/汉字模式不给：那两个模式的题面本身就是中文或汉字，摆出同义词等于送答案。
  const distinctions = useMemo(
    () => (distinctionsReady && card && !isReversePhase && !isKanjiPhase ? wordDistinctions(card) : []),
    [card, distinctionsReady, isReversePhase, isKanjiPhase]
  );

  /**
   * 和这张卡共用同一行题面的其他词。
   *
   * 只在正向题算：反向题日文就在眼前，汉字读音题考的是读音，两者都不存在
   * 「题面在问哪个词」这回事。sameMora 标的是拍数提示也分不开的那些 ——
   * 实测残余 1,967 个词里 78.5% 只剩 2 个候选，摆出来一眼就知道自己想的是不是它。
   */
  const questionRivals = useMemo(() => {
    if (!card || isReversePhase || isKanjiPhase) return [];
    const mine = moraCount(card.kana);
    return questionMeaningRivals(card.id)
      .map((peer) => ({ ...peer, sameMora: moraCount(peer.kana) === mine }))
      .sort((a, b) => Number(b.sameMora) - Number(a.sameMora));
  }, [card, isReversePhase, isKanjiPhase]);

  useEffect(() => {
    // 让第一张卡先画出来,索引在下一个 tick 里建 —— 建完辨析入口自己会出现
    const timer = window.setTimeout(() => {
      warmConfusionGroups();
      setDistinctionsReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
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
      await yieldToPaint();
      const data = phaseName === "stage2" ? continueStage2Study() : continueKanjiStudy();
      setCard(data.card);
      setUnitKey(data.unitKey ?? null);
      setUnitTarget(data.unitTarget ?? null);
      setStats(data.stats);
      setPhase(data.phase);
      setReliefActive(false);
      setReliefLeaving(false);
      setDailyReviewActive(false);
      setDailyReviewIntro(false);
      setTailActive(false);
      setCanUndo(Boolean(data.canUndo));
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
      await yieldToPaint();
      const data = startEncoreSession(size);
      setCard(data.card);
      setUnitKey(data.unitKey ?? null);
      setUnitTarget(data.unitTarget ?? null);
      setStats(data.stats);
      setPhase(data.phase);
      setReliefActive(false);
      setReliefLeaving(false);
      setDailyReviewActive(false);
      setDailyReviewIntro(false);
      setTailActive(false);
      setCanUndo(Boolean(data.canUndo));
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
  const swipeEnabled = Boolean(card) && revealed && !submitting && !reliefActive && !dailyReviewIntro;

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    gestureRef.current = { x: touch.clientX, y: touch.clientY, axis: null };
    swipeArmedRef.current = 0;
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
      // 越过/退回提交阈值的那一帧给一次触觉。改版前「甩够了没」只有印章的
      // 透明度在说,必须盯着屏幕看 —— 而甩卡本来就是不用看也能做的动作。
      // 只在**跨越**时触发,不是每帧都震(那会变成手机在抽搐)。
      const armed: 0 | 1 | -1 = Math.abs(dx) >= SWIPE_COMMIT_PX ? (dx > 0 ? 1 : -1) : 0;
      if (armed !== swipeArmedRef.current) {
        swipeArmedRef.current = armed;
        triggerSwipeArmHaptic();
      }
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
    swipeArmedRef.current = 0;

    // 甩过阈值 → 卡片顺着惯性飞出去,飞完再提交(右=认识 / 左=忘记)
    if (gesture?.axis === "x" && swipeEnabled && Math.abs(swiped) >= SWIPE_COMMIT_PX) {
      const direction = swiped > 0 ? 1 : -1;
      setFlingDir(direction);
      window.setTimeout(() => {
        setFlingDir(0);
        setSwipeX(0);
        submitAnswer(direction > 0 ? "know" : "forgot", "swipe");
      }, SWIPE_FLING_MS);
      return;
    }
    setSwipeX(0);
  };

  // 跟手位移 →(飞出时换成整屏宽度)
  const cardShift = flingDir ? flingDir * FLING_DISTANCE : swipeX;
  const cardRotate = Math.max(-SWIPE_MAX_ROTATE, Math.min(SWIPE_MAX_ROTATE, cardShift / 40));
  const swipeProgress = Math.min(Math.abs(swipeX) / SWIPE_COMMIT_PX, 1);
  const countdownRemaining = remainingPlanWords(stats);
  const countdownActive = !loading
    && !dailyReviewActive
    && countdownRemaining > 0
    && countdownRemaining <= 30
    && initialMode === "classic";

  return (
    <div
      className={`word-study-shell mx-auto flex max-w-4xl flex-col justify-center lg:max-w-[1200px]${countdownActive ? " word-study-countdown" : ""}${dailyReviewActive ? " word-study-daily-review" : ""}`}
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
        className={`dictionary-card relative flex h-full min-h-0 flex-col rounded-2xl ${showStudyToolbar ? "px-3 pb-2 pt-3 sm:p-8 lg:p-7" : "px-3 pb-2 pt-3 sm:p-5"}${reliefActive ? " daily-relief-card" : ""}${reliefLeaving ? " daily-relief-card-leaving" : ""}${dailyReviewActive ? " daily-review-card" : ""}`}
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
        {/* 点评分的印章。活在卡片子树**之外**,所以能一边播完自己的动画,
            一边让下一张卡照常入场 —— 见 rateBurst 上的注释。 */}
        {rateBurst && (
          <span
            key={rateBurst.seq}
            className={`zoo-rate-burst ${rateBurst.good ? "good" : "bad"}`}
            aria-hidden="true"
          >
            {rateBurst.label}
          </span>
        )}
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
                setActivePopover(next ? "note" : null);
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
            disabled={submitting || !canUndo}
            className="focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15 disabled:opacity-50"
            title={canUndo ? "上一个" : "没有可撤销的作答"}
          >
            <RotateCcw size={17} />
          </button>
          {distinctions.length > 0 && (
            <button
              onClick={() => setDistinctionOpen(true)}
              className={`focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 hover:bg-[#81D8CF]/15 ${distinctionOpen ? "bg-[#81D8CF] !text-[#2f3333]" : "bg-[#81D8CF]/10"}`}
              title="查看辨析"
              aria-label="查看辨析"
              aria-expanded={distinctionOpen}
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
                  setActivePopover(null);
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
                  setActivePopover(null);
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

        {promptEditorOpen && card && (
          <div
            className="word-note-popover word-note-float prompt-edit-card overflow-y-auto rounded-2xl border p-4 text-left shadow-lg"
            style={{ zIndex: activePopover === "prompt" ? 50 : 35 }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">改写题面</p>
                <p className="jp mt-1 text-lg font-semibold">{cardLabel(card)}</p>
              </div>
              <button
                onClick={() => {
                  setPromptEditorOpen(false);
                  setActivePopover(null);
                }}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/15 bg-white/5"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
            {/* 词库原文摆在上面：题面只是它的首义，你多半想从后面几个义项里挑个词。 */}
            <div className="rounded-2xl border border-white/12 bg-white/5 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">词库原文</p>
              <p className="mt-1 text-sm leading-6 text-white/75">{card.meaning}</p>
            </div>
            <input
              value={promptText}
              onChange={(event) => setPromptText(event.target.value)}
              className="mt-3 w-full rounded-2xl border border-white/20 bg-[#2f3333] p-3 text-base leading-6 text-white placeholder:text-white/45"
              placeholder="下次这道题的题面写什么"
            />
            {/* 题面框在手机上大约放得下十几个字，超了会自己滚 —— 不设硬上限，
                但得让人看得见自己写多长了。 */}
            <p className="mt-2 text-[11px] text-white/40">
              {promptText.trim().length} 字 · 留空并保存 = 恢复成词库原文
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {/* 这次的作答是在旧题面上做的，不该算数。「记模糊」是用户自己点的，
                  不做成保存后自动评分 —— 那等于替他给 FSRS 写结论。 */}
              {revealed && !submitting && (
                <button
                  onClick={() => savePromptMeaning("fuzzy")}
                  disabled={promptSaving}
                  className="focus-ring rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  保存并记模糊
                </button>
              )}
              <button
                onClick={() => savePromptMeaning()}
                disabled={promptSaving}
                className="focus-ring rounded-2xl bg-[#81D8CF] px-4 py-2 text-sm font-bold !text-[#2f3333] disabled:opacity-50"
              >
                {promptSaving ? "保存中" : "保存"}
              </button>
            </div>
          </div>
        )}

        </div>

        {distinctionOpen && card && (
          <DistinctionSheet
            // 翻面前标题只能写题面那行中文 —— 写 cardLabel 等于把答案印在气泡顶上
            title={revealed ? cardLabel(card) : (card.questionMeaning || card.promptMeaning || "辨析")}
            sections={distinctions}
            revealed={revealed}
            onClose={() => setDistinctionOpen(false)}
            onJump={jumpToSimilar}
            jumpDisabled={submitting}
          />
        )}

        {reliefActive && stats?.dailyRelief && (
          <div className="daily-relief-banner" role="status" aria-live="polite">
            <span className="daily-relief-banner-spark">✦</span>
            <strong>昨日表现很棒，今日减负（{stats.dailyRelief.total}）个！</strong>
            <span>这几张只是把已记住的好消息发给你，不增加今日负担</span>
          </div>
        )}
        {dailyReviewActive && (
          <div className={`daily-review-banner${dailyReviewIntro ? " daily-review-banner-intro" : ""}`} role="status" aria-live="polite">
            <span>当日错题回顾</span>
            <strong>记住一张，红色就少一张</strong>
            <small>模糊会隔开再来，本轮最多回顾25次</small>
          </div>
        )}
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
          <div
            key={`${card.id}:${unitKey ?? "word"}`}
            className={`zoo-enter flex min-h-0 flex-1 flex-col gap-2 sm:gap-3${isKanjiPhase && !revealed ? " cursor-pointer" : ""}`}
            onClick={(event) => {
              if (!isKanjiPhase || revealed) return;
              const element = event.target instanceof Element ? event.target : null;
              if (element?.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
              revealAnswer();
            }}
          >
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
                  {/* 拍数只给正向题:题面是一行中文,常常好几个词都对得上(警察 / 警察官 /
                      警官)。反向题日文就在眼前,汉字读音题的读音是要考的那个,都不给。
                      口径和为什么是拍不是音节,见 word-study-utils 的 moraCount。 */}
                  {!isReversePhase && !isKanjiPhase && moraCount(card.kana) > 0 && (
                    <span
                      className="rounded-sm border border-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white/60"
                      title="读音有几拍（拗音算一拍，っ・ん・ー 各算一拍）"
                    >
                      {moraCount(card.kana)}拍
                    </span>
                  )}
                </div>
                <div data-word-scrollable="true" className="max-h-24 w-full overflow-y-auto px-1 sm:max-h-28">
                  {isUnitKanji ? (
                    <p className="jp-serif break-words text-4xl font-semibold leading-tight sm:text-6xl lg:text-7xl">{unitTarget?.text}</p>
                  ) : isReversePhase ? (
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
                <div className="zoo-reveal-in w-full min-w-0">
                  {isReversePhase ? (
                    <>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">释义</p>
                      <p className="mx-auto mt-4 max-w-2xl text-2xl font-semibold leading-9 text-white/88">{card.meaning}</p>
                    </>
                  ) : isUnitKanji ? (
                    <>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">读音</p>
                      <p className="jp-serif mt-4 text-6xl font-semibold leading-none sm:text-7xl lg:text-8xl">{unitTarget?.reading}</p>
                      <p className="mt-4 text-sm text-white/55">来自 {card.kanji} · {card.meaning}</p>
                    </>
                  ) : (
                    <>
                      <p className="jp-serif text-6xl font-semibold leading-none sm:text-7xl lg:text-8xl xl:text-[9rem]">
                        <KanjiAnswer card={card} surface={isKanjiPhase ? kanjiReadingSurface(card) : undefined} />
                      </p>
                      {/* 自他跟读音同一行:它是这个词的属性,不值得单占一行。
                          等级/词性已经在题目面常驻,这里不再重复。 */}
                      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                        <ReadingLine
                          card={card}
                          surface={isKanjiPhase ? kanjiReadingSurface(card) : undefined}
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
                  {/* 这里曾经补一行 words.meaning 原文,条件是「和题面不一样就显示」。
                      在 5,853 条人工题面落地之前那还说得通;之后**题面才是更完整的那个**,
                      这行剩下的是老词库原文,而且 25.1%(2,777 个词)都会触发:
                        安全  题面「安全」        这行「安全的」
                        空港  题面「机场」        这行「空港」   ← 根本不是中文翻译
                        経験  题面「经验；经历」   这行「经验」   ← 信息更少
                        柄    题面「体格；人品；身份；花样」  这行「花样；性质」 ← 换了一组义项
                      「有的词有有的词没有」也是这个条件造出来的。已删。
                      想看词库原文的话,「改写题面」的编辑框里一直摆着。 */}
                  <ExampleBlock card={card} />
                  {(markedKanji.length > 0 || card.verbPair || distinctions.length > 0) && !isReversePhase && (
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

                      {distinctions.length > 0 && (
                        <button
                          type="button"
                          className="wd-entry sm:col-span-2"
                          onClick={() => setDistinctionOpen(true)}
                        >
                          <span className="wd-entry-main">
                            <span className="wd-entry-types">
                              {distinctions.slice(0, 2).map((section) => `${section.emoji} ${section.name}`).join("  ·  ")}
                              {distinctions.length > 2 ? `  +${distinctions.length - 2}` : ""}
                            </span>
                            <span className="jp-serif wd-entry-words">
                              {distinctions[0].members.map((member) => member.word).join(" / ")}
                            </span>
                          </span>
                          <span className="wd-entry-go">点开对照</span>
                          <ChevronRight size={16} className="wd-entry-go" />
                        </button>
                      )}
                    </div>
                  )}
                  {/* 摆在答案区**最下面**：改写题面是个一年用不了几次的功能，
                      忘了它存在也不影响背词，不该在每张卡的答案上方占位置。
                      撞车面板跟着一起下来 —— 它是那个按钮的上下文（「这几个词和它共用同一行题面」），
                      拆开摆会变成两个都要解释的东西。实测只有 6.7% 的词会摆出整张卡，
                      其余只留一行灰字入口。 */}
                  {!isReversePhase && !isKanjiPhase && (
                    questionRivals.length > 0 ? (
                    <div className="mx-auto mt-4 max-w-2xl rounded-2xl border border-white/15 bg-[#373b3b] p-4 text-left">
                      {(
                        <>
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                            题面撞车 · {questionRivals.length + 1} 个词共用「{card.questionMeaning || card.promptMeaning}」
                          </p>
                          {/* 摆出来是为了让你当场判断「我想的那个是不是也在里面」——
                              翻面之前不摆，那会变成给答案。 */}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {questionRivals.map((peer) => (
                              <span
                                key={peer.id}
                                title={peer.meaning}
                                className={`jp inline-flex items-baseline gap-1.5 rounded-sm border px-2 py-1 text-sm ${
                                  peer.sameMora
                                    ? "border-[#81D8CF]/40 bg-[#81D8CF]/15 font-semibold text-white/90"
                                    : "border-white/15 text-white/60"
                                }`}
                              >
                                {peer.label}
                                <span className="text-[11px] font-normal text-white/45">{moraCount(peer.kana)}拍</span>
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 text-[11px] leading-5 text-white/45">
                            高亮的是拍数也一样、题面分不出来的。改写题面只影响你自己这台设备上的这份库。
                          </p>
                        </>
                      )}
                      <button
                        onClick={openPromptEditor}
                        className="focus-ring mt-3 inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-[#81D8CF]/10 px-3 py-2 text-sm font-semibold hover:bg-[#81D8CF]/15"
                      >
                        <Pencil size={14} />
                        改写题面
                      </button>
                    </div>
                    ) : (
                      <button
                        onClick={openPromptEditor}
                        className="focus-ring mx-auto mt-3 inline-flex items-center gap-1.5 rounded-2xl px-2 py-1 text-xs text-white/40 hover:text-white/70"
                      >
                        <Pencil size={12} />
                        改写题面
                      </button>
                    )
                  )}
                </div>
              ) : isUnitKanji ? (
                <div className="w-full">
                  <p className="jp-serif text-6xl font-semibold leading-none sm:text-7xl lg:text-8xl xl:text-[9rem]">{unitTarget?.text}</p>
                  <p className="mt-5 text-sm font-semibold text-white/52">点一下，显示这个汉字单元的读音</p>
                </div>
              ) : isKanjiPhase ? (
                <div className="w-full">
                  <p className="jp-serif text-6xl font-semibold leading-none sm:text-7xl lg:text-8xl xl:text-[9rem]">
                    <KanjiAnswer card={card} surface={kanjiReadingSurface(card)} />
                  </p>
                  <ReadingLine
                    card={card}
                    concealKanji
                    surface={kanjiReadingSurface(card)}
                    className="jp mt-3 text-3xl text-white/78 sm:text-4xl lg:text-5xl xl:text-6xl"
                  />
                  <p className="mt-5 text-sm font-semibold text-white/52">点一下，显示汉字读音</p>
                </div>
              ) : (
                <div>
                  <p className="text-2xl font-semibold text-white/70">答案已隐藏</p>
                  <p className="mt-3 text-sm text-white/55">{isReversePhase ? "先回忆中文释义" : "先回忆假名和汉字"}</p>
                </div>
              )}
            </div>

            <div className="relative h-16 lg:mx-auto lg:w-[min(900px,100%)]">
              {reliefActive ? (
                <div className="daily-relief-auto-state" role="status" aria-live="polite">
                  <span>✓</span>
                  <strong>认识</strong>
                  <small>系统已快速收好这张卡</small>
                </div>
              ) : !revealed ? (
                <button
                  onClick={revealAnswer}
                  title={isKanjiPhase ? "点击或按任意普通键显示汉字读音" : "点击或按任意普通键显示答案"}
                  className="focus-ring zoo-pop zoo-gloss inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] px-4 text-base font-bold !text-[#2f3333]"
                >
                  <Eye size={18} />
                  <span>{isKanjiPhase ? "显示读音" : "显示答案"}</span>
                  <span className="text-xs font-semibold opacity-65">（按任意键）</span>
                </button>
              ) : (
                <>
                  {/* 忘记/认识 是主键,模糊/熟知 摆一半宽、不填色 —— 见 answerOptions 上的注释 */}
                  <div className="zoo-rate-row grid h-16 grid-cols-[1.35fr_0.65fr_1.35fr_0.65fr] gap-2 sm:gap-3">
                    {answerOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => submitAnswer(option.value)}
                        aria-keyshortcuts={answerHotkeyLabels[option.value]}
                        disabled={submitting}
                        className={`focus-ring zoo-pop h-16 min-w-0 rounded-2xl border disabled:opacity-50 ${
                          option.secondary
                            ? "border-white/12 px-1 text-sm font-semibold text-white/60 hover:bg-white/[0.06]"
                            : "border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15"
                        }`}
                      >
                        <span
                          className={`block text-[10px] font-black text-white/45 ${
                            option.secondary ? "tracking-normal" : "tracking-[0.18em]"
                          }`}
                        >
                          {answerHotkeyLabels[option.value]}
                        </span>
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
