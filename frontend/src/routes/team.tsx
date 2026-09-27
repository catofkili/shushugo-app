import { lazy } from "react";
import { useApp } from "../app/AppContext";
const TeamPage = lazy(() => import("../pages/TeamPage").then((module) => ({ default: module.TeamPage })));
export function TeamRoute() { const { goBack } = useApp(); return <TeamPage onBack={goBack} />; }
