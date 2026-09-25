import { useApp } from "../app/AppContext";
import { PrivacyPolicy } from "./lazy-pages";
export function PrivacyPolicyRoute() { const { goBack } = useApp(); return <PrivacyPolicy onBack={goBack} />; }
