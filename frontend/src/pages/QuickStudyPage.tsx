import { QuickStudyPanel } from "../components/QuickStudyPanel";
import type { Page } from "../types/app";

type Props = {
  onNavigate: (page: Page) => void;
  onDailyModeComplete?: () => void;
  /** 指定名单过一遍（完成页的「快速复习今天的顽固词」）。 */
  wordIds?: number[];
  heading?: string;
};

export function QuickStudyPage({ onNavigate, onDailyModeComplete, wordIds, heading }: Props) {
  return (
    <div className="quick-study-page-shell">
      <QuickStudyPanel
        variant="page"
        onNavigate={onNavigate}
        onDailyModeComplete={onDailyModeComplete}
        wordIds={wordIds}
        heading={heading}
      />
    </div>
  );
}
