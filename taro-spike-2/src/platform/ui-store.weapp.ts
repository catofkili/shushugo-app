import type { FeatureId } from '../../../frontend/src/lib/entitlements';

type UiState = {
  notice: string;
  paywallTarget?: FeatureId | 'general';
  authOpen: boolean;
  levelSetupOpen: boolean;
  trialEndedOpen: boolean;
  achievementPop: null | { item: { emoji: string; name: string }; rest: number; leaving: boolean };
};

let state: UiState = {
  notice: '', authOpen: false, levelSetupOpen: false, trialEndedOpen: false, achievementPop: null
};
const listeners = new Set<() => void>();
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let achievementTimer: ReturnType<typeof setTimeout> | undefined;
let achievements: Array<{ emoji: string; name: string }> = [];

export const getUiState = () => state;
export const subscribeUiState = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const update = (patch: Partial<UiState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

export const showNotice = (notice: string, timeout = 1800) => {
  clearTimeout(noticeTimer);
  update({ notice });
  noticeTimer = setTimeout(() => update({ notice: '' }), timeout);
};

export const openAuth = () => update({ authOpen: true });
export const closeAuth = () => update({ authOpen: false });
export const openPaywall = (paywallTarget: FeatureId | 'general') => update({ paywallTarget });
export const closePaywall = () => update({ paywallTarget: undefined });
export const setLevelSetupOpen = (levelSetupOpen: boolean) => update({ levelSetupOpen });
export const setTrialEndedOpen = (trialEndedOpen: boolean) => update({ trialEndedOpen });

export const queueAchievement = (item: { emoji: string; name: string }) => {
  achievements.push(item);
  if (state.achievementPop) return;
  const next = () => {
    const item = achievements.shift();
    if (!item) {
      update({ achievementPop: null });
      return;
    }
    update({ achievementPop: { item, rest: achievements.length, leaving: false } });
    achievementTimer = setTimeout(() => {
      update({ achievementPop: { item, rest: achievements.length, leaving: true } });
      achievementTimer = setTimeout(next, 260);
    }, 1700);
  };
  achievementTimer = setTimeout(next, 0);
};
