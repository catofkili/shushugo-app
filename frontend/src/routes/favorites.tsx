import { useApp } from "../app/AppContext";
import { FavoritesPage } from "./lazy-pages";
import { ToolSubpage } from "./shared";
export function FavoritesRoute() {
  const { actions } = useApp();
  return <ToolSubpage title="收藏"><FavoritesPage onOpenGrammar={actions.openGrammar} onStudyPicked={actions.startPickedStudy} /></ToolSubpage>;
}
