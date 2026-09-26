import { lazy } from "react";
import { ToolSubpage } from "./shared";
const VocabTestPage = lazy(() => import("../pages/VocabTestPage").then((module) => ({ default: module.VocabTestPage })));
export function VocabTestRoute() { return <ToolSubpage title="查词汇量"><VocabTestPage /></ToolSubpage>; }
