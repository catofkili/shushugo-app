import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const DistinctionQuizPage = lazyPage(() => import("../pages/DistinctionQuizPage").then((module) => ({ default: module.DistinctionQuizPage })));
export function DistinctionQuizRoute() {
  const { state, navigate } = useApp();
  return <ToolSubpage title="辨析练习"><DistinctionQuizPage scope={state.distinctionQuizScope} onBackToConfusion={() => navigate("confusion")} /></ToolSubpage>;
}

export const preload = DistinctionQuizPage.preload;
