/**
 * 背词的十分钟观测与可选倒计时，共享给 Web / App / 小程序。
 * 这里只收 study-clock 算过的有效毫秒，不自己数墙上时间。隐藏、走神、休息由调用方停表。
 * baseline 独立累计，启用/关闭倒计时都不重置它。未满窗口仅本机保存，完整窗口进入同步。
 * focus 不恢复：离开学习页或重启后，未领取的奖励作废，不能从历史窗口补领。
 */
import type { WordAnswer } from "../types/vocabulary";
import { getDatabase } from "./database";
import { getState, persistSoon, rowsFor, setState, studyDate } from "./database/db-utils";
import { claimStudyFocusYuzu, nextStudyFocusYuzu, YUZU } from "./yuzu";

export const STUDY_FOCUS_WINDOW_MS = 10 * 60 * 1000;
export const STUDY_FOCUS_REWARDS = YUZU.focus;
export const STUDY_FOCUS_REWARD_MIN_MS = YUZU.focusMinimumMs;
export const STUDY_FOCUS_PARTIAL_KEY = "study_focus_partial_windows";
/**
 * 每段至少背够这么多个词才发专注柚子（用户 2026-09-28 定的）：挂着翻翻例句、
 * 刷页面但不背词就能领奖，奖的就不是专注了。每日计划收尾的五分钟奖励也沿用这条门槛。
 */
export const STUDY_FOCUS_MIN_WORDS = YUZU.focusMinimumWords;
/** 对比只看最近这么多天的基线：半年前的自己不是「平时」。 */
export const STUDY_FOCUS_BASELINE_DAYS = 30;
const ARMED_KEY = "mn-study-focus-armed";

/** 主页那个勾：这台设备上进背词页时要不要自动开倒计时。设备偏好，不同步。 */
export const isStudyFocusArmed = (): boolean => {
  try { return localStorage.getItem(ARMED_KEY) === "1"; } catch { return false; }
};
export const setStudyFocusArmed = (armed: boolean): void => {
  try {
    if (armed) localStorage.setItem(ARMED_KEY, "1");
    else localStorage.removeItem(ARMED_KEY);
  } catch { /* 存不下就只在这一次生效 */ }
};

type Answers = Record<string, WordAnswer>;
interface StudyWindow {
  id: string;
  startedAt: number;
  activeMs: number;
  answers: Answers;
}
export interface StudyFocusCounts {
  words: number;
  remembered: number;
  fuzzy: number;
  forgotten: number;
}
export interface StudyFocusSummary extends StudyFocusCounts {
  /** 0–100；没有作答时为 null。只是本轮自评，不能称为长期保持率。 */
  rememberedRate: number | null;
  /** 这段背够 STUDY_FOCUS_MIN_WORDS 个词才算数：不够的不发柚子。 */
  qualified: boolean;
  baselineWindows: number;
  baselineRemembered: number | null;
  rememberedDelta: number | null;
  /** 每十个有效学习分钟的「记得」词数变化；基线为 0 时不计算百分比。 */
  efficiencyChangePercent: number | null;
}
export interface StudyFocusSnapshot {
  status: "off" | "running" | "break";
  remainingSeconds: number;
  focusWindowId: string | null;
  activeMs: number;
  summary: StudyFocusSummary | null;
  nextReward: number;
  rewardClaimed: boolean;
}
interface Runtime {
  source: string | null;
  baselines: Record<string, StudyWindow>;
  focus: StudyWindow | null;
  completedAt: number | null;
  summary: StudyFocusSummary | null;
  unsavedMs: number;
  /** 当前可领取档位按学习日缓存；领取后保留到开始下一段。 */
  reward: { day: string; value: number } | null;
  rewardClaimed: boolean;
  answerHistory: {
    wordId: number;
    baselineId: string;
    baselinePrevious?: WordAnswer;
    focusId?: string;
    focusPrevious?: WordAnswer;
  }[];
}

const runtimes = new WeakMap<object, Runtime>();
const newWindow = (nowMs: number): StudyWindow => ({
  id: `focus-${nowMs}-${Math.random().toString(36).slice(2, 12)}`,
  startedAt: nowMs, activeMs: 0, answers: {}
});
const isAnswer = (answer: unknown): answer is WordAnswer =>
  answer === "know" || answer === "known_forever" || answer === "fuzzy" || answer === "forgot";
const validWindow = (value: unknown): value is StudyWindow => {
  if (!value || typeof value !== "object") return false;
  const window = value as Partial<StudyWindow>;
  return typeof window.id === "string" && typeof window.startedAt === "number" && Number.isFinite(window.startedAt)
    && typeof window.activeMs === "number" && Number.isFinite(window.activeMs)
    && window.activeMs >= 0 && window.activeMs < STUDY_FOCUS_WINDOW_MS
    && !!window.answers && typeof window.answers === "object" && !Array.isArray(window.answers)
    && Object.entries(window.answers).every(([id, answer]) => Number.isInteger(Number(id)) && Number(id) > 0 && isAnswer(answer));
};
const runtime = (): Runtime => {
  const db = getDatabase();
  let current = runtimes.get(db);
  if (!current) {
    let baselines: Record<string, StudyWindow> = {};
    try {
      const saved: unknown = JSON.parse(getState(STUDY_FOCUS_PARTIAL_KEY, "{}"));
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        baselines = Object.fromEntries(Object.entries(saved).filter(([, value]) => validWindow(value)));
      }
    } catch { /* 只丢损坏的未满窗口；历史记录和奖励账本不受影响。 */ }
    current = { source: null, baselines, focus: null, completedAt: null, summary: null, unsavedMs: 0, reward: null, rewardClaimed: false, answerHistory: [] };
    runtimes.set(db, current);
  }
  return current;
};
const persistPartial = (current: Runtime): void => {
  setState(STUDY_FOCUS_PARTIAL_KEY, JSON.stringify(current.baselines));
  current.unsavedMs = 0;
  persistSoon();
};

/** 同一个词重复答只占一个名额，以本窗口最后一次自评为准。 */
export const studyFocusCounts = (answers: Answers): StudyFocusCounts => {
  const values = Object.values(answers);
  return {
    words: values.length,
    remembered: values.filter((answer) => answer === "know" || answer === "known_forever").length,
    fuzzy: values.filter((answer) => answer === "fuzzy").length,
    forgotten: values.filter((answer) => answer === "forgot").length
  };
};

export const summarizeStudyFocus = (answers: Answers, previous: StudyFocusCounts[]): StudyFocusSummary => {
  const counts = studyFocusCounts(answers);
  const baselineRemembered = previous.length ? previous.reduce((sum, window) => sum + window.remembered, 0) / previous.length : null;
  return {
    ...counts,
    rememberedRate: counts.words ? counts.remembered / counts.words * 100 : null,
    qualified: counts.words >= STUDY_FOCUS_MIN_WORDS,
    baselineWindows: previous.length,
    baselineRemembered,
    rememberedDelta: baselineRemembered === null ? null : counts.remembered - baselineRemembered,
    efficiencyChangePercent: baselineRemembered === null || baselineRemembered === 0
      ? null : (counts.remembered - baselineRemembered) / baselineRemembered * 100
  };
};

const saveWindow = (window: StudyWindow, kind: "baseline" | "focus", source: string, nowMs: number): void => {
  const counts = studyFocusCounts(window.answers);
  // 不够数的基线直接不存：它不参与任何对比，存下来只是白占同步快照。
  // 倒计时那段照存 —— 领奖要按它的 id 查这一行。
  if (kind === "baseline" && counts.words < STUDY_FOCUS_MIN_WORDS) return;
  getDatabase().run(`INSERT OR IGNORE INTO study_focus_windows
    (id, kind, source, started_at, completed_at, active_ms, words, remembered, fuzzy, forgotten)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [window.id, kind, source, window.startedAt, nowMs, kind === "baseline" ? STUDY_FOCUS_WINDOW_MS : window.activeMs,
    counts.words, counts.remembered, counts.fuzzy, counts.forgotten]);
};

const previousFocusBaselines = (source: string, startedAt: number): StudyFocusCounts[] => rowsFor(`
  SELECT words, remembered, fuzzy, forgotten FROM study_focus_windows
  WHERE kind = 'baseline' AND source = ? AND completed_at <= ? AND completed_at >= ? AND words >= ?`,
[source, startedAt, startedAt - STUDY_FOCUS_BASELINE_DAYS * 86_400_000, STUDY_FOCUS_MIN_WORDS])
  .map((row) => ({ words: Number(row.words), remembered: Number(row.remembered), fuzzy: Number(row.fuzzy), forgotten: Number(row.forgotten) }));

const cachedNextReward = (current: Runtime, day: string): number => {
  if (current.reward?.day !== day) current.reward = { day, value: nextStudyFocusYuzu(day) };
  return current.reward.value;
};

export const getStudyFocusSnapshot = (nowMs = Date.now()): StudyFocusSnapshot => {
  const current = runtime();
  return {
    status: current.summary ? "break" : current.focus ? "running" : "off",
    remainingSeconds: Math.max(0, Math.ceil((STUDY_FOCUS_WINDOW_MS - (current.focus?.activeMs ?? 0)) / 1000)),
    focusWindowId: current.focus?.id ?? null,
    activeMs: current.focus?.activeMs ?? 0,
    summary: current.summary,
    nextReward: current.summary && !current.summary.qualified
      ? 0 : cachedNextReward(current, studyDate(new Date(current.completedAt ?? nowMs))),
    rewardClaimed: current.rewardClaimed
  };
};

/**
 * 页面状态只需要跟着这几项变。剩余秒数每秒都变，交给倒计时胶囊自己读 ——
 * 不然整个背词页（连同小程序的 setData）每秒重渲一次，没开倒计时的人也一样。
 */
export const sameStudyFocusState = (a: StudyFocusSnapshot, b: StudyFocusSnapshot): boolean =>
  a.status === b.status && a.nextReward === b.nextReward && a.summary === b.summary && a.rewardClaimed === b.rewardClaimed;

export const enterStudyFocus = (source: string, nowMs = Date.now()): StudyFocusSnapshot => {
  const current = runtime();
  if (current.source !== source) {
    current.focus = null;
    current.summary = null;
    current.completedAt = null;
    current.reward = null;
    current.rewardClaimed = false;
    current.source = source;
    current.answerHistory = [];
  }
  current.baselines[source] ??= newWindow(nowMs);
  return getStudyFocusSnapshot(nowMs);
};

/**
 * 可每秒调用；休息时忽略所有传入时间，超过倒计时终点的余量也不记入休息。
 * 带 source 时只收当前入口的时间：小程序里被切走的页面仍挂着、计时器还在跑，
 * 它那点无操作尾巴不能记到别的入口头上。
 */
export const recordStudyFocusTime = (activeMs: number, nowMs = Date.now(), source?: string): StudyFocusSnapshot => {
  const current = runtime();
  if (!current.source || (source !== undefined && source !== current.source) || current.summary || !Number.isFinite(activeMs) || activeMs <= 0) return getStudyFocusSnapshot(nowMs);
  const acceptedMs = Math.min(activeMs, current.focus ? STUDY_FOCUS_WINDOW_MS - current.focus.activeMs : activeMs);
  let remaining = acceptedMs;
  while (remaining > 0) {
    const baseline = current.baselines[current.source];
    const chunk = Math.min(remaining, STUDY_FOCUS_WINDOW_MS - baseline.activeMs);
    baseline.activeMs += chunk;
    remaining -= chunk;
    if (baseline.activeMs === STUDY_FOCUS_WINDOW_MS) {
      saveWindow(baseline, "baseline", current.source, nowMs - remaining);
      current.baselines[current.source] = newWindow(nowMs - remaining);
    }
  }
  if (current.focus) {
    current.focus.activeMs += acceptedMs;
    if (current.focus.activeMs === STUDY_FOCUS_WINDOW_MS) {
      saveWindow(current.focus, "focus", current.source, nowMs);
      // 使用启用之前已完整记录的同入口窗口。当前这轮与重叠窗口不能充当自己的基线。
      current.summary = summarizeStudyFocus(current.focus.answers, previousFocusBaselines(current.source, current.focus.startedAt));
      current.completedAt = nowMs;
    }
  }
  current.unsavedMs += acceptedMs;
  current.answerHistory = current.answerHistory.filter((event) =>
    event.baselineId === current.baselines[current.source!].id || event.focusId === current.focus?.id);
  // 沿用已有落盘调度，避免一秒一次快照；作答、整段完成和离开时另行立即排保存。
  if (current.unsavedMs >= 15_000 || current.summary) persistPartial(current);
  return getStudyFocusSnapshot(nowMs);
};

/** 在真实作答成功写入后调用。看答案、批量标熟知、浏览词典不算一次背词。 */
export const recordStudyFocusAnswer = (wordId: number, answer: WordAnswer, nowMs = Date.now()): StudyFocusSnapshot => {
  const current = runtime();
  if (!current.source || current.summary || !Number.isInteger(wordId) || wordId <= 0 || !isAnswer(answer)) return getStudyFocusSnapshot(nowMs);
  const baseline = current.baselines[current.source];
  current.answerHistory.push({
    wordId, baselineId: baseline.id, baselinePrevious: baseline.answers[String(wordId)],
    focusId: current.focus?.id, focusPrevious: current.focus?.answers[String(wordId)]
  });
  baseline.answers[String(wordId)] = answer;
  if (current.focus) current.focus.answers[String(wordId)] = answer;
  persistPartial(current);
  return getStudyFocusSnapshot(nowMs);
};

/** 真正撤销作答成功后再调。恢复前次自评，不能简单删词；已完成的窗口仍保留原快照。 */
export const undoStudyFocusAnswer = (wordId: number, nowMs = Date.now()): StudyFocusSnapshot => {
  const current = runtime();
  if (!current.source || current.summary) return getStudyFocusSnapshot(nowMs);
  let index = current.answerHistory.length - 1;
  while (index >= 0 && current.answerHistory[index].wordId !== wordId) index--;
  if (index < 0) return getStudyFocusSnapshot(nowMs);
  const [event] = current.answerHistory.splice(index, 1);
  const restore = (window: StudyWindow | null, id: string | undefined, previous: WordAnswer | undefined) => {
    if (!window || window.id !== id) return;
    if (previous) window.answers[String(wordId)] = previous;
    else delete window.answers[String(wordId)];
  };
  restore(current.baselines[current.source], event.baselineId, event.baselinePrevious);
  restore(current.focus, event.focusId, event.focusPrevious);
  persistPartial(current);
  return getStudyFocusSnapshot(nowMs);
};

export const startStudyFocus = (nowMs = Date.now()): StudyFocusSnapshot => {
  const current = runtime();
  if (current.source && !current.focus) {
    current.focus = newWindow(nowMs);
    current.rewardClaimed = false;
  }
  return getStudyFocusSnapshot(nowMs);
};

/** 领取只结算本段奖励；保留休息页状态，点击宝箱失败时可重试。 */
export const claimStudyFocusReward = (): number => {
  const current = runtime();
  if (!current.source || !current.focus || !current.summary?.qualified || current.rewardClaimed) return 0;
  const now = getStudyFocusSnapshot().nextReward;
  if (now <= 0) return 0;
  const earned = claimStudyFocusYuzu(current.focus.id);
  current.rewardClaimed = true;
  return earned;
};

/** 奖励通过宝箱单独领取；未领取时保留休息页，让用户不会无意丢掉奖励。 */
export const continueStudyFocus = (nowMs = Date.now()): boolean => {
  const current = runtime();
  if (!current.source || !current.focus || !current.summary) return false;
  if (current.summary.qualified && getStudyFocusSnapshot(nowMs).nextReward > 0 && !current.rewardClaimed) return false;
  current.reward = null;
  current.rewardClaimed = false;
  current.focus = newWindow(nowMs);
  current.summary = null;
  current.completedAt = null;
  return true;
};

export const stopStudyFocus = (nowMs = Date.now()): StudyFocusSnapshot => {
  const current = runtime();
  current.focus = null;
  current.summary = null;
  current.completedAt = null;
  current.reward = null;
  current.rewardClaimed = false;
  persistPartial(current);
  return getStudyFocusSnapshot(nowMs);
};

/** 每日计划结束时，收下已专注至少 5 分钟的一段；更短的段落作废。 */
export const finishStudyFocusAtDailyCompletion = (nowMs = Date.now()): StudyFocusSnapshot => {
  const current = runtime();
  if (!current.source || !current.focus || current.summary) return getStudyFocusSnapshot(nowMs);
  if (current.focus.activeMs < STUDY_FOCUS_REWARD_MIN_MS) {
    current.focus = null;
    current.reward = null;
    current.rewardClaimed = false;
    persistPartial(current);
    return getStudyFocusSnapshot(nowMs);
  }
  saveWindow(current.focus, "focus", current.source, nowMs);
  current.summary = summarizeStudyFocus(current.focus.answers, previousFocusBaselines(current.source, current.focus.startedAt));
  current.completedAt = nowMs;
  persistPartial(current);
  return getStudyFocusSnapshot(nowMs);
};

/**
 * 回主页/离开学习页必须调用：保留无感观测，丢弃当前倒计时和待领奖励。
 * 带 source 时只离开自己：小程序里 A 页的 onShow 可能先于 B 页的卸载，
 * B 离开时不能把 A 刚接上的会话一起清掉。
 */
export const leaveStudyFocus = (source?: string): void => {
  if (source !== undefined && runtime().source !== source) return;
  stopStudyFocus();
  runtime().source = null;
};
