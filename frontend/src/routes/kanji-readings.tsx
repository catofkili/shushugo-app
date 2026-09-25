import { ProReadingPreview } from "../components/ProReadingPreview";
import { canUseFeature } from "../lib/entitlements";
import { useApp } from "../app/AppContext";
import { KanjiReadingUsagePage } from "./lazy-pages";
import { ToolSubpage } from "./shared";
export function KanjiReadingsRoute() {
  const { entitlements, requirePro } = useApp();
  const title = "一字多音";
  return <ToolSubpage title={title}>{canUseFeature("kanjiReadingUsage", entitlements) ? <KanjiReadingUsagePage /> : <ProReadingPreview title={title} onUpgrade={() => requirePro("kanjiReadingUsage")}><KanjiReadingUsagePage /></ProReadingPreview>}</ToolSubpage>;
}
