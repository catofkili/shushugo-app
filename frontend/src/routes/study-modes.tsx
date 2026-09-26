import { lazy } from "react";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const StudyModesPage = lazy(() => import("../pages/StudyModesPage").then((module) => ({ default: module.StudyModesPage })));
export function StudyModesRoute() {
  const { state, actions } = useApp();
  return <ToolSubpage title="学习模式"><StudyModesPage selectedMode={state.selectedStudyMode} onModeChange={actions.setSelectedStudyMode} onStart={actions.startStudyMode} /></ToolSubpage>;
}
