import type { KanjiCharCard } from "../../lib/kanji-char-cards";

export const KanjiPairLines = ({
  items,
  pairs,
  readings,
  revealed,
  height,
  rowHeight,
  rowGap
}: {
  items: NonNullable<KanjiCharCard["question"]>["items"];
  pairs: Record<number, number>;
  readings: string[];
  revealed: boolean;
  height: number;
  rowHeight: number;
  rowGap: number;
}) => {
  const rowCenter = (index: number) => ((index * (rowHeight + rowGap) + rowHeight / 2) / height) * 100;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute left-[calc(50%-30px)] top-0 z-0 h-full w-[60px] overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {items.map((item, wordIndex) => {
        const centerY = rowCenter(wordIndex);
        const assignedReading = pairs[wordIndex];
        const correctReading = readings.indexOf(item.targetReading);
        if (!revealed) {
          return assignedReading === undefined ? null : (
            <line key={`attempt-${wordIndex}`} x1="0" y1={centerY} x2="100" y2={rowCenter(assignedReading)} stroke="var(--quiz-accent)" strokeWidth="2.6" strokeLinecap="round" opacity="0.8" />
          );
        }
        return (
          <g key={`answer-${wordIndex}`}>
            {assignedReading !== undefined && assignedReading !== correctReading && (
              <line x1="0" y1={centerY} x2="100" y2={rowCenter(assignedReading)} stroke="var(--ds-danger)" strokeWidth="2.4" strokeLinecap="round" opacity="0.78" />
            )}
            <line x1="0" y1={centerY} x2="100" y2={rowCenter(correctReading)} stroke="var(--ds-primary)" strokeWidth="2.8" strokeLinecap="round" opacity="0.92" />
          </g>
        );
      })}
    </svg>
  );
};
