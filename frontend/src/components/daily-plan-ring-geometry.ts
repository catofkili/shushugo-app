import { segmentLength, PLAN_KINDS, type PlanKind } from "../lib/daily-plan";

export interface RingValue {
  fresh: number;
  review: number;
}

export const RING_COLORS: Record<PlanKind, string> = {
  words: "#6FA83E",
  grammar: "#F3B14D",
  kanji: "#B9A7F2",
  confusion: "#F2A7C8"
};

export const RING_TAU = Math.PI * 2;
export const RING_START = -Math.PI / 2;

export const polar = (cx: number, cy: number, r: number, angle: number) =>
  [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;

export const arcPath = (cx: number, cy: number, r: number, from: number, to: number) => {
  if (to - from <= 0.0001) return "";
  if (to - from >= RING_TAU - 0.0001) to = from + RING_TAU - 0.0001;
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
};

/** log(1 + count) segments normalized to one turn; zero totals get equal draggable segments. */
export const anglesOf = (counts: number[]) => {
  const lengths = counts.map(segmentLength);
  const sum = lengths.reduce((total, length) => total + length, 0);
  return sum > 0 ? lengths.map((length) => (length / sum) * RING_TAU) : counts.map(() => RING_TAU / 4);
};

/** Shared geometry and boundary update for both the web SVG and Mini Program Canvas renderers. */
export const moveDailyPlanBoundary = (
  current: Record<PlanKind, RingValue>,
  knob: number,
  angle: number,
  offset: number
): { value: Record<PlanKind, RingValue>; offset: number } | null => {
  const counts = PLAN_KINDS.map((kind) => current[kind].fresh + current[kind].review);
  const angles = anglesOf(counts);
  const bounds = [offset];
  angles.forEach((part) => bounds.push(bounds[bounds.length - 1] + part));
  const a = knob;
  const b = (knob + 1) % 4;
  const total = counts[a] + counts[b];
  if (total === 0) return null;
  const from = bounds[a];
  const combinedAngle = angles[a] + angles[b];
  let theta = angle - from;
  while (theta < 0) theta += RING_TAU;
  while (theta >= RING_TAU) theta -= RING_TAU;
  theta = Math.max(0, Math.min(combinedAngle, theta));
  const target = combinedAngle > 0 ? theta / combinedAngle : 0.5;
  const share = (count: number) => {
    const length = segmentLength(count) + segmentLength(total - count);
    return length > 0 ? segmentLength(count) / length : 0.5;
  };
  let low = 0;
  let high = total;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (share(middle) < target) low = middle;
    else high = middle;
  }
  const nextA = Math.abs(share(low) - target) <= Math.abs(share(high) - target) ? low : high;
  if (nextA === counts[a]) return null;
  const nextB = total - nextA;
  const split = (kind: PlanKind, count: number) => {
    const item = current[kind];
    const itemTotal = item.fresh + item.review;
    const fresh = itemTotal > 0 ? Math.round((count * item.fresh) / itemTotal) : count;
    return { fresh, review: count - fresh };
  };
  const value = {
    ...current,
    [PLAN_KINDS[a]]: split(PLAN_KINDS[a], nextA),
    [PLAN_KINDS[b]]: split(PLAN_KINDS[b], nextB)
  };
  let nextOffset = offset;
  if (knob === 3) {
    const nextCounts = counts.slice();
    nextCounts[3] = nextA;
    nextCounts[0] = nextB;
    const nextAngles = anglesOf(nextCounts);
    nextOffset = from - (nextAngles[0] + nextAngles[1] + nextAngles[2]);
  }
  return { value, offset: nextOffset };
};
