import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const QuickStudyPage = lazyPage(() => import("../pages/QuickStudyPage").then((module) => ({ default: module.QuickStudyPage })));
export function QuickStudyRoute() {
  const { actions, navigate, state } = useApp();
  return <ToolSubpage title="快速学习"><QuickStudyPage onNavigate={navigate} onDailyModeComplete={() => actions.handleDailyModeComplete("quick")} wordIds={state.stubbornQuickIds ?? undefined} heading={state.stubbornQuickIds ? "顽固词复习" : undefined} /></ToolSubpage>;
}

export const preload = QuickStudyPage.preload;
