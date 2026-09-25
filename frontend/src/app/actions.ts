import { completeTodayWordPlan, getProgressOverview, recordStubbornQuickStudy, startPickedStudy as startPickedWordStudy } from "../lib/api";
import { saveGrammarLevelPreference, type GrammarLevelSelection } from "../lib/grammarPreferences";
import { activateMistakesForToday, defaultStudyMode, getStudyMode, saveStudyMode, studyModeInfo } from "../lib/studyMode";
import type { QuizScope } from "../lib/distinction-quiz";
import type { SearchResult } from "../lib/search-api";
import type { WeeklyReportEntry } from "../lib/analytics/weekly-report-events";
import type { LibraryLevel } from "../lib/word-library";
import type { GrammarMode, Page, StudyMode } from "../types/app";
import type { JLPTLevel } from "../types/grammar";
import { getAppState, setAppState } from "./app-store";

interface ActionDependencies {
  navigate(page: Page, studyMode?: StudyMode): void;
  showNotice(text: string, timeout?: number): void;
  setOverview(overview: ReturnType<typeof getProgressOverview>): void;
  confirm(message: string): boolean;
  markLearned(id: string): void;
  recordReview(id: string, isCorrect: boolean): void;
}

export function createAppActions(deps: ActionDependencies) {
  const refreshOverview = () => deps.setOverview(getProgressOverview());

  const markLearnedWithNotice = (id: string) => {
    // The study store is injected by App through this function's call site.
    deps.markLearned(id);
    refreshOverview();
    deps.showNotice("已标记为掌握，并保存到本地进度。");
  };

  const markForgotWithNotice = (id: string) => {
    deps.recordReview(id, false);
    deps.showNotice("已固定到前面，稍后继续看。");
  };

  return {
    openWordList(level?: string) {
      const known: LibraryLevel[] = ["N5", "N4", "N3", "N2", "N1"];
      setAppState({ wordListLevel: known.includes(level as LibraryLevel) ? (level as LibraryLevel) : "all" });
      deps.navigate("word-list");
    },
    startPickedStudy(ids: number[]) {
      if (!ids.length) return;
      const { session } = startPickedWordStudy(ids);
      // 全部被标成熟知时一张都出不来；进入空完成页会伪装成学完了。
      if (!session.card) {
        deps.showNotice("这些词都标了熟知，先「放回复习」再学。", 3000);
        return;
      }
      deps.navigate("word", "picked");
    },
    openGrammarLevel(level: JLPTLevel) {
      setAppState({ selectedGrammarLevel: saveGrammarLevelPreference(level) });
      deps.navigate("grammar");
    },
    startStubbornQuickStudy(wordIds: number[]) {
      if (!wordIds.length) return;
      // 和加餐记同一笔账。
      recordStubbornQuickStudy(wordIds.length);
      setAppState({ stubbornQuickIds: wordIds, page: "quick-study" });
    },
    startDistinctionQuiz(scope: QuizScope) {
      setAppState({ distinctionQuizScope: scope });
      deps.navigate("distinction-quiz");
    },
    startWeeklyReview(wordIds: number[]) {
      if (!wordIds.length) return;
      const { page, pageHistory } = getAppState();
      setAppState({ stubbornQuickIds: wordIds, page: "quick-study", pageHistory: [...pageHistory, page] });
    },
    openGrammar(id: string) {
      setAppState({ selectedGrammarId: id });
      deps.navigate("detail");
    },
    openGrammarTab(mode: GrammarMode = "learn") {
      setAppState({ grammarMode: mode, ...(mode === "learn" ? { selectedGrammarId: "wa" } : {}) });
      deps.navigate("grammar");
    },
    setSelectedGrammarLevel(value: GrammarLevelSelection) {
      setAppState({ selectedGrammarLevel: saveGrammarLevelPreference(value) });
    },
    markLearnedWithNotice,
    markForgotWithNotice,
    refreshOverview,
    completeTodayWords() {
      if (!deps.confirm("确定要把今天的单词任务直接标记为完成吗？这会记录为今日已完成并进入完成页。")) return;
      try {
        const result = completeTodayWordPlan();
        setAppState((state) => ({ wordStudyRevision: state.wordStudyRevision + 1 }));
        refreshOverview();
        deps.showNotice(result.completedCount ? `已完成今日 ${result.completedCount} 个单词任务。` : "今日单词任务已处于完成状态。", 2200);
        deps.navigate("word");
      } catch (error) {
        deps.showNotice(error instanceof Error ? error.message : "一键完成失败。", 2600);
      }
    },
    async mergeDuplicates() {
      /**
       * 合并会删除词条行，先让用户看见范围，再确认；动手前存整库恢复点。
       */
      const { duplicateMergePlan, mergeDuplicateWords } = await import("../lib/duplicate-merge");
      const plan = duplicateMergePlan();
      if (!plan.pairs.length) {
        deps.showNotice("没有找到重复录入的词条。", 2600);
        return;
      }
      const confirmed = deps.confirm(
        `发现 ${plan.pairs.length} 行重复录入的词条（其中 ${plan.bothStudied} 组你两边都学过）。\n\n`
        + `合并会把这些行上的 ${plan.reviews} 条作答记录搬到保留的那行上，然后删掉重复行。\n`
        + "学习记录一条都不会丢，但删行不可逆。合并前会自动存一份整库恢复点。\n\n继续吗？"
      );
      if (!confirmed) return;
      try {
        const { saveRecoverySnapshot } = await import("../lib/storage");
        await saveRecoverySnapshot("before-duplicate-merge");
        const report = mergeDuplicateWords();
        refreshOverview();
        deps.showNotice(
          `已合并 ${report.merged} 行重复词条，搬走 ${report.movedReviews} 条作答；`
          + `作答总数 ${report.reviewsBefore} → ${report.reviewsAfter}，一条没丢。`,
          6000
        );
      } catch (error) {
        console.error("[merge] 合并重复词条失败", error);
        deps.showNotice("合并失败，数据没有改动。", 4000);
      }
    },
    handleSearchResult(result: SearchResult) {
      if (result.type === "grammar") {
        setAppState({ selectedGrammarId: result.id });
        deps.navigate("detail");
        return;
      }
      deps.navigate("word");
      deps.showNotice(`已找到单词：${result.title}`, 2200);
    },
    startStudyMode(mode: StudyMode) {
      const safeMode = saveStudyMode(mode || defaultStudyMode);
      setAppState({ selectedStudyMode: safeMode, launchStudyMode: safeMode });
      const ownPage = studyModeInfo(safeMode).page;
      if (ownPage) {
        deps.navigate(ownPage);
        return;
      }
      deps.navigate("word", safeMode);
    },
    startCurrentStudyMode() {
      // 自动错题本不能走 saveStudyMode，否则会被误存成永久选择，第二天 4 点也恢复不回去。
      const currentMode = getStudyMode();
      setAppState({ selectedStudyMode: currentMode, launchStudyMode: currentMode });
      const ownPage = studyModeInfo(currentMode).page;
      deps.navigate(ownPage ?? "word", currentMode);
    },
    handleDailyModeComplete(mode: StudyMode) {
      // 只更新选择态，不改当前 WordStudy 的 initialMode，保留完成页。
      setAppState({ selectedStudyMode: activateMistakesForToday(mode) });
    },
    setSelectedStudyMode(mode: StudyMode) {
      setAppState({ selectedStudyMode: mode });
    },
    openWeeklyReportFrom(entry: WeeklyReportEntry) {
      setAppState({ weeklyReportEntry: entry, weeklyReportStart: null });
      deps.navigate("weekly-report");
    }
  };
}
