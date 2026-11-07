import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const DuelPage = lazyPage(() => import("../pages/DuelPage").then((module) => ({ default: module.DuelPage })));
export function DuelRoute() {
  const { state, cloudSession, requireAccount, navigate } = useApp();
  return <ToolSubpage title="组队内战"><DuelPage key={state.duelId ?? "create"} id={state.duelId} session={cloudSession} onRequireAccount={() => requireAccount("duel")} onOpen={(id) => navigate("duel", { duelId: id })} /></ToolSubpage>;
}

export const preload = DuelPage.preload;
