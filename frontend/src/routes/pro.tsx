import { useApp } from "../app/AppContext";
import { ProPage } from "./lazy-pages";
export function ProRoute() {
  const { entitlements, goBack, navigate, requirePro } = useApp();
  return <ProPage entitlements={entitlements} onBack={goBack} onOpenPaywall={() => requirePro("general")} onOpenPrivacy={() => navigate("privacy-policy")} />;
}
