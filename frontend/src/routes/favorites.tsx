import { lazy } from "react";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const FavoritesPage = lazy(() => import("../pages/FavoritesPage").then((module) => ({ default: module.FavoritesPage })));
export function FavoritesRoute() {
  const { actions } = useApp();
  return <ToolSubpage title="收藏"><FavoritesPage onOpenGrammar={actions.openGrammar} onStudyPicked={actions.startPickedStudy} /></ToolSubpage>;
}
