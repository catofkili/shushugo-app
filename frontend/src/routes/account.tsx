import { useApp } from "../app/AppContext";
import { AccountSecurity } from "./lazy-pages";
export function AccountRoute() { const { cloudSession, goBack } = useApp(); return <AccountSecurity onBack={goBack} cloudSession={cloudSession} />; }
