import { lazy } from "react";
import { ToolSubpage } from "./shared";

const JlptPracticePage = lazy(() => import("../pages/JlptPracticePage").then((module) => ({ default: module.JlptPracticePage })));
export function JlptPracticeRoute() {
  return <ToolSubpage title="JLPT 刷题"><JlptPracticePage /></ToolSubpage>;
}
