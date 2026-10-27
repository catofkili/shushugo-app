import { StudyBuddy } from "../components/study-buddy/StudyBuddy";
import { createStudyBuddy } from "../lib/study-buddy";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { perfRecord } from "../lib/perf-marks";
import { AlertCircle, Check, ChevronRight, Eye, GitCompareArrows, Pencil, RotateCcw, Shuffle, Sparkles, Star, StickyNote, Timer, X } from "lucide-react";
import { WordAnswer, WordCard, WordSessionResponse, WordStats } from "../types/vocabulary";
import { addFavorite, addWordStudySeconds, advanceDailyRelief, advanceDailyTail, rewindDailyTail, continueKanjiStudy, continueStage2Study, continueTodayPlanStudy, getDailyReliefNext, getDailyTailNext, getWordSession, getWordStats, jumpToSimilarWord, markTodayWordCheckin, dailyReviewBatch, getDailyReviewCard, shouldInviteDailyReview, declineDailyReviewInvite, startDailyReviewRound, startEncore as startEncoreSession, submitKanjiUnitAnswer, submitWordAnswer, toggleFavorite, undoLastWordAnswer, questionMeaningRivals, updateWordNote, updateWordQuestionMeaning, addAnswerPreview, answerPreviewsFresh, startAnswerPreviews, submitWordAnswerWithPreview, takeAnswerPreview, type AnswerPreviews } from "../lib/api";
import { getStudyPreferences, PREFERENCES_EVENT, STUDY_BUDDY_SHELVED, StudyPreferences } from "../lib/studyPreferences";
import { checkAchievements } from "../lib/userProfile";
import { claimDailyPlanYuzu, settleYuzu } from "../lib/yuzu";
import { reportTeamActivity } from "../lib/team-activity";
import { triggerCountdownHaptic, triggerMemoryHaptic, triggerReliefHaptic, triggerRevealHaptic, triggerSwipeArmHaptic } from "../lib/haptics";
import { playPronunciation, prefetchPronunciation, prefetchWordPlanAudio, prefetchExamples } from "../lib/speech";
import { todayWordAudioPlan, tomorrowWordAudioPlan } from "../lib/word-api";
import { grammarAudioPlan } from "../lib/grammar-quiz";
import { playComplete, playCountdownTick, playDontKnow, playFlip, playKnow, playReliefDeal } from "../lib/zoo-sounds";
import {
  ExampleBlock,
  FinishPanel,
  KanjiAnswer,
  ReadingLine,
  TransitivityBadge
} from "../features/word-study/WordStudyPanels";
import {
  answerHotkeyLabels,
  answerOptions,
  cardLabel,
  kanaToRomaji,
  moraCount,
  primaryAnswerText,
} from "../features/word-study/word-study-utils";
import { kanjiReadingSurface } from "../lib/orthography";
import type { StudyMode } from "../types/app";
import { studyModeInfo } from "../lib/studyMode";
import { UNDO_LIMIT } from "../lib/word-api/undo-stack";
import type { WordSessionOptions } from "../lib/study-types";
import { DistinctionSheet } from "../components/DistinctionSheet";
import { StudyFocusChest } from "../components/StudyFocusChest";
import { Paywall } from "../components/Paywall";
import { ScrollArea } from "../components/ScrollArea";
import { useEntitlements } from "../hooks/useEntitlements";
import { canUseFeature } from "../lib/entitlements";
import { GrammarCard, QUIZ_ACCENT_AMBER } from "../features/grammar-quiz/GrammarCard";
import { KanjiCharCardView, KANJI_ACCENT } from "../features/mixed-study/KanjiCharCardView";
import { ConfusionCardView, MATCH_ACCENT } from "../features/mixed-study/ConfusionCardView";
import { loadMixedCardData, mixedCardDataLoaded } from "../lib/mixed-cards";
import {
  answerMixedOther, canUndoMixed, mixedTurnDue, mixedUndoKind, pickMixedNext, recordMixedWordAnswer,
  resetMixedSession, undoMixedOther, undoMixedWord, type MixedOtherItem
} from "../lib/mixed-session";
import { useFavoriteFolderPicker } from "../components/FavoriteFolderPicker";
import { wordDistinctions } from "../lib/models/word-distinctions";
import { warmConfusionGroups } from "../lib/confusion-groups";
import { yieldToPaint } from "../lib/yield-to-paint";
import { CapybaraWalk } from "../components/CapybaraMascot";
import { accrueStudyTime, createStudyClock, drainStudySeconds, noteStudyInteraction, STUDY_IDLE_LIMIT_MS } from "../lib/study-clock";
import { useApp } from "../app/AppContext";
import { claimStudyFocusReward, continueStudyFocus, enterStudyFocus, finishStudyFocusAtDailyCompletion, getStudyFocusSnapshot, isStudyFocusArmed, recordStudyFocusAnswer, recordStudyFocusTime, leaveStudyFocus, resumeStudyFocus, sameStudyFocusState, setStudyFocusArmed, startStudyFocus, stopStudyFocus, STUDY_FOCUS_BASELINE_DAYS, STUDY_FOCUS_MIN_WORDS, STUDY_FOCUS_WINDOW_MS, undoStudyFocusAnswer, type StudyFocusSnapshot } from "../lib/study-focus";
import { useStudyActivity, useStudyBreakTabBar } from "../hooks/useStudyActivity";

import { SpellingCardView } from "../features/spelling/SpellingCardView";
import { checkCardInput, spellingCard, spellingLookup } from "../lib/spelling/session";
import { shouldSpellWord } from "../lib/spelling/study";
import { today } from "../lib/study-core";
import { DailyReviewInvite, DailyReviewTopBar, DailyReviewComplete } from "../features/word-study/DailyReviewRound";
import { answerDailyReviewRound, createDailyReviewRound, dailyReviewRoundDone, nextDailyReviewId, roundWritesFsrs, type DailyReviewRound } from "../lib/word-api/daily-review-round";
import { StreakSpark } from "../components/streak/StreakMoments";

interface WordStudyProps {
  initialMode?: StudyMode;
  onDailyModeComplete?: (mode: StudyMode) => void;
  /** 完成页：今天顽固词太多时，把这批词交给快速学习过一遍（代替加餐）。 */
  onStubbornQuickStudy?: (wordIds: number[]) => void;
  onOpenDistinctionQuiz?: () => void;
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

/** 评分印章的字面。沿用甩卡印章的说法:● = 收下了,◦ = 再来一遍(不惩罚) */
const rateBurstLabels: Record<WordAnswer, string> = {
  forgot: "◦ 再来",
  fuzzy: "◦ 模糊",
  know: "● 认识",
  known_forever: "● 熟知"
};

const answerHotkeys: Record<string, WordAnswer> = {
  v: "forgot",
  b: "fuzzy",
  n: "know",
  m: "known_forever"
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

/** 经典和混合是同一份今日计划（同一条取词路径、同样的减负/压轴/回顾），混合另外还有语法 / 汉字 / 辨析三种卡（lib/mixed-session）。 */
const isPlanMode = (mode: StudyMode) => mode === "classic" || mode === "mixed";

/**
 * 等这一帧画出来再做重活（记账、预算下一张）。页面藏起来时 rAF 不触发，50 ms 兜底——
 * 不然切走的那一刻记账跟着停，页面被杀就丢一题。
 */
const afterPaint = () => new Promise<void>((resolve) => {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    resolve();
  };
  requestAnimationFrame(() => setTimeout(finish, 0));
  setTimeout(finish, 50);
});

const isDailyModeComplete = (mode: StudyMode, stats: WordStats) => {
  if (isPlanMode(mode)) return stats.dailyPlanDone;
  if (mode === "reverse") return stats.stage2Total > 0 && stats.stage2Completed >= stats.stage2Total;
  if (mode === "kanji") return stats.kanjiTotal > 0 && stats.kanjiCompleted >= stats.kanjiTotal;
  return false;
};

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

const pageVisible = () => document.visibilityState === "visible";

/**
 * 开场「减负」自动发牌的节奏。原来是 420ms 停留 + 240ms 飞出 = 每张 660ms，
 * 一次发十来张要拖到七八秒 —— 它是个「昨天这些你都记得」的确认动画，不是内容，
 * 磨蹭比不做还糟。整体减半到每张 330ms。
 *
 * ⚠️ 这两个数必须和 app.css 里的动画时长对着改：
 *   RELIEF_LEAVE_MS ↔ .daily-relief-card-leaving 的 dailyReliefDealOut
 *   飞入动画 dailyReliefDealIn 要短于 RELIEF_DWELL_MS，否则卡片还没落定就开始飞走。
 */
const RELIEF_DWELL_MS = 210;
const RELIEF_LEAVE_MS = 120;

const FOCUS_SOURCE = "word-study";

/** 倒计时胶囊自己每秒读一次剩余时间；背词页只在状态变化时重渲。 */
const StudyFocusChip = ({ nextReward }: { nextReward: number }) => {
  const [remaining, setRemaining] = useState(() => getStudyFocusSnapshot().remainingSeconds);
  useEffect(() => {
    const interval = window.setInterval(() => {
      const next = getStudyFocusSnapshot().remainingSeconds;
      setRemaining((previous) => previous === next ? previous : next);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <span className="study-focus-chip" aria-live="off">
      <Timer size={14} />
      {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
      {nextReward > 0 && <small> +{nextReward} 柚子</small>}
    </span>
  );
};

export const WordStudy = ({ initialMode = "classic", onDailyModeComplete, onStubbornQuickStudy, onOpenDistinctionQuiz }: WordStudyProps) => {
  const { showNotice } = useApp();
  /** 离开背词页：倒计时只是暂停，走的时候说一声（卸载和小程序切 Tab 都走这里，只会提示一次）。 */
  const leaveFocusRef = useRef(() => {});
  leaveFocusRef.current = () => {
    if (!leaveStudyFocus(FOCUS_SOURCE)) return;
    // 晚一拍再说：开发模式的 StrictMode 会卸载后立刻重挂，那时已经接回去了，不该提示。
    window.setTimeout(() => { if (getStudyFocusSnapshot().paused) showNotice("倒计时先暂停，回背词页接着走", 2600); }, 0);
  };
  const { pickFolder, picker } = useFavoriteFolderPicker();
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
  // 辨析是查资料型 Pro：先打开卡内对角线预览，只有主动点会员方案才弹购买小窗。
  const entitlements = useEntitlements();
  const [distinctionPaywall, setDistinctionPaywall] = useState(false);
  const openDistinction = () => setDistinctionOpen(true);
  /**
   * 混合模式此刻摆着的那张非单词卡（语法 / 汉字 / 辨析）。出哪一种、什么时候出由 lib/mixed-session 判，
   * 这里只管摆。它**盖在**单词卡上面：下一张单词卡照常排好摆在底下，答完这张清掉就接着背词。
   */
  const [other, setOther] = useState<MixedOtherItem | null>(null);
  const [otherRevealed, setOtherRevealed] = useState(false);
  const grammarCard = other?.kind === "grammar" ? other.card : null;
  const kanjiCard = other?.kind === "kanji" ? other.card : null;
  const matchCard = other?.kind === "confusion" ? other.card : null;
  const showOther = (item: MixedOtherItem | null) => {
    setOther(item);
    setOtherRevealed(false);
  };
  const [wordEncounter, setWordEncounter] = useState(0);
  const [spellingDecision, setSpellingDecision] = useState<{ key: string; spell: boolean } | null>(null);
  // 辨析索引建好没。没建好就先不算 —— 详见 warmConfusionGroups
  const [distinctionsReady, setDistinctionsReady] = useState(false);
  const [activePopover, setActivePopover] = useState<"note" | "noteMemory" | "prompt" | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  const [localStudySeconds, setLocalStudySeconds] = useState(0);
  const pendingStudySecondsRef = useRef(0);
  const queuedStudySecondsRef = useRef(0);
  // 主页勾了「倒计时」时，挂载那一刻就是一段刚开始的倒计时（真正的 startStudyFocus 在挂载 effect 里，
  // 那之前还没 enterStudyFocus）；初值直接写成它，免得 effect 里再 setState 重渲一次。
  const [focusSnapshot, setFocusSnapshot] = useState<StudyFocusSnapshot>(() => {
    const snapshot = getStudyFocusSnapshot();
    return isStudyFocusArmed() && snapshot.status === "off"
      ? { ...snapshot, status: "running", remainingSeconds: STUDY_FOCUS_WINDOW_MS / 1000 }
      : snapshot;
  });
  const focusBreakRef = useRef(false);
  /** 小程序里切走的页面仍挂着，document 却还是 visible；页面自己的显隐另记一份。 */
  const pageShownRef = useRef(true);
  /** 交互时并进零头、还没报给倒计时 / 后台观测的有效毫秒，下次结账一起报。 */
  const unreportedFocusMsRef = useRef(0);
  const updateFocusSnapshot = useCallback((next: StudyFocusSnapshot) => {
    setFocusSnapshot((previous) => sameStudyFocusState(previous, next) ? previous : next);
  }, []);
  const dailyPlanFinished = !loading && (phase === "stage1" || phase === "done") && isPlanMode(initialMode) && Boolean(stats?.dailyPlanDone)
    && !card && !grammarCard && !kanjiCard && !matchCard;
  useStudyBreakTabBar(focusSnapshot.status === "break" && !dailyPlanFinished);
  const [preferences, setPreferences] = useState<StudyPreferences>(() => getStudyPreferences());
  const [error, setError] = useState("");
  const [initialStudyClock] = useState(() => createStudyClock(Date.now()));
  const studyClockRef = useRef(initialStudyClock);
  const trackingActiveRef = useRef(false);
  const submittingRef = useRef(false);
  // 预算下一张（word-api 的 startAnswerPreviews 那一套）：看这张卡的那几秒里先把「答成认识 / 忘记之后出谁」算好，
  // 点下去直接换卡。记账挪到换卡之后（pendingAnswerRef），撤销、跳词、换模式、下一次评分之前先把它补上。
  const previewsRef = useRef<AnswerPreviews | null>(null);
  // 分段计时（perf-marks）：点评分 / 点翻面 → React 提交这一帧，各用了多久
  const answerTappedAtRef = useRef(0);
  const revealTappedAtRef = useRef(0);
  const previewRunRef = useRef(0);
  const pendingAnswerRef = useRef<(() => void) | null>(null);
  const flushPendingAnswer = useCallback(() => {
    const run = pendingAnswerRef.current;
    pendingAnswerRef.current = null;
    run?.();
  }, []);
  const completionReportedRef = useRef(false);
  const loadedModeRef = useRef<StudyMode | null>(null);
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
  const [buddySession] = useState(() => createStudyBuddy());
  const [reliefActive, setReliefActive] = useState(false);
  const [reliefLeaving, setReliefLeaving] = useState(false);
  const [dailyReviewRound, setDailyReviewRound] = useState<DailyReviewRound | null>(null);
  const dailyReviewRoundRef = useRef<DailyReviewRound | null>(null);
  const [dailyReviewInvite, setDailyReviewInvite] = useState<{ words: WordCard[]; avoidFirstId: number; studyDate: string } | null>(null);
  const dailyReviewInviteRef = useRef(false);
  const dailyReviewResumeRef = useRef<{ id: number; studyDate: string } | null>(null);
  const dailyReviewActive = dailyReviewRound !== null;
  const dailyReviewComplete = dailyReviewRound !== null && dailyReviewRoundDone(dailyReviewRound);
  const dailyReviewOverlay = dailyReviewInvite !== null || dailyReviewComplete;
  const dailyReviewBusy = dailyReviewActive || dailyReviewInvite !== null;
  const clearDailyReview = useCallback(() => {
    dailyReviewRoundRef.current = null;
    dailyReviewInviteRef.current = false;
    dailyReviewResumeRef.current = null;
    setDailyReviewRound(null);
    setDailyReviewInvite(null);
  }, []);
  const inviteDailyReview = useCallback((answeredId: number, next: WordCard | null, nextPhase: string) => {
    if (!isPlanMode(initialMode) || nextPhase !== "stage1" || dailyReviewRoundRef.current || dailyReviewInviteRef.current) return;
    if (!shouldInviteDailyReview()) return;
    const words = dailyReviewBatch();
    if (words.length < 5) return;
    dailyReviewResumeRef.current = next ? { id: next.id, studyDate: today() } : null;
    dailyReviewInviteRef.current = true;
    setDailyReviewInvite({ words, avoidFirstId: answeredId, studyDate: today() });
  }, [initialMode]);
  const [tailActive, setTailActive] = useState(false);
  // 刚答过的压轴卡（最多两张，和 UNDO_LIMIT 同步）：点「上一个」时要知道
  // 撤回去的是不是压轴卡，好把压轴队列一起退一格、并留在压轴模式里。
  const tailUndoIdsRef = useRef<number[]>([]);
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

  const loadNext = useCallback(async (mode: StudyMode = initialMode, resumeWordId?: number) => {
    flushPendingAnswer();
    setLoading(true);
    setError("");
    try {
      await yieldToPaint();
      let data: WordSessionResponse;
      if (isPlanMode(mode)) {
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
        data = continueTodayPlanStudy(resumeWordId);
      }
      if (isPlanMode(mode) && !data.card && data.stats.stage1Done) {
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
      // 混合模式：四种卡一条队列，单词手上没有了就由队列给下一张别的卡 —— 四种都空了才算今天完成。
      let otherTail = mode === "mixed" && Boolean(other);
      if (mode === "mixed" && !other) {
        if (!mixedCardDataLoaded()) await loadMixedCardData();
        const pick = pickMixedNext({ word: Boolean(data.card) });
        if (pick && pick !== "word") { showOther(pick); otherTail = true; }
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
      if (!data.card && !otherTail && !completionReportedRef.current && isDailyModeComplete(mode, data.stats)) {
        completionReportedRef.current = true;
        onDailyModeComplete?.(mode);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取本地词库");
    } finally {
      setLoading(false);
    }
  }, [flushPendingAnswer, initialMode, onDailyModeComplete, other, sessionOptions]);

  /**
   * 答完一个单词（已经记账之后）：记下作答顺序，混合模式再问队列这一下是不是轮到别的卡。
   * 返回有没有摆上一张别的卡 —— 单词那边要是同时取空了，调用方据此决定还要不要再问一次队列。
   *
   * 别的卡出的都是各自那页的同一副牌（语法考题页、汉字卡、辨析卡的同一份进度、同一个当日计划、
   * 同一套 FSRS），在哪边答的都算数。
   */
  const afterWordAnswered = useCallback((): boolean => {
    setWordEncounter((value) => value + 1);
    recordMixedWordAnswer();
    if (initialMode !== "mixed") return false;
    const pick = pickMixedNext({ word: true, afterWord: true });
    if (!pick || pick === "word") return false;
    showOther(pick);
    return true;
  }, [initialMode]);

  /**
   * 别的卡（语法 / 汉字 / 辨析）评分。声音、触觉、连对台阶沿用单词那一套；记账按卡种分派在 mixed-session。
   * 辨析卡由连错次数定档（ConfusionCardView 里），这里只收结果。
   */
  const answerOther = (value: WordAnswer) => {
    if (!other) return;
    buddySession.send({ type: "answer", correct: value === "know" || value === "known_forever" });
    triggerMemoryHaptic(value);
    if (value === "know" || value === "known_forever") { playKnow(correctStreakRef.current); correctStreakRef.current += 1; }
    else { correctStreakRef.current = 0; playDontKnow(); }
    answerMixedOther(other, value);
    showOther(null);
    // 单词那边已经空了：回去问队列 —— 要么下一张别的卡，要么进完成页。
    if (!card) void loadNext(initialMode);
  };
  const revealOther = () => { buddySession.send({ type: "reveal" }); setOtherRevealed(true); if (other?.kind === "confusion") playFlip(); };

  useEffect(() => {
    // loadNext 还会随偏好设置和父回调更新；这些变化不能把正在看的单词重新发一遍。
    // 真正需要重新开局的边界只有学习模式改变。
    if (loadedModeRef.current === initialMode) return;
    loadedModeRef.current = initialMode;
    // 切模式不换组件实例（key 只跟 wordStudyRevision 走），混合模式摆着的插播卡和作答顺序
    // 必须在这里清掉 —— 2026-10-09 真机：从混合切到经典，屏幕仍停在那张语法插播上。
    flushPendingAnswer();
    clearDailyReview();
    showOther(null);
    resetMixedSession();
    void loadNext(initialMode);
  }, [clearDailyReview, flushPendingAnswer, initialMode, loadNext]);

  const prefetchedAudioPlan = useRef("");
  useEffect(() => {
    if (loading) return;
    const key = `${initialMode}:${preferences.voiceId}:${preferences.jlptTarget}`;
    if (prefetchedAudioPlan.current === key) return;
    prefetchedAudioPlan.current = key;
    const plan = todayWordAudioPlan();
    if (card) plan.unshift({ kanji: card.kanji, kana: card.kana, example: card.example.jp });
    void prefetchWordPlanAudio(plan, tomorrowWordAudioPlan());
    if (initialMode === "mixed") void prefetchExamples(grammarAudioPlan(preferences.jlptTarget));
  }, [loading, initialMode, preferences.voiceId, preferences.jlptTarget, card]);

  useEffect(() => {
    if (!reliefActive || !card?.id || reliefLeaving || loading) return;
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
  }, [card?.id, initialMode, loadNext, loading, reliefActive, reliefLeaving, stats]);

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

  const sendStudySeconds = useCallback(async (seconds: number, atMs = Date.now()) => {
    const total = Math.max(0, Math.round(seconds)) + pendingStudySecondsRef.current;
    if (total <= 0) return null;
    setLocalStudySeconds(total);
    let data;
    try {
      data = addWordStudySeconds(total, atMs);
      pendingStudySecondsRef.current = 0;
      setStats(data.stats);
      setLocalStudySeconds(0);

      // 学习时长写在数据库里(addWordStudySeconds),那才是跨设备合并的那份账本。
      // 这里只顺手看一眼成就 —— 它读的也是同一份账本。
      //
      // 原来这里还往 userProfile 里攒一份分钟数:`Math.floor(seconds / 60)`,
      // 而 flush 是每 15 秒一次,这个式子恒等于 0,所以那份计数器一次都没涨过,
      // 个人信息页常年「累计 0 小时 0 分钟」。整段删掉,不再攒第二份。
      void checkAchievements().catch(() => undefined);
      try { settleYuzu(); } catch { /* 记账失败不该打断学习 */ }
      void reportTeamActivity();
      return data.stats;
    } catch {
      // Time tracking should never interrupt review.
      pendingStudySecondsRef.current = total;
      return null;
    }
  }, []);

  // 连线要逐项比较；单词、语法和辨析沿用原来的 60 秒无操作阈值。
  const studyIdleLimitMs = kanjiCard ? STUDY_IDLE_LIMIT_MS * 2 : STUDY_IDLE_LIMIT_MS;

  /** 结上一段的账，把攒够的整秒取出来落库(零头留着，见 study-clock.ts) */
  // save: "auto" 攒够 15 秒才落账（每秒的计时器用）；"force" 立刻落账；"never" 只结账不写库 ——
  // 作答路径用它：落账会顺带跑 settleYuzu / 成就，不该挤进点评分的那一下。
  const flushActiveStudyTime = useCallback(async (visibleOverride?: boolean, save: "auto" | "force" | "never" = "auto") => {
    if (!trackingActiveRef.current || focusBreakRef.current) return null;
    const now = Date.now();
    const previousPendingMs = studyClockRef.current.pendingMs;
    const accrued = accrueStudyTime(studyClockRef.current, now, { visible: visibleOverride ?? (pageShownRef.current && pageVisible()), idleLimitMs: studyIdleLimitMs });
    const activeMs = unreportedFocusMsRef.current + Math.max(0, accrued.pendingMs - previousPendingMs);
    unreportedFocusMsRef.current = 0;
    const { seconds, state } = drainStudySeconds(accrued);
    studyClockRef.current = state;
    queuedStudySecondsRef.current += seconds;
    if (activeMs > 0) {
      const next = recordStudyFocusTime(activeMs, now, FOCUS_SOURCE);
      updateFocusSnapshot(next);
      if (next.status === "break") {
        focusBreakRef.current = true;
        trackingActiveRef.current = false;
        studyClockRef.current = createStudyClock(now);
        unreportedFocusMsRef.current = 0;
        const saved = await sendStudySeconds(queuedStudySecondsRef.current, now);
        queuedStudySecondsRef.current = 0;
        return saved;
      }
    }
    if (save === "force" || (save === "auto" && queuedStudySecondsRef.current >= 15)) {
      const queued = queuedStudySecondsRef.current;
      queuedStudySecondsRef.current = 0;
      return sendStudySeconds(queued, now);
    }
    return null;
  }, [sendStudySeconds, studyIdleLimitMs, updateFocusSnapshot]);
  const flushActiveStudyTimeRef = useRef(flushActiveStudyTime);
  useEffect(() => { flushActiveStudyTimeRef.current = flushActiveStudyTime; }, [flushActiveStudyTime]);

  /**
   * 记一次交互。noteStudyInteraction 会先把上次结账以来的有效时间并进零头，
   * 那段必须照样报给倒计时和后台观测 —— 只看结账那一刻新增多少的话，
   * 越常点、越常滚（滚动每秒几十个事件），倒计时走得越慢，基线也跟着少记。
   */
  const noteActiveInteraction = useCallback((visible = pageShownRef.current && pageVisible()) => {
    if (!trackingActiveRef.current || focusBreakRef.current) return;
    const before = studyClockRef.current.pendingMs;
    studyClockRef.current = noteStudyInteraction(studyClockRef.current, Date.now(), { visible, idleLimitMs: studyIdleLimitMs });
    unreportedFocusMsRef.current += Math.max(0, studyClockRef.current.pendingMs - before);
  }, [studyIdleLimitMs]);

  useEffect(() => {
    trackingActiveRef.current = !dailyReviewOverlay && Boolean(card?.id || kanjiCard);
    if (focusSnapshot.status !== "break") focusBreakRef.current = false;
    // 换卡本身就是一次交互(刚点过评分)，顺手把上一段结掉。
    noteActiveInteraction();
  }, [card?.id, dailyReviewOverlay, kanjiCard, noteActiveInteraction, unitKey, focusSnapshot.status]);

  useEffect(() => {
    const entered = enterStudyFocus(FOCUS_SOURCE);
    // 主页勾了「倒计时」就进门即开；离开只是暂停，同一学习日回来接着走（startStudyFocus 已有就不重开）。
    const initial = isStudyFocusArmed() ? startStudyFocus() : entered;
    updateFocusSnapshot(initial);
    const interval = window.setInterval(() => { void flushActiveStudyTimeRef.current(); }, 1000);
    return () => {
      window.clearInterval(interval);
      void flushActiveStudyTimeRef.current(undefined, "force");
      leaveFocusRef.current();
    };
  }, [updateFocusSnapshot]);

  useStudyActivity({
    onInteraction: () => { noteActiveInteraction(); buddySession.send({ type: "interaction" }); },
    onVisibilityChange: (visible) => {
      if (!visible) {
        void flushActiveStudyTimeRef.current(true, "force");
        pageShownRef.current = false;
        return;
      }
      pageShownRef.current = true;
      // 小程序的 Tab 页切走时会 onLeave，但页面不卸载；切回来要重新接上观测，
      // 否则后台记录停掉、「倒计时学习」按钮也点不动（startStudyFocus 要求有 source）。
      const resumed = resumeStudyFocus(FOCUS_SOURCE);
      const current = isStudyFocusArmed() && resumed.status === "off" ? startStudyFocus() : resumed;
      updateFocusSnapshot(current);
      noteActiveInteraction(true);
    },
    onLeave: () => {
      void flushActiveStudyTimeRef.current(undefined, "force");
      leaveFocusRef.current();
    }
  });

  const answerFocusedWord = useCallback((wordId: number, answer: WordAnswer) => {
    updateFocusSnapshot(recordStudyFocusAnswer(wordId, answer));
  }, [updateFocusSnapshot]);

  const claimFocusReward = () => {
    const earned = claimStudyFocusReward();
    updateFocusSnapshot(getStudyFocusSnapshot());
    if (earned > 0) {
      try { settleYuzu(); } catch { /* 奖励已经入账，刷新余额失败不能拦领取 */ }
    }
  };

  const continueFocusCountdown = () => {
    if (!continueStudyFocus()) return;
    focusBreakRef.current = false;
    studyClockRef.current = createStudyClock(Date.now());
    unreportedFocusMsRef.current = 0;
    const next = getStudyFocusSnapshot();
    setFocusSnapshot(next);
    if (card?.id || kanjiCard) trackingActiveRef.current = true;
  };

  const stopFocusCountdown = () => {
    // 「之后不要倒计时」= 把主页那个勾也取消，不然下次进来又自动开了。
    setStudyFocusArmed(false);
    focusBreakRef.current = false;
    const next = stopStudyFocus();
    setFocusSnapshot(next);
    studyClockRef.current = createStudyClock(Date.now());
    if (card?.id || kanjiCard) trackingActiveRef.current = true;
  };

  const claimDailyCompletionRewards = () => {
    const earned = claimStudyFocusReward() + claimDailyPlanYuzu();
    updateFocusSnapshot(getStudyFocusSnapshot());
    return earned;
  };

  useEffect(() => {
    setNoteText(card?.note ?? "");
    setNoteEditorOpen(false);
    setNoteMemoryOpen(false);
    setPromptEditorOpen(false);
    setDistinctionOpen(false);
    setActivePopover(null);
    // 这段只响应「换卡」。同一张卡保存备注时若把 card.note 加进依赖，会立刻关掉
    // 用户正在编辑的面板；submitAnswer/loadNext 已在真正换卡时显式同步下一张备注。
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 摆出下一张单词卡（快路径和同步路径共用）。统计和「能不能撤销」由调用方各自在记账之后设。 */
  const showWordCard = useCallback((next: WordCard | null, nextPhase: string, nextUnitKey: string | null = null, nextUnitTarget: WordSessionResponse["unitTarget"] = null) => {
    setCard(next);
    setUnitKey(nextUnitKey);
    setUnitTarget(nextUnitTarget);
    setPhase(nextPhase);
    setReliefActive(false);
    setReliefLeaving(false);
    setTailActive(false);
    setRevealed(false);
    // 同一个顽固词可能被立即再次排到。它的 id 没变，下面依赖 card.id 的
    // effect 不会执行，所以必须在「一次作答已结束」这个轮次边界主动收起
    // 上次翻面弹出的备注；下一次翻面时仍会照常重新弹出。
    setNoteText(next?.note ?? "");
    setNoteEditorOpen(false);
    setNoteMemoryOpen(false);
    setDistinctionOpen(false);
    setActivePopover(null);
  }, []);

  // 原卡仍是今天未完成任务才恢复；否则让 loadNext 重取正常卡，再接压轴、混合队列和完成上报。
  // 两个出口都走这里，复查没有 submit 返回值，也不能把本轮最后一张当成正常下一张。
  const exitDailyReview = () => {
    const saved = dailyReviewResumeRef.current;
    clearDailyReview();
    setCanUndo(false);
    void loadNext(initialMode, saved?.studyDate === today() ? saved.id : undefined);
  };
  const startDailyReview = () => {
    if (!dailyReviewInvite || dailyReviewRoundRef.current) return;
    if (dailyReviewInvite.studyDate !== today()) { exitDailyReview(); return; }
    try {
      const round = createDailyReviewRound(dailyReviewInvite.words.map((word) => word.id), dailyReviewInvite.avoidFirstId);
      const nextId = nextDailyReviewId(round);
      const next = nextId === null ? null : getDailyReviewCard(nextId);
      if (!next) throw new Error("无法读取本轮单词");
      startDailyReviewRound();
      dailyReviewRoundRef.current = round;
      dailyReviewInviteRef.current = false;
      setDailyReviewRound(round);
      setDailyReviewInvite(null);
      setTailActive(false);
      setCanUndo(false);
      showWordCard(next, "daily-mistakes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法开始集中回顾");
      clearDailyReview();
    }
  };
  const declineDailyReview = () => {
    try {
      declineDailyReviewInvite();
      clearDailyReview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "暂缓失败");
      clearDailyReview();
    }
  };

  const submitAnswer = useCallback(async (answer: WordAnswer, source: "pointer" | "key" | "swipe" | "spelling" = "pointer") => {
    // submittingRef is synchronous, so a second tap is blocked immediately —
    // before React can re-render the `disabled`/`submitting` state — which is
    // what the `submitting` state alone could miss on a fast double-tap.
    if (!card || submittingRef.current || submitting || reliefActive || dailyReviewOverlay || focusBreakRef.current) {
      if (source === "spelling") throw new Error("暂时无法作答");
      return;
    }
    // 刚翻面的那几十毫秒不收**手指**评分 —— 见 REVEAL_INPUT_LOCK_MS。
    // 键盘不受这道闸:那条路上「显示答案」和评分是不同的键,不存在同一个位置连击的问题,
    // 拦一下只会吃掉快手用户的合法输入。甩卡也不受:它自己要先飞 240ms,早就过去了。
    if (source === "pointer" && performance.now() - revealedAtRef.current < REVEAL_INPUT_LOCK_MS) return;
    // 锁要在异步计时之前拿住，避免两次点击同时穿过判据。
    submittingRef.current = true;
    await flushActiveStudyTime(undefined, "never");
    if (focusBreakRef.current) {
      submittingRef.current = false;
      if (source === "spelling") throw new Error("学习已暂停");
      return;
    }
    answerTappedAtRef.current = performance.now();
    // 上一题走了快路径、记账还没轮到的话，先补上：这一题的作答要排在它后面。
    flushPendingAnswer();
    if (dailyReviewInviteRef.current) { submittingRef.current = false; return; }
    const answeredCardId = card.id;
    const answeredUnitKey = unitKey;
    const wasDailyReview = dailyReviewActive;
    const wasTail = tailActive;
    const beforeStats = stats;
    triggerMemoryHaptic(answer);
    // 认识 → 上行两音;不认识 → 柔和下行两音。同时播按钮反馈动画。
    //
    // 这里**不要**再为了「让按一下有分量」压一帧 200ms 的 stall:动画是 CSS 的,
    // 本来就能和下一张卡的计算并行播完,而那 200ms 是每次评分都实打实的一顿。
    const good = answer === "know" || answer === "known_forever";
    buddySession.send({ type: "answer", correct: good });
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
    // 快路径：这一下的下一张已经算好了（见 word-api「预算下一张」）→ 先换卡，记账等这一帧画出来再做。
    // 插播语法的这一下、压轴 / 错题回顾 / 汉字单元，以及没算好、算完之后库又变了的，都走下面的同步路径。
    const grammarTurnDue = initialMode === "mixed" && mixedTurnDue();
    const preview = !answeredUnitKey && !wasDailyReview && !wasTail && !grammarTurnDue
      ? takeAnswerPreview(previewsRef.current, answeredCardId, answer)
      : null;
    if (preview?.card) {
      const answeredPhase = phase;
      previewsRef.current = null;
      afterWordAnswered();
      setError("");
      showWordCard(preview.card, preview.phase);
      pendingAnswerRef.current = () => {
        try {
          const data = submitWordAnswerWithPreview(answeredCardId, answer, preview, sessionOptions, source === "spelling");
          answerFocusedWord(answeredCardId, answer);
          setStats(data.stats);
          setCanUndo(Boolean(data.canUndo));
          playCountdownFeedbackIfNeeded(beforeStats, data.stats);
          if (isPlanMode(initialMode) && answeredPhase === "stage1") {
            inviteDailyReview(answeredCardId, preview.card, preview.phase);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "提交失败");
        }
      };
      void afterPaint().then(flushPendingAnswer);
      submittingRef.current = false;
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const round = dailyReviewRoundRef.current;
      if (wasDailyReview && round) {
        if (roundWritesFsrs(round, answeredCardId)) {
          const data = submitWordAnswer(answeredCardId, answer, sessionOptions, false, true);
          answerFocusedWord(answeredCardId, answer);
          setStats(data.stats);
        }
        const nextRound = answerDailyReviewRound(round, answeredCardId, good);
        dailyReviewRoundRef.current = nextRound;
        setDailyReviewRound(nextRound);
        setCanUndo(false);
        setRevealed(false);
        if (dailyReviewRoundDone(nextRound)) {
          playComplete();
          return;
        }
        const nextId = nextDailyReviewId(nextRound);
        const next = nextId === null ? null : getDailyReviewCard(nextId);
        if (!next) throw new Error("无法读取本轮单词，请先到这再继续学习");
        showWordCard(next, "daily-mistakes");
        return;
      }
      const data = answeredUnitKey && phase === "kanji"
        ? submitKanjiUnitAnswer(answeredUnitKey, answer)
        : submitWordAnswer(answeredCardId, answer, sessionOptions, source === "spelling");
      answerFocusedWord(answeredCardId, answer);
      // 这一下算数了才谈得上轮到别的卡；下面各条分支照常把下一张单词卡排好摆在别的卡底下。
      const otherShown = afterWordAnswered();
      /**
       * 混合模式单词取空了不等于今天完成：剩下的语法 / 汉字 / 辨析由队列接着出，四种都空了它才报完成。
       * 这一下已经轮到一张别的卡就先摆着它（答完 answerOther 会再问队列），否则交给 loadNext 去问。
       * 2026-10-10 作者报：答完最后一个单词直接进了完成页，顶上停在 612/645、33 条语法被晾着 ——
       * 当时普通作答、压轴、错题回顾三条出口都没问这一句。三条出口都走这里。
       */
      const handOffMixed = (latestStats: WordStats) => {
        setCard(null);
        setUnitKey(null);
        setUnitTarget(null);
        setTailActive(false);
        setRevealed(false);
        setStats(latestStats);
        if (!otherShown) void loadNext(initialMode);
      };
      let nextStats = data.stats;
      if (!data.card && trackingActiveRef.current) {
        const trackedStats = await flushActiveStudyTime(undefined, "force");
        trackingActiveRef.current = false;
        if (trackedStats) nextStats = trackedStats;
      }

      playCountdownFeedbackIfNeeded(beforeStats, nextStats);

      // 压轴卡不计入今日任务，但答题依然写入原有 FSRS。只有压轴全部答完，
      // 才允许进入真正的完成页和自动错题本切换。
      if (!wasTail) tailUndoIdsRef.current = [];
      if (wasTail) {
        // 忘记/模糊的压轴卡挪到队尾再来一次:答错的那一下已经写进 FSRS 了,
        // 界面上却让这个词当场消失、直接进完成页,等于说好再确认一次却没确认。
        advanceDailyTail({ requeue: !good });
        tailUndoIdsRef.current = [...tailUndoIdsRef.current, answeredCardId].slice(-UNDO_LIMIT);
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
          setCanUndo(Boolean(data.canUndo));
          setRevealed(false);
          return;
        }
        if (initialMode === "mixed") {
          handOffMixed(refreshedStats);
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

      if (isPlanMode(initialMode) && phase === "stage1") {
        inviteDailyReview(answeredCardId, data.card, data.phase);
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

      if (initialMode === "mixed" && !data.card) {
        handOffMixed(nextStats);
        return;
      }
      showWordCard(data.card, data.phase, data.unitKey ?? null, data.unitTarget ?? null);
      setStats(nextStats);
      setCanUndo(Boolean(data.canUndo));
      if (!data.card) playComplete();
      if (!data.card && !completionReportedRef.current && isDailyModeComplete(initialMode, nextStats)) {
        completionReportedRef.current = true;
        onDailyModeComplete?.(initialMode);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
      if (source === "spelling") throw err;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      // 这里**不要**清印章。改版前是 setRateFeedback(null),而它和上面那次 set
      // 落在同一个同步 tick 里(submitWordAnswer 是同步 SQLite,常见路径没有 await),
      // React 一批处理,中间态从来没渲染过。印章的收尾交给 RATE_BURST_MS 那个计时器。
    }
  }, [buddySession, answerFocusedWord, card, dailyReviewActive, dailyReviewOverlay, afterWordAnswered, flushActiveStudyTime, flushPendingAnswer, initialMode, inviteDailyReview, loadNext, onDailyModeComplete, phase, reliefActive, sessionOptions, showWordCard, stats, submitting, tailActive, unitKey]);

  useEffect(() => () => window.clearTimeout(rateBurstTimerRef.current), []);

  // 预算下一张：卡（或统计）一换就排。「认识」「忘记」各占一个定时器片段，中间让出主线程，不挡翻面那一下点击。
  // 模糊借忘记那份、熟知借认识那份（takeAnswerPreview 里判能不能借）。
  // stats 在依赖里是当触发器用的：快路径换卡之后记账那一步会 setStats，学习时长每分钟结账也会——
  // 那两次写入都会让已有的预算作废，得带着写入之后的状态重算。
  useLayoutEffect(() => {
    if (!answerTappedAtRef.current) return;
    perfRecord("点评分→换卡", performance.now() - answerTappedAtRef.current);
    answerTappedAtRef.current = 0;
  }, [card]);
  useLayoutEffect(() => {
    if (!revealed || !revealTappedAtRef.current) return;
    perfRecord("点翻面→答案", performance.now() - revealTappedAtRef.current);
    revealTappedAtRef.current = 0;
  }, [revealed]);

  const previewEligible = Boolean(card) && !loading && !submitting && !unitKey && !reliefActive && !dailyReviewActive
    && !dailyReviewOverlay && !tailActive && !grammarCard && !kanjiCard && !matchCard;
  const spellingCandidate = Boolean(card) && preferences.spellingEnabled && phase === "stage1"
    && !unitKey && !reliefActive && !dailyReviewActive && !dailyReviewOverlay && !tailActive
    && !grammarCard && !kanjiCard && !matchCard;
  const spellingKey = `${card?.id}:${phase}:${wordEncounter}`;
  // 在预算出来之前不露普通作答界面；一旦出卡就固定题型，后台重算不会打断已输入的答案。
  const preparingSpelling = spellingCandidate && spellingDecision?.key !== spellingKey;
  const spellingActive = spellingCandidate && spellingDecision?.key === spellingKey && spellingDecision.spell;
  const spellingView = useMemo(() => {
    if (!spellingActive || !card) return null;
    const next = spellingCard(card.id, "meaning");
    return next && { ...next, jlptLevel: preferences.showJlptLevel ? next.jlptLevel : "" };
  }, [spellingActive, card, preferences.showJlptLevel]);
  const spellingInputLookup = useMemo(() => spellingView ? spellingLookup(spellingView.wordId) : null, [spellingView]);
  const runPreviews = useCallback((cardId: number) => {
    const run = ++previewRunRef.current;
    void (async () => {
      // 预算一旦抛错，spellingDecision 就永远不写入，开了拼写的页面会一直停在「正在取下一张…」（2026-10-13 交工前对照 R3）；
      // 出错就让这张卡按普通作答，别卡死。
      try {
        await afterPaint();
        if (run !== previewRunRef.current || pendingAnswerRef.current) return;
        const previews = startAnswerPreviews(cardId);
        previewsRef.current = previews;
        for (const answer of ["know", "forgot"] as const) {
          if (answer !== "know") await new Promise((resolve) => setTimeout(resolve, 0));
          if (run !== previewRunRef.current) return;
          addAnswerPreview(previews, answer, sessionOptions);
          if (answer === "know" && spellingCandidate) {
            const spell = shouldSpellWord(cardId, previews.byAnswer.know?.graduatedForDay === true, true, phase);
            setSpellingDecision((current) => current?.key === spellingKey ? current : { key: spellingKey, spell });
          }
          const nextCard = previews.byAnswer[answer]?.card;
          if (nextCard) void prefetchPronunciation(nextCard.kanji, nextCard.kana, preferences.voiceId);
        }
      } catch (error) {
        console.warn("[spelling] 答前预算失败，这张卡按普通作答：", error);
        if (spellingCandidate) setSpellingDecision((current) => current?.key === spellingKey ? current : { key: spellingKey, spell: false });
      }
    })();
  }, [phase, preferences.voiceId, sessionOptions, spellingCandidate, spellingKey]);
  useEffect(() => {
    previewsRef.current = null;
    // 快路径刚换卡、记账还没落库：先不算，记账之后 setStats 会让这里带着新状态再跑一遍
    if (pendingAnswerRef.current || !previewEligible || !card) return;
    runPreviews(card.id);
    return () => { previewRunRef.current += 1; };
  }, [card, stats, previewEligible, runPreviews]);

  const revealAnswer = useCallback(() => {
    if (!card || loading || revealed || submitting || reliefActive || dailyReviewOverlay) return;
    revealedAtRef.current = performance.now();
    revealTappedAtRef.current = revealedAtRef.current;
    buddySession.send({ type: "reveal" });
    setRevealed(true);
    // 看题那几秒里可能整库落过一次盘（sql.js 重开连接）或结过一次学习时长，预算作废了：
    // 趁用户看答案重算，点评分时就又是现成的。
    if (previewEligible && !pendingAnswerRef.current && !answerPreviewsFresh(previewsRef.current, card.id)) runPreviews(card.id);
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
  }, [buddySession, card, dailyReviewOverlay, loading, previewEligible, reliefActive, revealed, runPreviews, speakCard, submitting]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Keep browser/app shortcuts and text editing untouched.
      if (
        event.defaultPrevented
        || focusBreakRef.current
        || event.repeat
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || distinctionOpen
        || dailyReviewOverlay
        // 语法卡盖在上面时键位归它（GrammarCard 自己挂了一套一模一样的）；汉字卡、辨析卡同理
        || (!dailyReviewBusy && (grammarCard || kanjiCard || matchCard))
        || spellingActive || preparingSpelling
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
  }, [card, dailyReviewBusy, dailyReviewOverlay, distinctionOpen, grammarCard, kanjiCard, matchCard, spellingActive, preparingSpelling, loading, revealed, submitting, submitAnswer, revealAnswer, unitKey, phase]);

  const undo = async () => {
    if (dailyReviewRoundRef.current) return;
    flushPendingAnswer();
    clearDailyReview();
    // 混合模式：四种卡各有一份互不知道对方的撤销栈，按作答顺序的栈顶分派（lib/mixed-session）。
    // 栈顶是别的卡：撤掉它并重新摆出来；是单词才走下面单词那份。
    if (mixedUndoKind() && mixedUndoKind() !== "word") {
      correctStreakRef.current = 0;
      buddySession.send({ type: "undo" });
      showOther(undoMixedOther());
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const data = undoLastWordAnswer(sessionOptions);
      if (data.card) updateFocusSnapshot(undoStudyFocusAnswer(data.card.id));
      // ⚠️ 别的卡是「刚才那个单词」带出来的（先记作答顺序再问队列），所以它摆在屏幕上时，
      // 栈顶那一笔一定是单词。不把它收回去的话，撤销撤的是它**底下**那张单词卡，屏幕纹丝不动 ——
      // 看着就是「上一个不能用」。计数和轮次一起退回：那次作答不算数了，它也不该提前用掉。
      undoMixedWord({ otherShowing: Boolean(other) });
      if (other) showOther(null);
      // 撤销了刚才那次作答,音高台阶也该跟着退回起点(不做精确回退:撤销很少用,
      // 而多爬一级和少爬一级都比「撤销了但还在高音上」说不通)
      correctStreakRef.current = 0;
      buddySession.send({ type: "undo" });
      // 撤回的是压轴卡的话,压轴队列也要退一格(否则下一张会跳过一个词),
      // 而且要留在压轴模式里 —— 否则撤销一下就掉出压轴、直接看到完成页。
      const undoneTailId = tailUndoIdsRef.current[tailUndoIdsRef.current.length - 1];
      const undidTail = undoneTailId != null && data.card?.id === undoneTailId;
      if (undidTail) {
        rewindDailyTail(undoneTailId);
        tailUndoIdsRef.current = tailUndoIdsRef.current.slice(0, -1);
      }
      setWordEncounter((value) => value + 1);
      setCard(data.card);
      setUnitKey(data.unitKey ?? null);
      setUnitTarget(data.unitTarget ?? null);
      setStats(data.stats);
      setPhase(undidTail ? "daily-tail" : data.phase);
      setReliefActive(false);
      setReliefLeaving(false);
      clearDailyReview();
      setTailActive(undidTail);
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
      if (card.isFavorite) {
        toggleFavorite("word", card.id);
        setCard({ ...card, isFavorite: false });
        return;
      }
      pickFolder({
        title: `收藏「${card.questionMeaning || card.meaning}」到`,
        onPick: (folder) => {
          addFavorite("word", card.id, folder);
          setCard((current) => (current && current.id === card.id ? { ...current, isFavorite: true } : current));
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "收藏失败");
    }
  };

  const jumpToSimilar = (targetWordId: number) => {
    if (!card || submittingRef.current || submitting) return;
    flushPendingAnswer();
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
      clearDailyReview();
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
      clearDailyReview();
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
      clearDailyReview();
      setTailActive(false);
      setCanUndo(Boolean(data.canUndo));
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法继续学习");
    } finally {
      setLoading(false);
    }
  };

  const showStudyToolbar = !dailyReviewOverlay && (loading || Boolean(card));
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
  const swipeEnabled = Boolean(card) && !spellingActive && !preparingSpelling && revealed && !submitting && !reliefActive && !dailyReviewOverlay;

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
  const buddyVisible = !STUDY_BUDDY_SHELVED && preferences.studyBuddy && !loading && !dailyPlanFinished
    && focusSnapshot.status !== "break" && Boolean(card || other);
  const buddyRemaining = !stats ? 0 : initialMode === "reverse"
    ? Math.max(0, stats.stage2Total - stats.stage2Completed)
    : initialMode === "kanji" ? Math.max(0, stats.kanjiTotal - stats.kanjiCompleted)
    : initialMode === "mistakes" || initialMode === "picked" ? 0
    : Math.max(0, stats.stage1ProgressTotal - stats.stage1ProgressDone
      + (initialMode === "mixed" ? stats.grammarRemaining + stats.kanjiCardRemaining + stats.confusionCardRemaining : 0));
  useEffect(() => {
    if (!buddyVisible) return;
    buddySession.send({ type: "start" });
    buddySession.send({ type: "remaining", n: buddyRemaining });
  }, [buddyVisible, buddyRemaining, buddySession]);
  useEffect(() => {
    if (buddyVisible) buddySession.send({ type: "focus", snapshot: focusSnapshot });
  }, [buddyVisible, buddySession, focusSnapshot]);
  const buddy = buddyVisible ? <StudyBuddy session={buddySession} /> : null;
  useEffect(() => {
    if (dailyPlanFinished && focusSnapshot.status === "running") {
      // 持久化结束时的有效专注段后，立刻同步完成页要展示的结算快照。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      updateFocusSnapshot(finishStudyFocusAtDailyCompletion());
    }
  }, [dailyPlanFinished, focusSnapshot.status, updateFocusSnapshot]);
  // 「上一个」撤哪一边、亮不亮：按作答顺序的栈顶走（判据和那道「只撤这次进页面之后答的」闸都在 canUndoMixed）。
  const undoKind = mixedUndoKind() ?? "word";
  const undoEnabled = !dailyReviewBusy && canUndoMixed(initialMode === "mixed", canUndo);

  const countdownActive = !loading
    && !dailyReviewBusy
    && countdownRemaining > 0
    && countdownRemaining <= 30
    && isPlanMode(initialMode);

  // 混合学习的汉字 / 辨析插播，和语法卡同一个位置、同一颗撤销按钮，只有颜色和内容不同。
  if (focusSnapshot.status === "break" && !dailyPlanFinished) {
    const summary = focusSnapshot.summary;
    const baseline = summary?.baselineRemembered;
    const remembered = summary?.remembered ?? 0;
    const reward = focusSnapshot.nextReward;
    return createPortal(
      <ScrollArea className="study-focus-veil">
        <section className="study-focus-dialog" role="dialog" aria-modal="true" aria-labelledby="study-focus-title">
          <span className="study-focus-kicker"><Timer size={16} /> 十分钟专注</span>
          <h2 id="study-focus-title">休息一下</h2>
              <p className="study-focus-lead">这 10 分钟背了 <b>{summary?.words ?? 0}</b> 个词，记住 <b>{remembered}</b> 个，模糊 <b>{summary?.fuzzy ?? 0}</b> 个，没记住 <b>{summary?.forgotten ?? 0}</b> 个。</p>
              {summary && !summary.qualified ? (
                <p className="study-focus-comparison">
                  这段不到 {STUDY_FOCUS_MIN_WORDS} 个词，不算进对比，也不发柚子。下一段多背几个吧！
                </p>
              ) : summary?.baselineWindows ? (
                <p className="study-focus-comparison">
                  最近 {STUDY_FOCUS_BASELINE_DAYS} 天里平均每十分钟记住 {baseline?.toFixed(1)} 个词；
                  {summary.rememberedDelta! > 0
                    ? `这次多记 ${summary.rememberedDelta!.toFixed(1)} 个${summary.efficiencyChangePercent === null ? "。之前平均是 0，无法计算百分比。" : `，效率提升 ${summary.efficiencyChangePercent.toFixed(0)}%。`}`
                    : summary.rememberedDelta === 0
                      ? "这次和之前持平，继续加油！"
                      : `这次少记 ${Math.abs(summary.rememberedDelta ?? 0).toFixed(1)} 个，继续加油！`}
                </p>
              ) : <p className="study-focus-comparison">这是第一次完整记录，下一次就能和这次比较。</p>}
              <p className="study-focus-method">记忆情况按每个词本轮最后一次自评统计，不代表长期保持率。</p>
              {summary?.qualified && reward > 0 && (
                <StudyFocusChest
                  amount={reward}
                  claimed={focusSnapshot.rewardClaimed}
                  onClaim={claimFocusReward}
                  caption={focusSnapshot.rewardClaimed ? `已领取 ${reward} 柚子` : `点击宝箱领取 ${reward} 柚子`}
                />
              )}
              {summary?.qualified && reward === 0 && <p className="study-focus-comparison">今天的九档柚子奖励已领完。</p>}
              {summary?.qualified && reward > 0 && !focusSnapshot.rewardClaimed && (
                <p className="study-focus-chest-hint">先领取本段奖励，再选择之后的学习方式。</p>
              )}
              <div className="study-focus-actions">
                <button className="study-focus-secondary" onClick={stopFocusCountdown} disabled={summary?.qualified && reward > 0 && !focusSnapshot.rewardClaimed}>之后不要倒计时</button>
                <button className="study-focus-primary" onClick={continueFocusCountdown} disabled={summary?.qualified && reward > 0 && !focusSnapshot.rewardClaimed}>
                  继续倒计时
                </button>
              </div>
              <span className="study-focus-next">继续后开始下一段 10:00</span>
        </section>
      </ScrollArea>,
      document.body
    );
  }

  if (!dailyReviewBusy && (kanjiCard || matchCard)) {
    const accent = kanjiCard ? KANJI_ACCENT : MATCH_ACCENT;
    return (
      <div style={accent} className={`word-study-shell mx-auto flex max-w-4xl flex-col justify-center lg:max-w-[1200px] ${kanjiCard ? "kanji-match-shell" : ""}`}>
        <div className="mb-2 flex items-center gap-2 lg:mx-auto lg:w-[min(900px,100%)]">
          <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold !text-[#2f3333]" style={{ background: "var(--quiz-accent)" }}>
            <Shuffle size={13} />
            {kanjiCard ? "单独汉字" : "疑难辨析"}
          </span>
          <span className="text-xs text-white/45">{kanjiCard ? "考的是读音，不考写法" : "回想区别后翻面自评"}</span>
          <button
            onClick={undo}
            disabled={!undoEnabled}
            className="focus-ring ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 disabled:opacity-40"
            title={undoEnabled ? "上一个" : "没有可撤销的作答"}
            aria-label="上一个"
          >
            <RotateCcw size={15} />
          </button>
        </div>
        <div className="sbuddy-host">
        {kanjiCard ? (
          <KanjiCharCardView card={kanjiCard} revealed={otherRevealed} onReveal={revealOther} onAnswer={answerOther} />
        ) : (
          <ConfusionCardView card={matchCard!} revealed={otherRevealed} onReveal={revealOther} onAnswer={answerOther} />
        )}
        {buddy}
        </div>
      </div>
    );
  }

  // 混合模式的语法插播。整页换色是这里唯一要说的话：正在答的不是单词。
  // 卡片、键位、评分都和语法考题页共用一份（GrammarCard），只有配色不同。
  if (!dailyReviewBusy && grammarCard) {
    return (
      <div
        style={QUIZ_ACCENT_AMBER}
        className="word-study-shell mx-auto flex max-w-4xl flex-col justify-center lg:max-w-[1200px]"
      >
        <div className="mb-2 flex items-center gap-2 lg:mx-auto lg:w-[min(900px,100%)]">
          <span
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold !text-[#2f3333]"
            style={{ background: "var(--quiz-accent)" }}
          >
            <Shuffle size={13} />
            语法 · {grammarCard.level}
          </span>
          <span className="text-xs text-white/45">和语法考题是同一份进度</span>
          {/* 语法卡把整页顶掉了，工具栏跟着不在 —— 撤销得在这儿自带一颗，
              否则手滑点错一条语法当场就没救。 */}
          <button
            onClick={undo}
            disabled={!undoEnabled}
            className="focus-ring ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 disabled:opacity-40"
            title={undoEnabled ? "上一个" : "没有可撤销的作答"}
            aria-label="上一个"
          >
            <RotateCcw size={15} />
          </button>
        </div>
        <div className="sbuddy-host">
        <GrammarCard
          card={grammarCard}
          revealed={otherRevealed}
          onReveal={revealOther}
          onAnswer={answerOther}
          accent={QUIZ_ACCENT_AMBER}
        />
        {buddy}
        </div>
      </div>
    );
  }

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
      <StreakSpark />
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
        {/* 甩卡印章:右=收下了,左=再来一遍(不惩罚) */}
        {swipeEnabled && swipeX > AXIS_LOCK_PX && (
          <span className="zoo-stamp good" style={{ opacity: swipeProgress }}>
            ● 认识
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
            <h1 className="text-lg font-semibold leading-tight">{pageTitle}</h1>
          </div>
          {/* 手机端只在非默认模式下标一下:经典模式是常态,标了是噪音;
              反向/汉字/词汇不标的话用户会不知道自己在哪个模式里。 */}
          {shortMode !== "经典" && (
            <span className="shrink-0 rounded-lg bg-[#81D8CF]/20 px-2 py-1 text-xs font-bold lg:hidden">
              {shortMode}
            </span>
          )}
          {focusSnapshot.status === "running" && <StudyFocusChip nextReward={focusSnapshot.nextReward} />}
          <button
            onClick={toggleCardFavorite}
            disabled={!card}
            className={`focus-ring ds-icon-btn inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 hover:bg-[#81D8CF]/15 disabled:opacity-50 lg:ml-auto ${card?.isFavorite ? "bg-[#81D8CF] !text-[#2f3333]" : "bg-[#81D8CF]/10"}`}
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
            className={`focus-ring ds-icon-btn inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 hover:bg-[#81D8CF]/15 disabled:opacity-50 ${card?.note ? "bg-[#81D8CF]/20" : "bg-[#81D8CF]/10"}`}
            title={card?.note ? "编辑便签" : "添加便签"}
          >
            <StickyNote size={17} />
          </button>
          <button
            onClick={undo}
            disabled={submitting || !undoEnabled}
            className="focus-ring ds-icon-btn inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15 disabled:opacity-50"
            title={undoEnabled ? (undoKind === "grammar" ? "上一个（刚答的那条语法）" : "上一个") : "没有可撤销的作答"}
          >
            <RotateCcw size={17} />
          </button>
          {distinctions.length > 0 && (
            <button
              onClick={openDistinction}
              className={`focus-ring ds-icon-btn inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 hover:bg-[#81D8CF]/15 ${distinctionOpen ? "bg-[#81D8CF] !text-[#2f3333]" : "bg-[#81D8CF]/10"}`}
              title="查看辨析"
              aria-label="查看辨析"
              aria-expanded={distinctionOpen}
            >
              <GitCompareArrows size={17} />
            </button>
          )}
        </div>}

        {noteMemoryOpen && card?.note && (
          <ScrollArea
            className="word-note-popover note-memory-card word-note-float rounded-2xl border p-4 text-left shadow-2xl backdrop-blur-md"
            style={{ zIndex: activePopover === "noteMemory" ? 50 : 35 }}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-white/60">我的便签</p>
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
          </ScrollArea>
        )}

        {noteEditorOpen && card && (
          <ScrollArea
            className="word-note-popover word-note-float rounded-2xl border p-4 text-left shadow-lg"
            style={{ zIndex: activePopover === "note" ? 50 : 35 }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-white/55">写便签</p>
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
          </ScrollArea>
        )}

        {promptEditorOpen && card && (
          <ScrollArea
            className="word-note-popover word-note-float prompt-edit-card rounded-2xl border p-4 text-left shadow-lg"
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
          </ScrollArea>
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
            locked={!canUseFeature("confusionGroups", entitlements)}
            onUpgrade={() => setDistinctionPaywall(true)}
          />
        )}
        {distinctionPaywall && (
          <Paywall
            feature="confusionGroups"
            onClose={() => setDistinctionPaywall(false)}
            onUnlocked={() => setDistinctionPaywall(false)}
          />
        )}

        {reliefActive && stats?.dailyRelief && (
          <div className="daily-relief-banner" role="status" aria-live="polite">
            <Sparkles size={20} className="daily-relief-banner-spark" aria-hidden="true" />
            <strong>昨日表现很棒，今日减负（{stats.dailyRelief.total}）个！</strong>
          </div>
        )}
        {dailyReviewRound && !dailyReviewComplete && <DailyReviewTopBar round={dailyReviewRound} onExit={exitDailyReview} />}
        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#81D8CF]/40 bg-[#81D8CF]/20 p-4 text-sm text-white">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
              <p className="font-bold">暂时读不到本地词库</p>
              <p className="mt-1 text-white/75">请检查应用内是否包含 nihongo.db。</p>
            </div>
          </div>
        )}

        {dailyReviewInvite ? (
          <DailyReviewInvite words={dailyReviewInvite.words} onStart={startDailyReview} onDecline={declineDailyReview} />
        ) : dailyReviewComplete && dailyReviewRound ? (
          <DailyReviewComplete round={dailyReviewRound} onContinue={exitDailyReview} />
        ) : loading || preparingSpelling ? (
          <div className="grid min-h-[360px] place-items-center text-center text-sm font-semibold text-white/55"><div><CapybaraWalk size={72} className="mb-3" /><p>正在取下一张…</p></div></div>
        ) : spellingView ? (
          <div className="sbuddy-host">
          <ScrollArea className="sp-study min-h-0 flex-1">
            <SpellingCardView key={spellingKey} card={spellingView}
              checkInput={(typed) => checkCardInput(spellingView, typed, spellingInputLookup!)}
              onReveal={revealAnswer} voiceId={preferences.voiceId}
              onFinish={(round) => submitAnswer(round.grade, "spelling")} />
          </ScrollArea>
          {buddy}
          </div>
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
            {/* 松鼠的小路搬到了首页顶部栏(components/SquirrelTrail),
                卡片里不再为进度条留高度,全部让给答案区。 */}

            {/* 手机端题目框尽量压扁:题目通常就几个字,省下的高度让给答案区(长题目仍由内层 max-h 滚动)。
                「题目」这个标签在手机上省掉 —— 顶上那个框是题目本来就一目了然。 */}
            <div className="grid min-h-0 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#464949] px-3 py-2 text-center sm:min-h-28 sm:p-4 lg:mx-auto lg:min-h-36 lg:w-[min(900px,100%)] lg:p-6">
              <div className="w-full">
                {/* 等级/词性挪到题目面,并且放在滚动区外面 —— 释义有长到要滚的
                    (「…的省略语；super超,上,高级,超级」这种),标签不能跟着滚没。 */}
                <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1.5">
                  {preferences.showJlptLevel && card.jlptLevel && (
                    <span className="rounded-sm border border-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white/60">{card.jlptLevel}</span>
                  )}
                  {card.pos && (
                    <span className="rounded-sm bg-[#81D8CF]/10 px-1.5 py-0.5 text-[11px] font-bold text-white/60">{card.pos}</span>
                  )}
                  {/* 自/他动词是高频易错属性，统一放在题目面，翻面前就能看到。 */}
                  <TransitivityBadge card={card} />
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
                <ScrollArea className="max-h-24 w-full px-1 sm:max-h-28">
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
                </ScrollArea>
              </div>
            </div>

            <ScrollArea centerContent className="grid min-h-0 flex-1 place-items-center rounded-2xl border border-white/15 bg-[#424545] p-4 text-center sm:p-6 lg:mx-auto lg:w-[min(1040px,100%)] lg:p-10">
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
                      {/* 自他标注已经移到题目面，答案区只保留读音。 */}
                      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                        <ReadingLine
                          card={card}
                          surface={isKanjiPhase ? kanjiReadingSurface(card) : undefined}
                          className="jp text-3xl text-white/86 sm:text-4xl lg:text-5xl xl:text-6xl"
                        />
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
                        </div>
                      )}

                      {distinctions.length > 0 && (
                        <button
                          type="button"
                          className="wd-entry sm:col-span-2"
                          onClick={openDistinction}
                        >
                          <span className="wd-entry-main">
                            <span className="wd-entry-types">
                              {/* 这里是一行摘要文本，图标塞不进字符串 —— 只列类别名 */}
                              {distinctions.slice(0, 2).map((section) => section.name).join("  ·  ")}
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
                          {/* ⚠️ 这行字**只在真的有话说的时候才出现**。
                              「高亮的是拍数也一样的」只有在高亮和不高亮**同时存在**时才是信息：
                              撞车的就一个词、而且拍数也一样时（截图里的「包 → かばん 3拍」），
                              它解释的是一个看不见的区别，纯噪音。
                              「只影响这台设备」那半句已经删掉 —— 改写题面这件事一年用不了几次，
                              真要说也该在编辑框里说，不该每张撞车卡都念一遍。 */}
                          {questionRivals.some((peer) => peer.sameMora)
                            && questionRivals.some((peer) => !peer.sameMora) && (
                            <p className="mt-2 text-[11px] leading-5 text-white/45">
                              高亮的是拍数也一样、题面分不出来的。
                            </p>
                          )}
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
                  {/* 翻面前这一屏最大的字必须是题面（在卡片上方），这里只留一句小提示；「答案已隐藏」大字是废话 */}
                  <p className="text-sm text-white/55">{isReversePhase ? "想一想中文意思" : "想一想怎么读、怎么写"}</p>
                </div>
              )}
            </ScrollArea>

            <div className="relative h-16 lg:mx-auto lg:w-[min(900px,100%)]">
              {buddy}
              {reliefActive ? (
                <div className="daily-relief-auto-state" role="status" aria-live="polite">
                  {/* Taro 按 #FFFFFF 选白色图标资源，不继承父级 color */}
                  <span><Check size={16} color="#FFFFFF" aria-hidden="true" /></span>
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
                  <span className="kbd-hint text-xs font-semibold opacity-65">（按任意键）</span>
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
                        className={`focus-ring zoo-pop rate-btn rate-${option.value} h-16 min-w-0 rounded-2xl border disabled:opacity-50 ${
                          option.secondary
                            ? "border-white/12 px-1 text-sm font-semibold text-white/60 hover:bg-white/[0.06]"
                            : "border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15"
                        }`}
                      >
                        <span
                          className={`kbd-hint block text-[11px] font-black text-white/45 ${
                            option.secondary ? "tracking-normal" : "tracking-[0.18em]"
                          }`}
                        >
                          {answerHotkeyLabels[option.value]}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <FinishPanel
            stats={stats}
            phase={phase}
            localSeconds={localStudySeconds}
            focusSnapshot={focusSnapshot}
            onClaimDailyRewards={claimDailyCompletionRewards}
            onCheckIn={checkInToday}
            onContinueStage2={() => startExtraPhase("stage2")}
            onContinueKanji={() => startExtraPhase("kanji")}
            onEncore={startEncore}
            onStubbornQuickStudy={onStubbornQuickStudy}
            onOpenDistinctionQuiz={onOpenDistinctionQuiz}
          />
        )}
      </section>
      {picker}
    </div>
  );
};
