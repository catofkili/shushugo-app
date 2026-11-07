import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const AccountSecurity = lazyPage(() => import("../pages/AccountSecurity").then((module) => ({ default: module.AccountSecurity })));
export function AccountRoute() { const { cloudSession, goBack } = useApp(); return <AccountSecurity onBack={goBack} cloudSession={cloudSession} />; }

export const preload = AccountSecurity.preload;
