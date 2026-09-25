import { GrammarHighlightProvider } from "../components/GrammarHighlightProvider";
import { ProReadingPreview } from "../components/ProReadingPreview";
import { canUseFeature } from "../lib/entitlements";
import { useApp } from "../app/AppContext";
import { GrammarQuiz, ImmersiveGrammar, Library } from "./lazy-pages";
export function GrammarRoute() {
  const { state, studyStore, actions, entitlements, requirePro, navigate } = useApp();
  const content = state.grammarMode === "quiz" ? <GrammarQuiz initialLevel={state.selectedGrammarLevel === "All" ? null : state.selectedGrammarLevel} onBack={() => actions.openGrammarTab("learn")} /> : state.grammarMode === "immersive" ? canUseFeature("immersiveGrammar", entitlements) ? <ImmersiveGrammar key={state.selectedGrammarLevel} selectedLevel={state.selectedGrammarLevel} onBack={() => actions.openGrammarTab("learn")} onOpenFavorites={() => navigate("favorites")} onMarkLearned={actions.markLearnedWithNotice} /> : <ProReadingPreview title="沉浸式语法" onUpgrade={() => requirePro("immersiveGrammar")}><ImmersiveGrammar key={state.selectedGrammarLevel} selectedLevel={state.selectedGrammarLevel} onBack={() => actions.openGrammarTab("learn")} onOpenFavorites={() => navigate("favorites")} onMarkLearned={actions.markLearnedWithNotice} /></ProReadingPreview> : <Library getMastery={studyStore.getMastery} onMarkLearned={actions.markLearnedWithNotice} onMarkForgot={actions.markForgotWithNotice} selectedLevel={state.selectedGrammarLevel} onSelectedLevelChange={actions.setSelectedGrammarLevel} onOpenFavorites={() => navigate("favorites")} onOpenImmersive={() => actions.openGrammarTab("immersive")} onOpenQuiz={() => actions.openGrammarTab("quiz")} onOpenDetail={actions.openGrammar} />;
  return <GrammarHighlightProvider><div>{content}</div></GrammarHighlightProvider>;
}
