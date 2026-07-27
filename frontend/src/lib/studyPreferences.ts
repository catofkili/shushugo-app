export type ThemePreference = "system" | "light" | "dark";

/** 回归节奏:gentle = 约 7 天由轻到重摊还;pressure = 2~3 天高强度清空 */
export type ComebackMode = "gentle" | "pressure";

/**
 * 动效强度。
 *   full    全开
 *   reduced 只留「按一下的即时反馈」,关掉常驻循环动画(呼吸/跳/蒸汽) —— 也最省电
 *   off     全关
 * 系统开了「减少动态效果」时不管这里选什么都按 off 处理(见 master-home.css 的媒体查询)。
 */
export type MotionLevel = "full" | "reduced" | "off";

export interface StudyPreferences {
  theme: ThemePreference;
  autoPlay: boolean;
  showRomaji: boolean;
  /** 学习强度 = 每日新词数,唯一的词汇量旋钮(复习量由算法定) */
  dailyGoal: number;
  /** 每日复习上限,0 = 自动(近期节奏 × 1.5 夹 [60, 150]) */
  reviewCap: number;
  /** 回归模式节奏偏好,触发回归时按此摊还积压 */
  comebackMode: ComebackMode;
  /** 动物园音效(评分/翻卡/完成的木质提示音) */
  zooSounds: boolean;
  /** 动效强度三档 */
  motionLevel: MotionLevel;
}

export const PREFERENCES_EVENT = "master-nihongo-preferences";

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

export const defaultStudyPreferences: StudyPreferences = {
  theme: "system",
  autoPlay: true,
  showRomaji: false,
  dailyGoal: 15,
  reviewCap: 0,
  comebackMode: "gentle",
  zooSounds: true,
  motionLevel: "full"
};

const MOTION_LEVELS: MotionLevel[] = ["full", "reduced", "off"];

const clampDailyGoal = (value: number) => {
  const normalized = Number.isFinite(value) ? Math.floor(value) : defaultStudyPreferences.dailyGoal;
  return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, normalized));
};

const clampReviewCap = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(500, Math.max(30, Math.floor(value)));
};

export const normalizeStudyPreferences = (value: Partial<StudyPreferences> = {}): StudyPreferences => ({
  theme: value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : "system",
  autoPlay: value.autoPlay ?? defaultStudyPreferences.autoPlay,
  showRomaji: value.showRomaji ?? defaultStudyPreferences.showRomaji,
  dailyGoal: clampDailyGoal(Number(value.dailyGoal ?? defaultStudyPreferences.dailyGoal)),
  reviewCap: clampReviewCap(Number(value.reviewCap ?? defaultStudyPreferences.reviewCap)),
  comebackMode: value.comebackMode === "pressure" ? "pressure" : "gentle",
  zooSounds: value.zooSounds ?? defaultStudyPreferences.zooSounds,
  motionLevel: MOTION_LEVELS.includes(value.motionLevel as MotionLevel)
    ? (value.motionLevel as MotionLevel)
    : defaultStudyPreferences.motionLevel
});

export const getStudyPreferences = (): StudyPreferences => {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeStudyPreferences(raw ? JSON.parse(raw) : {});
  } catch {
    return defaultStudyPreferences;
  }
};

export const saveStudyPreferences = (preferences: StudyPreferences) => {
  const normalized = normalizeStudyPreferences(preferences);
  localStorage.setItem(KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: normalized }));
  return normalized;
};

export const getDailyWordGoal = () => getStudyPreferences().dailyGoal;
export const getReviewCapPreference = () => getStudyPreferences().reviewCap;
export const getComebackModePreference = (): ComebackMode => getStudyPreferences().comebackMode;

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

// 偏好一变就同步到 DOM,设置页改完立刻生效,不用刷新
if (typeof window !== "undefined") {
  window.addEventListener(PREFERENCES_EVENT, (event) => {
    const detail = (event as CustomEvent<StudyPreferences>).detail;
    applyTheme();
    applyMotionLevel(detail?.motionLevel ?? getStudyPreferences().motionLevel);
  });
}
