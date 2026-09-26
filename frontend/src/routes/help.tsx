import { lazy } from "react";
import { useApp } from "../app/AppContext";
const HelpPage = lazy(() => import("../pages/HelpPage").then((module) => ({ default: module.HelpPage })));
export function HelpRoute() { const { goBack } = useApp(); return <HelpPage onBack={goBack} />; }
