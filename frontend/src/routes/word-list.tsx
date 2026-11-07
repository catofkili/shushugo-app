import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const WordLibraryPage = lazyPage(() => import("../pages/WordLibraryPage").then((module) => ({ default: module.WordLibraryPage })));
export function WordListRoute() {
  const { state, actions } = useApp();
  return <ToolSubpage title="选词"><WordLibraryPage key={state.wordListLevel} initialLevel={state.wordListLevel} onStudyPicked={actions.startPickedStudy} /></ToolSubpage>;
}

export const preload = WordLibraryPage.preload;
