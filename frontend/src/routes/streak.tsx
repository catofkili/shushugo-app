import { useApp } from "../app/AppContext";
import { StreakPage } from "../pages/StreakPage";

export function StreakRoute() {
  const { goBack } = useApp();
  return <StreakPage onBack={goBack} />;
}
