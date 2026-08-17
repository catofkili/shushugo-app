import { grammarPoints } from "../data/grammar";
import type { GrammarPoint, JLPTLevel } from "../types/grammar";

export interface GrammarSequence {
  level: JLPTLevel;
  ordinal: number;
  total: number;
  label: string;
}

const orderedPoints = grammarPoints
  .map((point, sourceIndex) => ({ point, sourceIndex }))
  .sort((left, right) => (
    (left.point.bookOrder ?? left.sourceIndex) - (right.point.bookOrder ?? right.sourceIndex)
  ));

const totals = new Map<JLPTLevel, number>();
const ordinals = new Map<string, number>();

orderedPoints.forEach(({ point }) => {
  const ordinal = (totals.get(point.level) ?? 0) + 1;
  totals.set(point.level, ordinal);
  ordinals.set(point.id, ordinal);
});

export const grammarSequence = (point: Pick<GrammarPoint, "id" | "level">): GrammarSequence => {
  const ordinal = ordinals.get(point.id) ?? 0;
  return {
    level: point.level,
    ordinal,
    total: totals.get(point.level) ?? 0,
    label: `${point.level} · ${String(ordinal).padStart(3, "0")}`
  };
};
