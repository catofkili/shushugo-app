import { useApp } from "../app/AppContext";
import { StudyModesPage } from "./lazy-pages";
import { ToolSubpage } from "./shared";
export function StudyModesRoute() {
  const { state, actions } = useApp();
  return <ToolSubpage title="学习模式"><StudyModesPage selectedMode={state.selectedStudyMode} onModeChange={actions.setSelectedStudyMode} onStart={actions.startStudyMode} /></ToolSubpage>;
}
