import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const PersonalInfo = lazyPage(() => import("../pages/PersonalInfo").then((module) => ({ default: module.PersonalInfo })));
export function PersonalInfoRoute() {
  const { navigate, goBack } = useApp();
  return <PersonalInfo onBack={goBack} onOpenAchievements={() => navigate("achievements")} />;
}

export const preload = PersonalInfo.preload;
