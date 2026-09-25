import { JLPT_TARGETS, type JlptTarget } from "./jlpt/plan";
import { getState, setState } from "./database/db-utils";

export type ThemePreference = "system" | "light" | "dark";

/**
 * 动效强度。
 *   full    全开
 *   reduced 只留「按一下的即时反馈」,关掉常驻循环动画(呼吸/跳/蒸汽) —— 也最省电
 *   off     全关
 * 系统开了「减少动态效果」时不管这里选什么都按 off 处理(见 app.css 的媒体查询)。
 */
export type MotionLevel = "full" | "reduced" | "off";

export interface StudyPreferences {
  theme: ThemePreference;
  autoPlay: boolean;
  showRomaji: boolean;
  /** 题目面上那枚「N4」等级标。默认关：起点当先验写进 FSRS 后，N4 词会当复习露面，标着等级等于把「在过一遍你的 N4」说出来 */
  showJlptLevel: boolean;
  /** 学习强度 = 每日新词数(复习量由算法定) */
  dailyGoal: number;
  /**
   * 每日新语法条数。**和 dailyGoal 分开存**:一个等级只有一百来条,
   * 按每日新词数(15)排等于八天过完一级,而语法一条要记接续 + 用法。
   * 0 = 今天不学新语法,只复习已经学过的。
   */
  grammarDailyGoal: number;
  /** 每日复习上限,0 = 自动(近期节奏 × 1.5 夹 [60, 150]),REVIEW_CAP_UNLIMITED = 不限(全部到期词) */
  reviewCap: number;
  /**
   * 混合学习里另外两种卡的每日新学数（docs/MIXED_STUDY_PLAN.md）。复习不设上限：到期的全出。
   * 圆环 / 数字表单 / 备考一键改的都是这几个字段 —— 它们就是「一份状态」。
   */
  kanjiDailyGoal: number;
  confusionDailyGoal: number;
  /** 语法 / 汉字 / 辨析的每日复习上限：0 = 到期全出，PLAN_REVIEW_DISABLED = 不出复习（单词那个仍是 reviewCap） */
  grammarReviewCap: number;
  kanjiReviewCap: number;
  confusionReviewCap: number;
  /** 答题音效(评分/翻卡/完成的木质提示音)。键名沿用 zooSounds,改了用户存的开关就丢了 */
  zooSounds: boolean;
  /**
   * 每周学习回顾（二楼）总开关。关掉之后主页入口、站内提醒、通知排期和
   * 云归档都停下；**已保存的历史不删除、不锁回**，重新打开还能读。
   * 这是发布期的回滚手段，不是用户内容管理功能。
   */
  weeklyReportEnabled: boolean;
  /** 动效强度三档 */
  motionLevel: MotionLevel;
  /**
   * 读音用哪个声音。空 = 用音频库的默认声音;"system" = 不用预生成音频,交给设备合成。
   * 其余是生成脚本产出的声音 id(如 voicevox-3),设置页只列磁盘上真实存在的。
   */
  voiceId: string;
  /** 备考计划开着没有。关掉之后首页卡片和考期提醒都不出现,学习本身不受影响。 */
  jlptPlanEnabled: boolean;
  /** 备考目标级别 */
  jlptTarget: JlptTarget;
  /**
   * 考试日期,"" = 自动取下一场(7 月/12 月的第一个周日)。
   * 留手填的口子是因为考期毕竟是外部安排,报名到了别的场次时不该改代码。
   */
  jlptExamDate: string;
  /** 计划锚点：目标 / 考期最后一次改动的日期（YYYY-MM-DD）。巩固期按「锚点 → 考期」这个窗口的 1/4 缩 */
  jlptPlanStartedOn: string;
}

export const PREFERENCES_EVENT = "shushugo-preferences";

const KEY = "mn-study-preferences";

/** 学习强度档位(锚点),滑杆范围 [5, 50] */
export const INTENSITY_ANCHORS = [
  { value: 5, label: "轻松" },
  { value: 15, label: "日常" },
  { value: 30, label: "认真" },
  { value: 50, label: "冲刺" }
] as const;
export const INTENSITY_MIN = 5;
export const INTENSITY_MAX = 50;

/** 语法强度档位,滑杆范围 [0, 30];0 = 只复习不进新条目 */
export const GRAMMAR_INTENSITY_ANCHORS = [
  { value: 0, label: "只复习" },
  { value: 3, label: "轻松" },
  { value: 5, label: "日常" },
  { value: 10, label: "认真" }
] as const;
export const GRAMMAR_INTENSITY_MIN = 0;
export const GRAMMAR_INTENSITY_MAX = 30;

export const defaultStudyPreferences: StudyPreferences = {
  theme: "system",
  autoPlay: true,
  showRomaji: false,
  showJlptLevel: false,
  dailyGoal: 15,
  grammarDailyGoal: 5,
  reviewCap: 0,
  kanjiDailyGoal: 5,
  confusionDailyGoal: 5,
  grammarReviewCap: 0,
  kanjiReviewCap: 0,
  confusionReviewCap: 0,
  zooSounds: true,
  weeklyReportEnabled: true,
  motionLevel: "full",
  voiceId: "",
  jlptPlanEnabled: true,
  jlptTarget: "N3",
  jlptExamDate: "",
  jlptPlanStartedOn: ""
};

const MOTION_LEVELS: MotionLevel[] = ["full", "reduced", "off"];

const clampDailyGoal = (value: number) => {
  const normalized = Number.isFinite(value) ? Math.floor(value) : defaultStudyPreferences.dailyGoal;
  // 下限 0 不是 INTENSITY_MIN：圆环允许把某一段拖成 0（今天不学新词只复习）；设置页滑杆仍从 5 起
  return Math.min(INTENSITY_MAX, Math.max(0, normalized));
};

const clampGrammarGoal = (value: number) => {
  const normalized = Number.isFinite(value) ? Math.floor(value) : defaultStudyPreferences.grammarDailyGoal;
  return Math.min(GRAMMAR_INTENSITY_MAX, Math.max(GRAMMAR_INTENSITY_MIN, normalized));
};

/** 汉字 / 辨析的每日新学：0 = 今天不学新的只复习 */
const clampSmallGoal = (value: number, max: number) => {
  const normalized = Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.min(max, Math.max(0, normalized));
};

/** 复习上限「不限」：当天所有到期的词一次全给，不截断、不顺延 */
export const REVIEW_CAP_UNLIMITED = -1;
/** 分类复习额度的专用哨兵；区别于 0（到期全出），用于用户明确把该类计划调到 0。 */
export const PLAN_REVIEW_DISABLED = -1;

const clampReviewCap = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return REVIEW_CAP_UNLIMITED;
  if (value === 0) return 0;
  // 下限 1 不是 30：圆环可以把单词复习拖到很小，0 在这里是「自动」所以存 1
  return Math.min(500, Math.max(1, Math.floor(value)));
};

const clampPlanReviewCap = (value: number) => {
  const normalized = Number.isFinite(value) ? Math.floor(value) : 0;
  return normalized === PLAN_REVIEW_DISABLED ? PLAN_REVIEW_DISABLED : Math.min(500, Math.max(0, normalized));
};

export const normalizeStudyPreferences = (value: Partial<StudyPreferences> = {}): StudyPreferences => ({
  theme: value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : "system",
  autoPlay: value.autoPlay ?? defaultStudyPreferences.autoPlay,
  showRomaji: value.showRomaji ?? defaultStudyPreferences.showRomaji,
  showJlptLevel: value.showJlptLevel ?? defaultStudyPreferences.showJlptLevel,
  dailyGoal: clampDailyGoal(Number(value.dailyGoal ?? defaultStudyPreferences.dailyGoal)),
  grammarDailyGoal: clampGrammarGoal(Number(value.grammarDailyGoal ?? defaultStudyPreferences.grammarDailyGoal)),
  kanjiDailyGoal: clampSmallGoal(Number(value.kanjiDailyGoal ?? defaultStudyPreferences.kanjiDailyGoal), 50),
  confusionDailyGoal: clampSmallGoal(Number(value.confusionDailyGoal ?? defaultStudyPreferences.confusionDailyGoal), 20),
  grammarReviewCap: clampPlanReviewCap(Number(value.grammarReviewCap ?? 0)),
  kanjiReviewCap: clampPlanReviewCap(Number(value.kanjiReviewCap ?? 0)),
  confusionReviewCap: clampPlanReviewCap(Number(value.confusionReviewCap ?? 0)),
  reviewCap: clampReviewCap(Number(value.reviewCap ?? defaultStudyPreferences.reviewCap)),
  zooSounds: value.zooSounds ?? defaultStudyPreferences.zooSounds,
  weeklyReportEnabled: value.weeklyReportEnabled ?? defaultStudyPreferences.weeklyReportEnabled,
  motionLevel: MOTION_LEVELS.includes(value.motionLevel as MotionLevel)
    ? (value.motionLevel as MotionLevel)
    : defaultStudyPreferences.motionLevel,
  // 不校验具体取值:声音是磁盘上有什么就有什么,选了个已删掉的由播放层自动回退
  voiceId: typeof value.voiceId === "string" ? value.voiceId : defaultStudyPreferences.voiceId,
  jlptPlanEnabled: value.jlptPlanEnabled ?? defaultStudyPreferences.jlptPlanEnabled,
  jlptTarget: JLPT_TARGETS.includes(value.jlptTarget as JlptTarget)
    ? (value.jlptTarget as JlptTarget)
    : defaultStudyPreferences.jlptTarget,
  // 格式不合法就当没填,由 jlpt/status.ts 回落到自动算下一场
  jlptExamDate: /^\d{4}-\d{2}-\d{2}$/.test(String(value.jlptExamDate ?? ""))
    ? String(value.jlptExamDate)
    : defaultStudyPreferences.jlptExamDate,
  jlptPlanStartedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(value.jlptPlanStartedOn ?? ""))
    ? String(value.jlptPlanStartedOn)
    : defaultStudyPreferences.jlptPlanStartedOn
});

export const getStudyPreferences = (): StudyPreferences => {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeStudyPreferences(raw ? JSON.parse(raw) : {});
  } catch {
    return defaultStudyPreferences;
  }
};

const localIsoDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const PLAN_QUOTA_KEYS = [
  "dailyGoal", "reviewCap", "grammarDailyGoal", "grammarReviewCap",
  "kanjiDailyGoal", "kanjiReviewCap", "confusionDailyGoal", "confusionReviewCap"
] as const;

export const saveStudyPreferences = (preferences: StudyPreferences, options: { keepPlanAnchor?: boolean; fromLevelPlanSync?: boolean } = {}) => {
  const normalized = normalizeStudyPreferences(preferences);
  // 目标或考期变了 = 一份新计划，窗口从今天起算；没锚的老存档也在这里补上
  const previous = getStudyPreferences();
  if (!options.keepPlanAnchor && (!normalized.jlptPlanStartedOn || previous.jlptTarget !== normalized.jlptTarget || previous.jlptExamDate !== normalized.jlptExamDate)) {
    normalized.jlptPlanStartedOn = localIsoDate();
  }
  if (!options.fromLevelPlanSync) {
    let hasPlan = false;
    try {
      hasPlan = Boolean(getState("starting_level", ""));
    } catch { /* 词库尚未打开时本机偏好照常保存；计划创建时会补齐同步状态。 */ }
    if (hasPlan) {
        if (previous.jlptPlanEnabled !== normalized.jlptPlanEnabled) setState("jlpt_plan_enabled", normalized.jlptPlanEnabled ? "1" : "0");
        if (previous.jlptTarget !== normalized.jlptTarget) setState("jlpt_plan_target", normalized.jlptTarget);
        if (previous.jlptExamDate !== normalized.jlptExamDate) setState("jlpt_plan_exam_date", normalized.jlptExamDate);
        if (previous.jlptPlanStartedOn !== normalized.jlptPlanStartedOn) setState("jlpt_plan_started_on", normalized.jlptPlanStartedOn);
        if (PLAN_QUOTA_KEYS.some((key) => previous[key] !== normalized[key])) {
          setState("level_plan_quotas", JSON.stringify(Object.fromEntries(PLAN_QUOTA_KEYS.map((key) => [key, normalized[key]]))));
        }
    }
  }
  localStorage.setItem(KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: normalized }));
  return normalized;
};

export const kanaGatePending = () => {
  try {
    return getState("starting_level", "") === "kana-none" && getState("kana_completed", "0") !== "1";
  } catch { return false; }
};
export const getDailyWordGoal = () => kanaGatePending() ? 0 : getStudyPreferences().dailyGoal;
export const getDailyGrammarGoal = () => getStudyPreferences().grammarDailyGoal;
export const getReviewCapPreference = () => getStudyPreferences().reviewCap;

/** 老存档没有计划锚点：启动时补成今天（saveStudyPreferences 见空就填）。之前的巩固期按 21 天算，补上之后才按窗口缩 */
export const ensureJlptPlanAnchor = () => {
  const prefs = getStudyPreferences();
  if (!prefs.jlptPlanStartedOn) saveStudyPreferences(prefs);
};

export const getJlptPlanPreferences = () => {
  const prefs = getStudyPreferences();
  return {
    enabled: prefs.jlptPlanEnabled,
    target: prefs.jlptTarget,
    examDate: prefs.jlptExamDate,
    startedOn: prefs.jlptPlanStartedOn
  };
};

// 获取实际应用的主题；system 会跟随 iOS / 浏览器的外观设置。
export const getResolvedTheme = (): "light" | "dark" => {
  const prefs = getStudyPreferences();

  if (prefs.theme === "light" || prefs.theme === "dark") return prefs.theme;

  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
};

// 应用主题到 DOM
export const applyTheme = () => {
  const resolved = getResolvedTheme();
  document.documentElement.setAttribute("data-theme", resolved);
  console.log('✅ Theme applied:', resolved);
};

/**
 * 把动效档位写到 <html data-motion>,CSS 按属性降级。
 * 放 DOM 属性而不是 React state:动画写在 CSS 里,组件不需要知道当前档位。
 */
export const applyMotionLevel = (level: MotionLevel = getStudyPreferences().motionLevel) => {
  document.documentElement.setAttribute("data-motion", level);
};

/**
 * JS 驱动的动效(rAF 数字滚动这类)能不能跑。
 *
 * CSS 那套 `data-motion` 降级管不到它们 —— 属性选择器改不了 requestAnimationFrame,
 * 所以这类动效必须自己问一次。口径跟着 CSS 走:
 *   full     → 跑;
 *   reduced  → 不跑(这一档的定义就是「掐掉入场」,数字滚动正属于入场);
 *   off / 系统「减少动态效果」→ 不跑。
 * 不跑不等于不更新:调用方该显示什么数字还是什么数字,只是一步到位不滚。
 */
export const jsMotionAllowed = (): boolean => {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return getStudyPreferences().motionLevel === "full";
};

// 偏好一变就同步到 DOM,设置页改完立刻生效,不用刷新
if (typeof window !== "undefined") {
  window.addEventListener(PREFERENCES_EVENT, (event) => {
    const detail = (event as CustomEvent<StudyPreferences>).detail;
    applyTheme();
    applyMotionLevel(detail?.motionLevel ?? getStudyPreferences().motionLevel);
  });
}
