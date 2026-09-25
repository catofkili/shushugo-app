import { useApp } from "../app/AppContext";
import { SettingsPage } from "./lazy-pages";
export function SettingsRoute() {
  const { goBack, requireAccount } = useApp();
  return <SettingsPage onBack={goBack} onRequireAuth={() => requireAccount()} />;
}
