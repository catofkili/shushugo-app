import { useApp } from "../app/AppContext";
import { WordLibraryPage } from "./lazy-pages";
import { ToolSubpage } from "./shared";
export function WordListRoute() {
  const { state, actions } = useApp();
  return <ToolSubpage title="选词"><WordLibraryPage key={state.wordListLevel} initialLevel={state.wordListLevel} onStudyPicked={actions.startPickedStudy} /></ToolSubpage>;
}
