import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const JlptPlanPage = lazyPage(() => import("../pages/JlptPlanPage").then((module) => ({ default: module.JlptPlanPage })));
export function JlptPlanRoute() {
  const { goBack, actions } = useApp();
  return <JlptPlanPage onBack={goBack} onStartWords={actions.startCurrentStudyMode} onStartGrammar={() => actions.openGrammarTab("learn")} />;
}

export const preload = JlptPlanPage.preload;
