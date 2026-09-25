import { useApp } from "../app/AppContext";
import { HelpPage } from "./lazy-pages";
export function HelpRoute() { const { goBack } = useApp(); return <HelpPage onBack={goBack} />; }
