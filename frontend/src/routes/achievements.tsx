import { useApp } from "../app/AppContext";
import { AchievementsPage } from "../pages/AchievementsPage";
export function AchievementsRoute() { const { goBack } = useApp(); return <AchievementsPage onBack={goBack} />; }
