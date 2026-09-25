import { WordStudy } from "../pages/WordStudy";
import { useApp } from "../app/AppContext";
export function WordRoute() {
  const { state, actions } = useApp();
  return <WordStudy key={state.wordStudyRevision} initialMode={state.launchStudyMode} onDailyModeComplete={actions.handleDailyModeComplete} onStubbornQuickStudy={actions.startStubbornQuickStudy} onOpenDistinctionQuiz={() => actions.startDistinctionQuiz({ kind: "today" })} />;
}
