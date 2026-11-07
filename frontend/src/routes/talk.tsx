import { lazyPage } from "./lazy-page";
import { ToolSubpage } from "./shared";
const TalkPage = lazyPage(() => import("../pages/TalkPage").then((module) => ({ default: module.TalkPage })));
export function TalkRoute() { return <ToolSubpage title="开口练习"><TalkPage /></ToolSubpage>; }

export const preload = TalkPage.preload;
