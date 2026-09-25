import { createContext, useContext } from "react";
import type { CloudSession } from "../lib/sync-api";
import type { ProgressOverview } from "../lib/api";
import type { EntitlementState, FeatureId } from "../lib/entitlements";
import type { WeeklyReportEntry } from "../lib/analytics/weekly-report-events";
import type { GrammarLevelSelection } from "../lib/grammarPreferences";
import type { QuizScope } from "../lib/distinction-quiz";
import type { SearchResult } from "../lib/search-api";
import type { useStudyStore } from "../hooks/useStudyStore";
import type { GrammarMode, Page, StudyMode } from "../types/app";
import type { JLPTLevel } from "../types/grammar";
import type { AppState } from "./app-store";

export type AppNavigationParams = Partial<Omit<AppState, "page" | "pageHistory">> & {
  studyMode?: StudyMode;
};

export interface AppActions {
  openWordList(level?: string): void;
  startPickedStudy(ids: number[]): void;
  openGrammarLevel(level: JLPTLevel): void;
  startStubbornQuickStudy(wordIds: number[]): void;
  startDistinctionQuiz(scope: QuizScope): void;
  startWeeklyReview(wordIds: number[]): void;
  openGrammar(id: string): void;
  openGrammarTab(mode?: GrammarMode): void;
  setSelectedGrammarLevel(value: GrammarLevelSelection): void;
  markLearnedWithNotice(id: string): void;
  markForgotWithNotice(id: string): void;
  refreshOverview(): void;
  completeTodayWords(): void;
  mergeDuplicates(): Promise<void>;
  handleSearchResult(result: SearchResult): void;
  startStudyMode(mode: StudyMode): void;
  startCurrentStudyMode(): void;
  handleDailyModeComplete(mode: StudyMode): void;
  setSelectedStudyMode(mode: StudyMode): void;
  openWeeklyReportFrom(entry: WeeklyReportEntry): void;
}

export interface AppContextValue {
  state: AppState;
  navigate(page: Page, params?: AppNavigationParams): void;
  goBack(): void;
  showNotice(text: string, timeout?: number): void;
  requirePro(featureId: FeatureId | "general"): void;
  requireAccount(nextPage?: Page): void;
  openLevelSetup(): void;
  closePaywall(): void;
  closeAuth(): void;
  handleAuthenticated(session: CloudSession): Promise<void>;
  cloudSession: CloudSession;
  entitlements: EntitlementState;
  studyStore: ReturnType<typeof useStudyStore>;
  overview: ProgressOverview;
  actions: AppActions;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppContextProvider = AppContext.Provider;

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppShell");
  return context;
};
