import { useApp } from "../app/AppContext";
import { WeeklyReportPage } from "./lazy-pages";
export function WeeklyReportRoute() {
  const { state, requirePro, actions, navigate } = useApp();
  return <WeeklyReportPage key={state.weeklyReportStart ?? "latest"} initialWeekStart={state.weeklyReportStart} onBack={() => navigate("home")} onRequirePro={requirePro} onReviewWords={actions.startWeeklyReview} entry={state.weeklyReportEntry} />;
}
