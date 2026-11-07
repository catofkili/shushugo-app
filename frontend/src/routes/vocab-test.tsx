import { lazyPage } from "./lazy-page";
import { ToolSubpage } from "./shared";
const VocabTestPage = lazyPage(() => import("../pages/VocabTestPage").then((module) => ({ default: module.VocabTestPage })));
export function VocabTestRoute() { return <ToolSubpage title="查词汇量"><VocabTestPage /></ToolSubpage>; }

export const preload = VocabTestPage.preload;
