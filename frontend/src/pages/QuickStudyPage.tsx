import { QuickStudyPanel } from "../components/QuickStudyPanel";
import type { Page } from "../types/app";

type Props = {
  onNavigate: (page: Page) => void;
  onDailyModeComplete?: () => void;
};

export function QuickStudyPage({ onNavigate, onDailyModeComplete }: Props) {
  return (
    <div className="quick-study-page-shell">
      <QuickStudyPanel variant="page" onNavigate={onNavigate} onDailyModeComplete={onDailyModeComplete} />
    </div>
  );
}
