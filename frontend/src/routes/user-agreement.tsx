import { lazy } from "react";
import { useApp } from "../app/AppContext";
const UserAgreement = lazy(() => import("../pages/UserAgreement").then((module) => ({ default: module.UserAgreement })));
export function UserAgreementRoute() { const { goBack } = useApp(); return <UserAgreement onBack={goBack} />; }
