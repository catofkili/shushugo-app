import { lazy } from "react";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const WordLibraryPage = lazy(() => import("../pages/WordLibraryPage").then((module) => ({ default: module.WordLibraryPage })));
export function WordListRoute() {
  const { state, actions } = useApp();
  return <ToolSubpage title="选词"><WordLibraryPage key={state.wordListLevel} initialLevel={state.wordListLevel} onStudyPicked={actions.startPickedStudy} /></ToolSubpage>;
}
