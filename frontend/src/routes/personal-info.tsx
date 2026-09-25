import { useApp } from "../app/AppContext";
import { PersonalInfo } from "./lazy-pages";
export function PersonalInfoRoute() {
  const { navigate, goBack } = useApp();
  return <PersonalInfo onBack={goBack} onOpenAchievements={() => navigate("achievements")} />;
}
