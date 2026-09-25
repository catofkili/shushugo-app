import { useSyncExternalStore } from "react";
import type { GrammarLevelSelection } from "../lib/grammarPreferences";
import { getGrammarLevelPreference } from "../lib/grammarPreferences";
import type { QuizScope } from "../lib/distinction-quiz";
import { defaultStudyMode, getStudyMode } from "../lib/studyMode";
import type { WeeklyReportEntry } from "../lib/analytics/weekly-report-events";
import type { LibraryLevel } from "../lib/word-library";
import type { GrammarMode, Page, StudyMode } from "../types/app";

export interface AppState {
  page: Page;
  pageHistory: Page[];
  grammarMode: GrammarMode;
  selectedGrammarId: string;
  selectedFoundationRuleId: string | null;
  selectedGrammarLevel: GrammarLevelSelection;
  wordListLevel: LibraryLevel;
  stubbornQuickIds: number[] | null;
  distinctionQuizScope: QuizScope;
  selectedStudyMode: StudyMode;
  launchStudyMode: StudyMode;
  wordStudyRevision: number;
  weeklyReportStart: string | null;
  weeklyReportEntry: WeeklyReportEntry;
  pendingAccountPage: Page | null;
}

const initialMode = getStudyMode() || defaultStudyMode;
let state: AppState = {
  page: "home",
  pageHistory: [],
  grammarMode: "learn",
  selectedGrammarId: "wa",
  selectedFoundationRuleId: null,
  selectedGrammarLevel: getGrammarLevelPreference(),
  wordListLevel: "all",
  stubbornQuickIds: null,
  distinctionQuizScope: { kind: "learned" },
  selectedStudyMode: initialMode,
  launchStudyMode: initialMode,
  wordStudyRevision: 0,
  weeklyReportStart: null,
  weeklyReportEntry: "button",
  pendingAccountPage: null
};

const listeners = new Set<() => void>();

export const getAppState = () => state;

export const setAppState = (next: Partial<AppState> | ((current: AppState) => Partial<AppState>)) => {
  const patch = typeof next === "function" ? next(state) : next;
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

export const subscribeAppState = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAppState = () => useSyncExternalStore(subscribeAppState, getAppState, getAppState);
