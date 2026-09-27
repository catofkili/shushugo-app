import { lazy } from "react";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const DistinctionQuizPage = lazy(() => import("../pages/DistinctionQuizPage").then((module) => ({ default: module.DistinctionQuizPage })));
export function DistinctionQuizRoute() {
  const { state, navigate } = useApp();
  return <ToolSubpage title="辨析练习"><DistinctionQuizPage scope={state.distinctionQuizScope} onBackToConfusion={() => navigate("confusion")} /></ToolSubpage>;
}
