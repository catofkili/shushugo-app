import { lazy } from "react";
import { useApp } from "../app/AppContext";
const PrivacyPolicy = lazy(() => import("../pages/PrivacyPolicy").then((module) => ({ default: module.PrivacyPolicy })));
export function PrivacyPolicyRoute() { const { goBack } = useApp(); return <PrivacyPolicy onBack={goBack} />; }
