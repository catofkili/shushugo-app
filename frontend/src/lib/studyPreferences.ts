export type ThemePreference = "system" | "light" | "dark";

/** 回归节奏:gentle = 约 7 天由轻到重摊还;pressure = 2~3 天高强度清空 */
export type ComebackMode = "gentle" | "pressure";

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
  comebackMode: "gentle"
};

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
  comebackMode: value.comebackMode === "pressure" ? "pressure" : "gentle"
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

// 获取实际应用的主题（解析 system）
export const getResolvedTheme = (): "light" | "dark" => {
  const prefs = getStudyPreferences();

  if (prefs.theme === "light") return "light";
  if (prefs.theme === "dark") return "dark";

  // system: 检查系统主题
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
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
