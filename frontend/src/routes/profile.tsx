import { lazy } from "react";
import { useApp } from "../app/AppContext";
const ProfilePage = lazy(() => import("../pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
export function ProfileRoute() {
  const { entitlements, cloudSession, navigate, requireAccount, showNotice } = useApp();
  return <ProfilePage entitlements={entitlements} cloudSession={cloudSession} onNavigate={navigate} onRequireAuth={() => requireAccount()} onNotice={showNotice} />;
}
