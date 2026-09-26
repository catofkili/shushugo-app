import { lazy } from "react";
import { useApp } from "../app/AppContext";
const PersonalInfo = lazy(() => import("../pages/PersonalInfo").then((module) => ({ default: module.PersonalInfo })));
export function PersonalInfoRoute() {
  const { navigate, goBack } = useApp();
  return <PersonalInfo onBack={goBack} onOpenAchievements={() => navigate("achievements")} />;
}
