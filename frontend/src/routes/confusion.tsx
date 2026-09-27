import { lazy } from "react";
import { ProReadingPreview } from "../components/ProReadingPreview";
import { canUseFeature } from "../lib/entitlements";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const ConfusionPage = lazy(() => import("../pages/ConfusionPage").then((module) => ({ default: module.ConfusionPage })));
export function ConfusionRoute() {
  const { entitlements, requirePro, actions } = useApp();
  const title = "疑难辨析";
  const content = <ConfusionPage onQuiz={actions.startDistinctionQuiz} />;
  return <ToolSubpage title={title}>{canUseFeature("confusionGroups", entitlements) ? content : <ProReadingPreview title={title} onUpgrade={() => requirePro("confusionGroups")}>{content}</ProReadingPreview>}</ToolSubpage>;
}
