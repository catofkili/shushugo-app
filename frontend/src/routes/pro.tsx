import { lazy } from "react";
import { useApp } from "../app/AppContext";
const ProPage = lazy(() => import("../pages/ProPage").then((module) => ({ default: module.ProPage })));
export function ProRoute() {
  const { entitlements, goBack, navigate, requirePro } = useApp();
  return <ProPage entitlements={entitlements} onBack={goBack} onOpenPaywall={() => requirePro("general")} onOpenPrivacy={() => navigate("privacy-policy")} />;
}
