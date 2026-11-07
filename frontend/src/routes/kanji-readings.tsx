import { lazyPage } from "./lazy-page";
import { ProReadingPreview } from "../components/ProReadingPreview";
import { canUseFeature } from "../lib/entitlements";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const KanjiReadingUsagePage = lazyPage(() => import("../pages/KanjiReadingUsagePage").then((module) => ({ default: module.KanjiReadingUsagePage })));
export function KanjiReadingsRoute() {
  const { entitlements, requirePro } = useApp();
  const title = "一字多音";
  return <ToolSubpage title={title}>{canUseFeature("kanjiReadingUsage", entitlements) ? <KanjiReadingUsagePage /> : <ProReadingPreview title={title} onUpgrade={() => requirePro("kanjiReadingUsage")}><KanjiReadingUsagePage /></ProReadingPreview>}</ToolSubpage>;
}

export const preload = KanjiReadingUsagePage.preload;
