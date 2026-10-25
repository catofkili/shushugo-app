import { lazy } from "react";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const InvitePage = lazy(() => import("../pages/InvitePage").then((module) => ({ default: module.InvitePage })));
export function InviteRoute({ initialCode, focusInput }: { initialCode?: string; focusInput?: boolean }) {
  const { state } = useApp();
  return <ToolSubpage title="邀请好友"><InvitePage initialCode={initialCode ?? state.referralCode} focusInput={focusInput ?? state.referralFocus} /></ToolSubpage>;
}
