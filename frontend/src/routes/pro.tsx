import { lazy } from "react";
import { useApp } from "../app/AppContext";
const ProPage = lazy(() => import("../pages/ProPage").then((module) => ({ default: module.ProPage })));
export function ProRoute() {
  const { entitlements, cloudSession, goBack, navigate, requireAccount, requirePro } = useApp();
  return <ProPage entitlements={entitlements} isAuthenticated={Boolean(cloudSession.token)} onRequireAuth={() => requireAccount()} onBack={goBack} onOpenPaywall={() => requirePro("general")} onOpenPrivacy={() => navigate("privacy-policy")} />;
}
