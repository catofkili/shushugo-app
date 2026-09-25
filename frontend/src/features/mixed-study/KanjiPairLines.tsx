import type { KanjiCharCard } from "../../lib/kanji-char-cards";

export const KanjiPairLines = ({
  items,
  pairs,
  readings,
  revealed
}: {
  items: NonNullable<KanjiCharCard["question"]>["items"];
  pairs: Record<number, number>;
  readings: string[];
  revealed: boolean;
}) => (
  <svg
    aria-hidden="true"
    className="pointer-events-none absolute left-[calc(50%-30px)] top-0 z-0 h-full w-[60px] overflow-visible"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
  >
    {items.map((item, wordIndex) => {
      const centerY = ((wordIndex + 0.5) / items.length) * 100;
      const assignedReading = pairs[wordIndex];
      const correctReading = readings.indexOf(item.targetReading);
      if (!revealed) {
        return assignedReading === undefined ? null : (
          <line key={`attempt-${wordIndex}`} x1="0" y1={centerY} x2="100" y2={((assignedReading + 0.5) / items.length) * 100} stroke="#d7b5f1" strokeWidth="2.6" strokeLinecap="round" opacity="0.8" />
        );
      }
      return (
        <g key={`answer-${wordIndex}`}>
          {assignedReading !== undefined && assignedReading !== correctReading && (
            <line x1="0" y1={centerY} x2="100" y2={((assignedReading + 0.5) / items.length) * 100} stroke="#f19595" strokeWidth="2.4" strokeLinecap="round" opacity="0.78" />
          )}
          <line x1="0" y1={centerY} x2="100" y2={((correctReading + 0.5) / items.length) * 100} stroke="#81D8CF" strokeWidth="2.8" strokeLinecap="round" opacity="0.92" />
        </g>
      );
    })}
  </svg>
);
