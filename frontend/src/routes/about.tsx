import { useApp } from "../app/AppContext";
import { AboutPage } from "./lazy-pages";
export function AboutRoute() { const { goBack } = useApp(); return <AboutPage onBack={goBack} />; }
