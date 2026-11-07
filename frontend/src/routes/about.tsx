import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const AboutPage = lazyPage(() => import("../pages/AboutPage").then((module) => ({ default: module.AboutPage })));
export function AboutRoute() { const { goBack } = useApp(); return <AboutPage onBack={goBack} />; }

export const preload = AboutPage.preload;
