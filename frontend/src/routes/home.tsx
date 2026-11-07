import { useApp } from "../app/AppContext";
import { ZooHome } from "../components/ZooHome";
export function HomeRoute() {
  const { overview, actions, navigate, state, prefetchRoute } = useApp();
  return <ZooHome overview={overview} onNavigate={navigate} onPrefetchRoute={prefetchRoute} onOpenWordList={actions.openWordList} onOpenGrammarLevel={actions.openGrammarLevel} onStartStudy={actions.startCurrentStudyMode} onStartMode={actions.startStudyMode} activeMode={state.launchStudyMode} onRefreshOverview={actions.refreshOverview} onCompleteTodayWords={actions.completeTodayWords} onMergeDuplicates={actions.mergeDuplicates} onOpenWeeklyReport={actions.openWeeklyReportFrom} />;
}
