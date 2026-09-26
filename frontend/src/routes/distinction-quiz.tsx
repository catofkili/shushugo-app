import { useApp } from "../app/AppContext";
import { DistinctionQuizPage } from "./lazy-pages";
import { ToolSubpage } from "./shared";
export function DistinctionQuizRoute() {
  const { state, navigate } = useApp();
  return <ToolSubpage title="辨析练习"><DistinctionQuizPage scope={state.distinctionQuizScope} onBackToConfusion={() => navigate("confusion")} /></ToolSubpage>;
}
