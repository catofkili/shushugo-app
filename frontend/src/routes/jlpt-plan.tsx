import { useApp } from "../app/AppContext";
import { JlptPlanPage } from "./lazy-pages";
export function JlptPlanRoute() {
  const { goBack, actions } = useApp();
  return <JlptPlanPage onBack={goBack} onStartWords={actions.startCurrentStudyMode} onStartGrammar={() => actions.openGrammarTab("learn")} />;
}
