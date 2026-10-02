import { lazy } from "react";
import { JLPT_PRACTICE_MARKER } from "../lib/jlpt-practice";
import { ToolSubpage } from "./shared";

const JlptPracticePage = lazy(() => import("../pages/JlptPracticePage").then((module) => ({ default: module.JlptPracticePage })));
export function JlptPracticeRoute() {
  return <ToolSubpage title="JLPT 刷题"><div data-jlpt-practice={JLPT_PRACTICE_MARKER}><JlptPracticePage /></div></ToolSubpage>;
}
