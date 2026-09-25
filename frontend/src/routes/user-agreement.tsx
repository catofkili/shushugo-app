import { useApp } from "../app/AppContext";
import { UserAgreement } from "./lazy-pages";
export function UserAgreementRoute() { const { goBack } = useApp(); return <UserAgreement onBack={goBack} />; }
