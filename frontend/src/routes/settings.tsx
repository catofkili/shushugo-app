import { lazy } from "react";
import { useApp } from "../app/AppContext";
const SettingsPage = lazy(() => import("../pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
export function SettingsRoute() {
  const { goBack, requireAccount } = useApp();
  return <SettingsPage onBack={goBack} onRequireAuth={() => requireAccount()} />;
}
