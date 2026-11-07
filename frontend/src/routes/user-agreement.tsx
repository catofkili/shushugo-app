import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const UserAgreement = lazyPage(() => import("../pages/UserAgreement").then((module) => ({ default: module.UserAgreement })));
export function UserAgreementRoute() { const { goBack } = useApp(); return <UserAgreement onBack={goBack} />; }

export const preload = UserAgreement.preload;
