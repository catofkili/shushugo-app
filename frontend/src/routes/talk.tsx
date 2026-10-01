import { lazy } from "react";
import { ToolSubpage } from "./shared";
const TalkPage = lazy(() => import("../pages/TalkPage").then((module) => ({ default: module.TalkPage })));
export function TalkRoute() { return <ToolSubpage title="开口练习"><TalkPage /></ToolSubpage>; }
