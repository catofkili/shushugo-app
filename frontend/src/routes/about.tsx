import { lazy } from "react";
import { useApp } from "../app/AppContext";
const AboutPage = lazy(() => import("../pages/AboutPage").then((module) => ({ default: module.AboutPage })));
export function AboutRoute() { const { goBack } = useApp(); return <AboutPage onBack={goBack} />; }
