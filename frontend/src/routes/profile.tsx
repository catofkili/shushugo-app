import { useApp } from "../app/AppContext";
import { ProfilePage } from "./lazy-pages";
export function ProfileRoute() {
  const { entitlements, cloudSession, navigate, requireAccount, showNotice } = useApp();
  return <ProfilePage entitlements={entitlements} cloudSession={cloudSession} onNavigate={navigate} onRequireAuth={() => requireAccount()} onNotice={showNotice} />;
}
