import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const HelpPage = lazyPage(() => import("../pages/HelpPage").then((module) => ({ default: module.HelpPage })));
export function HelpRoute() { const { goBack } = useApp(); return <HelpPage onBack={goBack} />; }

export const preload = HelpPage.preload;
