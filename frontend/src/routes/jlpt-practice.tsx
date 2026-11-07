import { lazyPage } from "./lazy-page";
import { ToolSubpage } from "./shared";

const JlptPracticePage = lazyPage(() => import("../pages/JlptPracticePage").then((module) => ({ default: module.JlptPracticePage })));
export function JlptPracticeRoute() {
  return <ToolSubpage title="JLPT 刷题"><JlptPracticePage /></ToolSubpage>;
}

export const preload = JlptPracticePage.preload;
