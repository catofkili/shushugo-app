import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const ProfilePage = lazyPage(() => import("../pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
export function ProfileRoute() {
  const { entitlements, cloudSession, navigate, requireAccount, showNotice, openFeedbackComposer } = useApp();
  return <ProfilePage entitlements={entitlements} cloudSession={cloudSession} onNavigate={navigate} onRequireAuth={() => requireAccount()} onNotice={showNotice} onFeedback={openFeedbackComposer} />;
}

export const preload = ProfilePage.preload;
