import { QuickStudyPanel } from "../components/QuickStudyPanel";
import type { Page } from "../types/app";

type Props = {
  onNavigate: (page: Page) => void;
};

export function QuickStudyPage({ onNavigate }: Props) {
  return (
    <div className="quick-study-page-shell">
      <QuickStudyPanel variant="page" onNavigate={onNavigate} />
    </div>
  );
}
