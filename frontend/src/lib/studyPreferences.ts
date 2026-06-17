export type ThemePreference = "system" | "light" | "dark";

export interface StudyPreferences {
  theme: ThemePreference;
  autoPlay: boolean;
  showRomaji: boolean;
  dailyGoal: number;
}

export const PREFERENCES_EVENT = "master-nihongo-preferences";

const KEY = "mn-study-preferences";

export const defaultStudyPreferences: StudyPreferences = {
  theme: "system",
  autoPlay: true,
  showRomaji: false,
  dailyGoal: 20
};

const clampDailyGoal = (value: number) => Math.min(100, Math.max(5, Math.round(value / 5) * 5));

export const normalizeStudyPreferences = (value: Partial<StudyPreferences> = {}): StudyPreferences => ({
  theme: value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : "system",
  autoPlay: value.autoPlay ?? defaultStudyPreferences.autoPlay,
  showRomaji: value.showRomaji ?? defaultStudyPreferences.showRomaji,
  dailyGoal: clampDailyGoal(Number(value.dailyGoal ?? defaultStudyPreferences.dailyGoal))
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

export const updateStudyPreferences = (patch: Partial<StudyPreferences>) => {
  return saveStudyPreferences({ ...getStudyPreferences(), ...patch });
};

export const getDailyWordGoal = () => getStudyPreferences().dailyGoal;

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
