import { ProReadingPreview } from "../components/ProReadingPreview";
import { canUseFeature } from "../lib/entitlements";
import { useApp } from "../app/AppContext";
import { ConfusionPage } from "./lazy-pages";
import { ToolSubpage } from "./shared";
export function ConfusionRoute() {
  const { entitlements, requirePro, actions } = useApp();
  const title = "疑难辨析";
  const content = <ConfusionPage onQuiz={actions.startDistinctionQuiz} />;
  return <ToolSubpage title={title}>{canUseFeature("confusionGroups", entitlements) ? content : <ProReadingPreview title={title} onUpgrade={() => requirePro("confusionGroups")}>{content}</ProReadingPreview>}</ToolSubpage>;
}
