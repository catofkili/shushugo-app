import { useApp } from "../app/AppContext";
import { QuickStudyPage } from "./lazy-pages";
import { ToolSubpage } from "./shared";
export function QuickStudyRoute() {
  const { actions, navigate, state } = useApp();
  return <ToolSubpage title="快速学习"><QuickStudyPage onNavigate={navigate} onDailyModeComplete={() => actions.handleDailyModeComplete("quick")} wordIds={state.stubbornQuickIds ?? undefined} heading={state.stubbornQuickIds ? "顽固词复习" : undefined} /></ToolSubpage>;
}
