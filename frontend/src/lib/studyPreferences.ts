export type ThemePreference = "system" | "light" | "dark";

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
  /** 每日复习上限,0 = 自动(近期节奏 × 1.5 夹 [60, 150]),REVIEW_CAP_UNLIMITED = 不限(全部到期词) */
  reviewCap: number;
  /** 动物园音效(评分/翻卡/完成的木质提示音) */
  zooSounds: boolean;
  /** 动效强度三档 */
  motionLevel: MotionLevel;
  /**
   * 读音用哪个声音。空 = 用音频库的默认声音;"system" = 不用预生成音频,交给设备合成。
   * 其余是生成脚本产出的声音 id(如 voicevox-3),设置页只列磁盘上真实存在的。
   */
  voiceId: string;
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
  zooSounds: true,
  motionLevel: "full",
  voiceId: ""
};

const MOTION_LEVELS: MotionLevel[] = ["full", "reduced", "off"];

const clampDailyGoal = (value: number) => {
  const normalized = Number.isFinite(value) ? Math.floor(value) : defaultStudyPreferences.dailyGoal;
  return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, normalized));
};

/** 复习上限「不限」：当天所有到期的词一次全给，不截断、不顺延 */
export const REVIEW_CAP_UNLIMITED = -1;

const clampReviewCap = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return REVIEW_CAP_UNLIMITED;
  if (value === 0) return 0;
  return Math.min(500, Math.max(30, Math.floor(value)));
};

export const normalizeStudyPreferences = (value: Partial<StudyPreferences> = {}): StudyPreferences => ({
  theme: value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : "system",
  autoPlay: value.autoPlay ?? defaultStudyPreferences.autoPlay,
  showRomaji: value.showRomaji ?? defaultStudyPreferences.showRomaji,
  dailyGoal: clampDailyGoal(Number(value.dailyGoal ?? defaultStudyPreferences.dailyGoal)),
  reviewCap: clampReviewCap(Number(value.reviewCap ?? defaultStudyPreferences.reviewCap)),
  zooSounds: value.zooSounds ?? defaultStudyPreferences.zooSounds,
  motionLevel: MOTION_LEVELS.includes(value.motionLevel as MotionLevel)
    ? (value.motionLevel as MotionLevel)
    : defaultStudyPreferences.motionLevel,
  // 不校验具体取值:声音是磁盘上有什么就有什么,选了个已删掉的由播放层自动回退
  voiceId: typeof value.voiceId === "string" ? value.voiceId : defaultStudyPreferences.voiceId
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
