import { lazy } from "react";
import { useApp } from "../app/AppContext";
const AccountSecurity = lazy(() => import("../pages/AccountSecurity").then((module) => ({ default: module.AccountSecurity })));
export function AccountRoute() { const { cloudSession, goBack } = useApp(); return <AccountSecurity onBack={goBack} cloudSession={cloudSession} />; }
