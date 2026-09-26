import { lazy } from "react";
import { useApp } from "../app/AppContext";
const JlptPlanPage = lazy(() => import("../pages/JlptPlanPage").then((module) => ({ default: module.JlptPlanPage })));
export function JlptPlanRoute() {
  const { goBack, actions } = useApp();
  return <JlptPlanPage onBack={goBack} onStartWords={actions.startCurrentStudyMode} onStartGrammar={() => actions.openGrammarTab("learn")} />;
}
