import { lazy } from "react";
import { useApp } from "../app/AppContext";
const TeamPage = lazy(() => import("../pages/TeamPage").then((module) => ({ default: module.TeamPage })));
export function TeamRoute({ initialInviteCode = "" }: { initialInviteCode?: string }) { const { goBack, navigate } = useApp(); return <TeamPage initialInviteCode={initialInviteCode} onBack={goBack} onOpenDuel={() => navigate("duel", { duelId: null })} />; }
