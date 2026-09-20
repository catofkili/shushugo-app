import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { segmentWeight, PLAN_KINDS, PLAN_LABELS, type PlanKind, type PlanSegment } from "../lib/daily-plan";

/**
 * 每日学习量的圆环（docs/MIXED_STUDY_PLAN.md 第 3 节）。
 *
 * 四段 = 四种卡，三个滑钮在段与段的边界上；中间写总量。总量固定，拖一个滑钮就是把数量从一段
 * 搬到相邻那段。段长 = 数量 × 权重（权重 = 1/√池子，daily-plan.segmentWeight），所以
 * **数字是真的，长度是压过的**：400 词 vs 20 语法不会把语法压成一条看不见的缝。
 * 滑钮可以重合（某段 0）。点一段 → 放大成该段自己的一条，里面一个滑钮分「新学 / 复习」。
 *
 * 全部 SVG + pointer 事件，没有依赖。只读时（disabled）当进度环用。
 */
export interface RingValue {
  fresh: number;
  review: number;
}

interface Props {
  segments: PlanSegment[];
  value: Record<PlanKind, RingValue>;
  onChange: (next: Record<PlanKind, RingValue>) => void;
  /** 点了哪一段（放大） */
  focus: PlanKind | null;
  onFocus: (kind: PlanKind | null) => void;
  size?: number;
}

export const RING_COLORS: Record<PlanKind, string> = {
  words: "#6FA83E",
  grammar: "#F3B14D",
  kanji: "#B9A7F2",
  confusion: "#F2A7C8"
};

const TAU = Math.PI * 2;
const START = -Math.PI / 2;

const polar = (cx: number, cy: number, r: number, angle: number) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;

const arcPath = (cx: number, cy: number, r: number, from: number, to: number) => {
  if (to - from <= 0.0001) return "";
  if (to - from >= TAU - 0.0001) to = from + TAU - 0.0001;
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
};

export const DailyPlanRing = ({ segments, value, onChange, focus, onFocus, size = 240 }: Props) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 18;

  const counts = PLAN_KINDS.map((kind) => value[kind].fresh + value[kind].review);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const weights = segments.map((segment) => segmentWeight(segment));
  // 段长：数量 × 权重，归一到整圈。全 0 时四段等分（否则没东西可拖）。
  const lengths = counts.map((count, index) => count * weights[index]);
  const lengthSum = lengths.reduce((sum, length) => sum + length, 0);
  const angles = lengthSum > 0 ? lengths.map((length) => (length / lengthSum) * TAU) : counts.map(() => TAU / 4);
  const anglesKey = angles.join(",");
  const bounds = useMemo(() => {
    const out: number[] = [START];
    anglesKey.split(",").map(Number).forEach((angle) => out.push(out[out.length - 1] + angle));
    return out;
  }, [anglesKey]);

  const pointerAngle = (event: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * size - cx;
    const y = ((event.clientY - rect.top) / rect.height) * size - cy;
    return Math.atan2(y, x);
  };

  /**
   * 拖第 k 个滑钮 = 在第 k 段和第 k+1 段之间搬数量。两段的数量之和 T 和角度之和 A 固定；
   * 滑钮落在 θ（相对第 k 段起点）：count_a·w_a ∝ θ，count_b·w_b ∝ A−θ，解出来取整。
   */
  const moveKnob = (k: number, angle: number) => {
    const a = k;
    const b = k + 1;
    const T = counts[a] + counts[b];
    if (T === 0) return;
    const from = bounds[a];
    const A = bounds[b + 1] - from;
    let theta = angle - from;
    while (theta < 0) theta += TAU;
    while (theta > TAU) theta -= TAU;
    theta = Math.max(0, Math.min(A, theta));
    const wa = weights[a];
    const wb = weights[b];
    const denominator = theta / wa + (A - theta) / wb;
    const countA = denominator > 0 ? Math.round((T * (theta / wa)) / denominator) : counts[a];
    const nextA = Math.max(0, Math.min(T, countA));
    const nextB = T - nextA;
    if (nextA === counts[a]) return;
    // 搬数量时按各段现在的新学/复习比例分，比例没有（全 0）就先当复习
    const split = (kind: PlanKind, count: number) => {
      const current = value[kind];
      const currentTotal = current.fresh + current.review;
      const fresh = currentTotal > 0 ? Math.round((count * current.fresh) / currentTotal) : 0;
      return { fresh, review: count - fresh };
    };
    onChange({ ...value, [PLAN_KINDS[a]]: split(PLAN_KINDS[a], nextA), [PLAN_KINDS[b]]: split(PLAN_KINDS[b], nextB) });
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (dragging === null) return;
    moveKnob(dragging, pointerAngle(event));
  };

  const stroke = 22;
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="zoo-ring"
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(null)}
      onPointerLeave={() => setDragging(null)}
      role="group"
      aria-label="每日学习量"
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0,0,0,.08)" strokeWidth={stroke} />
      {PLAN_KINDS.map((kind, index) => (
        <path
          key={kind}
          d={arcPath(cx, cy, r, bounds[index], bounds[index + 1])}
          fill="none"
          stroke={RING_COLORS[kind]}
          strokeWidth={focus === kind ? stroke + 6 : stroke}
          strokeLinecap="butt"
          opacity={focus && focus !== kind ? 0.35 : 1}
          onClick={() => onFocus(focus === kind ? null : kind)}
          style={{ cursor: "pointer" }}
        >
          <title>{PLAN_LABELS[kind]} {counts[index]}</title>
        </path>
      ))}
      {/* 三个滑钮：段 0|1、1|2、2|3 的边界。第 3|0 那条边界固定在顶上，不给拖。 */}
      {[0, 1, 2].map((k) => {
        const [x, y] = polar(cx, cy, r, bounds[k + 1]);
        return (
          <g
            key={k}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); setDragging(k); }}
            style={{ cursor: "grab", touchAction: "none" }}
          >
            <circle cx={x} cy={y} r={13} fill="#fff" stroke="rgba(0,0,0,.18)" strokeWidth={2} />
            <circle cx={x} cy={y} r={5} fill={RING_COLORS[PLAN_KINDS[k + 1]]} />
          </g>
        );
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" className="zoo-ring-total">{total}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="zoo-ring-caption">今天 · 项</text>
    </svg>
  );
};
