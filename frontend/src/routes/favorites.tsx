import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const FavoritesPage = lazyPage(() => import("../pages/FavoritesPage").then((module) => ({ default: module.FavoritesPage })));
export function FavoritesRoute() {
  const { actions } = useApp();
  return <ToolSubpage title="收藏"><FavoritesPage onOpenGrammar={actions.openGrammar} onStudyPicked={actions.startPickedStudy} /></ToolSubpage>;
}

export const preload = FavoritesPage.preload;
