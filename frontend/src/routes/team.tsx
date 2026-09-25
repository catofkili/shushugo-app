import { useApp } from "../app/AppContext";
import { TeamPage } from "./lazy-pages";
export function TeamRoute() { const { goBack } = useApp(); return <TeamPage onBack={goBack} />; }
