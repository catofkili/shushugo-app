import { useApp } from "../app/AppContext";
import { PrivacySettings } from "./lazy-pages";
export function PrivacyRoute() {
  const { goBack, navigate } = useApp();
  return <PrivacySettings onBack={goBack} onOpenPolicy={() => navigate("privacy-policy")} onOpenAgreement={() => navigate("user-agreement")} />;
}
