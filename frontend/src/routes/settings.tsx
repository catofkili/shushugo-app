import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const SettingsPage = lazyPage(() => import("../pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
export function SettingsRoute() {
  const { goBack, requireAccount } = useApp();
  return <SettingsPage onBack={goBack} onRequireAuth={() => requireAccount()} />;
}

export const preload = SettingsPage.preload;
