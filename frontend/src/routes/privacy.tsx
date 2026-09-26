import { lazy } from "react";
import { useApp } from "../app/AppContext";
const PrivacySettings = lazy(() => import("../pages/PrivacySettings").then((module) => ({ default: module.PrivacySettings })));
export function PrivacyRoute() {
  const { goBack, navigate } = useApp();
  return <PrivacySettings onBack={goBack} onOpenPolicy={() => navigate("privacy-policy")} onOpenAgreement={() => navigate("user-agreement")} />;
}
