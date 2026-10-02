import { lazy } from "react";
import { ToolSubpage } from "./shared";

const SpellingPage = lazy(() => import("../pages/SpellingPage").then((module) => ({ default: module.SpellingPage })));

export function SpellingRoute() {
  return <ToolSubpage title="拼写（实验）"><SpellingPage /></ToolSubpage>;
}
