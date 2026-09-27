import { lazy } from "react";
import { GrammarHighlightProvider } from "../components/GrammarHighlightProvider";
import { useApp } from "../app/AppContext";
const GrammarDetail = lazy(() => import("../pages/GrammarDetail").then((module) => ({ default: module.GrammarDetail })));
export function DetailRoute() {
  const { state, studyStore, actions } = useApp();
  return <GrammarHighlightProvider><div><GrammarDetail grammarId={state.selectedGrammarId} getMastery={studyStore.getMastery} onBack={() => actions.openGrammarTab("learn")} onLearned={actions.markLearnedWithNotice} onReview={studyStore.addToReview} /></div></GrammarHighlightProvider>;
}
