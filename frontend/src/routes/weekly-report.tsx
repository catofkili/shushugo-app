import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const WeeklyReportPage = lazyPage(() => import("../pages/WeeklyReportPage").then((module) => ({ default: module.WeeklyReportPage })));
export function WeeklyReportRoute() {
  const { state, requirePro, actions, navigate } = useApp();
  return <WeeklyReportPage key={state.weeklyReportStart ?? "latest"} initialWeekStart={state.weeklyReportStart} onBack={() => navigate("home")} onRequirePro={requirePro} onReviewWords={actions.startWeeklyReview} entry={state.weeklyReportEntry} />;
}

export const preload = WeeklyReportPage.preload;
