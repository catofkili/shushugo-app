import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const PrivacyPolicy = lazyPage(() => import("../pages/PrivacyPolicy").then((module) => ({ default: module.PrivacyPolicy })));
export function PrivacyPolicyRoute() { const { goBack } = useApp(); return <PrivacyPolicy onBack={goBack} />; }

export const preload = PrivacyPolicy.preload;
