import { StreakPageView } from "../components/streak/StreakPageView";

export function StreakPage({ onBack }: { onBack: () => void }) {
  return <StreakPageView onBack={onBack} />;
}
