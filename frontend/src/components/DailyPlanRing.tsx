import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { segmentLength, PLAN_KINDS, PLAN_LABELS, type PlanKind } from "../lib/daily-plan";

/**
 * 每日学习量的圆环（docs/MIXED_STUDY_PLAN.md 第 3 节）。
 *
 * 四段 = 四种卡，**四个滑钮**在四条段界上（含顶上那条 辨析|单词，拖它时整个环跟着转，
 * 让它右边那条界不动）；中间写总量。总量固定，拖一个滑钮就是把数量从一段搬到相邻那段。
 * 段长 = log(1 + 数量)（daily-plan.segmentLength），所以**数字是真的，长度是压过的**。
 * 滑钮可以重合（某段 0）。点一段 → 放大成该段自己的一条，里面一个滑钮分「新学 / 复习」。
 *
 * 丝滑的三条（用户要 60 帧）：
 * ① `getBoundingClientRect` 只在按下那一刻量一次 —— 每个 pointermove 都量等于每帧强制一次布局；
 * ② pointermove 只记角度，真正算数 + setState 在 rAF 里，一帧最多一次（触控板 120Hz 事件会翻倍）；
 * ③ 整数没变就不 setState（binary search 落在同一个数上时什么都不发生）。
 * 松手那一下 onCommit 才落盘重排 —— 那是几十条 SQL，放在 rAF 之后的 setTimeout 里，先让最后一帧画出来。
 */
export interface RingValue {
  fresh: number;
  review: number;
}

interface Props {
  value: Record<PlanKind, RingValue>;
  /** 拖动过程中每一帧调：只改状态、只重绘，别在这里写盘或重排计划 —— 那是掉帧的来源 */
  onChange: (next: Record<PlanKind, RingValue>) => void;
  /** 松手那一下调：这时才落盘、重排今天的计划 */
  onCommit: () => void;
  /** 当前学习模式会出的段；不在里面的画淡、不计进中间那个数 */
  active: PlanKind[];
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

/** 四段的角度：log(1 + 数量) 归一到整圈；全 0 时四段等分（否则没东西可拖）。 */
const anglesOf = (counts: number[]) => {
  const lengths = counts.map(segmentLength);
  const sum = lengths.reduce((total, length) => total + length, 0);
  return sum > 0 ? lengths.map((length) => (length / sum) * TAU) : counts.map(() => TAU / 4);
};

export const DailyPlanRing = ({ value, onChange, onCommit, active, focus, onFocus, size = 240 }: Props) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // 段 0 从哪个角度起。拖顶上那颗（辨析|单词）时这个偏移跟着变，别的滑钮才不动。
  const [offset, setOffset] = useState(START);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 18;

  const counts = PLAN_KINDS.map((kind) => value[kind].fresh + value[kind].review);
  const total = PLAN_KINDS.reduce((sum, kind, index) => sum + (active.includes(kind) ? counts[index] : 0), 0);
  const angles = anglesOf(counts);
  const bounds = [offset];
  angles.forEach((angle) => bounds.push(bounds[bounds.length - 1] + angle));

  // 拖动中的临时量：按下时量的框、最新的指针角度、待处理的 rAF。都不进 state —— 它们每帧都变。
  const drag = useRef<{ knob: number; rect: DOMRect; angle: number; raf: number } | null>(null);
  // rAF 里的回调可能来自上一帧的渲染，所以算数一律读这个 ref，不读闭包里的旧值
  const latest = useRef({ value, counts, angles, bounds });
  // eslint-disable-next-line react-hooks/refs -- 渲染期写 ref 正是为了让 rAF 回调拿到最新一帧
  latest.current = { value, counts, angles, bounds };

  /**
   * 拖第 k 个滑钮 = 在第 k 段和第 k+1 段（k=3 时是第 0 段）之间搬数量。两段的数量之和 T
   * 和角度之和 A 固定；滑钮落在 θ（相对第 k 段起点）：要 log1p(a) / (log1p(a) + log1p(T−a)) = θ/A，
   * 左边随 a 单调递增，整数上二分。
   */
  const moveKnob = (k: number, angle: number) => {
    const { value: current, counts: cur, angles: ang, bounds: bnd } = latest.current;
    const a = k;
    const b = (k + 1) % 4;
    const T = cur[a] + cur[b];
    if (T === 0) return;
    const from = bnd[a];
    const A = ang[a] + ang[b];
    let theta = angle - from;
    while (theta < 0) theta += TAU;
    while (theta >= TAU) theta -= TAU;
    theta = Math.max(0, Math.min(A, theta));
    const target = A > 0 ? theta / A : 0.5;
    const share = (x: number) => { const l = segmentLength(x) + segmentLength(T - x); return l > 0 ? segmentLength(x) / l : 0.5; };
    let lo = 0;
    let hi = T;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (share(mid) < target) lo = mid; else hi = mid; }
    const nextA = Math.abs(share(lo) - target) <= Math.abs(share(hi) - target) ? lo : hi;
    const nextB = T - nextA;
    if (nextA === cur[a]) return;
    // 搬数量时按各段现在的新学/复习比例分；旧段全 0 时先把新增部分记作新学。
    const split = (kind: PlanKind, count: number) => {
      const item = current[kind];
      const itemTotal = item.fresh + item.review;
      const fresh = itemTotal > 0 ? Math.round((count * item.fresh) / itemTotal) : count;
      return { fresh, review: count - fresh };
    };
    const next = { ...current, [PLAN_KINDS[a]]: split(PLAN_KINDS[a], nextA), [PLAN_KINDS[b]]: split(PLAN_KINDS[b], nextB) };
    if (k === 3) {
      // 顶上那颗：让第 3 段的起点（它左边那条界）不动，段 0 的起点跟着新长度挪
      const nextCounts = cur.slice();
      nextCounts[3] = nextA;
      nextCounts[0] = nextB;
      const nextAngles = anglesOf(nextCounts);
      setOffset(from - (nextAngles[0] + nextAngles[1] + nextAngles[2]));
    }
    onChange(next);
  };

  const pointerAngle = (rect: DOMRect, clientX: number, clientY: number) => {
    const x = ((clientX - rect.left) / rect.width) * size - cx;
    const y = ((clientY - rect.top) / rect.height) * size - cy;
    return Math.atan2(y, x);
  };

  const flush = () => {
    const state = drag.current;
    if (!state) return;
    state.raf = 0;
    moveKnob(state.knob, state.angle);
  };

  const onPointerDown = (k: number) => (event: ReactPointerEvent) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = svgRef.current!.getBoundingClientRect();
    drag.current = { knob: k, rect, angle: pointerAngle(rect, event.clientX, event.clientY), raf: 0 };
    setDragging(k);
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current;
    if (!state) return;
    state.angle = pointerAngle(state.rect, event.clientX, event.clientY);
    if (!state.raf) state.raf = requestAnimationFrame(flush);
  };
  const endDrag = () => {
    const state = drag.current;
    if (!state) return;
    if (state.raf) cancelAnimationFrame(state.raf);
    flush();
    drag.current = null;
    setDragging(null);
    // 先让最后一帧画出来，再做落盘重排那几十条 SQL
    requestAnimationFrame(() => setTimeout(onCommit, 0));
  };
  useEffect(() => () => { if (drag.current?.raf) cancelAnimationFrame(drag.current.raf); }, []);

  const stroke = 22;
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="zoo-ring"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
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
          opacity={!active.includes(kind) ? 0.18 : focus && focus !== kind ? 0.35 : 1}
          onClick={() => onFocus(focus === kind ? null : kind)}
          style={{ cursor: "pointer" }}
        >
          <title>{PLAN_LABELS[kind]} {counts[index]}</title>
        </path>
      ))}
      {/* 四个滑钮：段 0|1、1|2、2|3、3|0 的边界；正在拖的那颗画在最上面 */}
      {[0, 1, 2, 3].sort((x, y) => (x === dragging ? 1 : y === dragging ? -1 : 0)).map((k) => {
        const [x, y] = polar(cx, cy, r, bounds[k + 1]);
        return (
          <g key={k} onPointerDown={onPointerDown(k)} style={{ cursor: dragging === k ? "grabbing" : "grab", touchAction: "none" }}>
            <circle cx={x} cy={y} r={13} fill="#fff" stroke="rgba(0,0,0,.18)" strokeWidth={2} />
            <circle cx={x} cy={y} r={5} fill={RING_COLORS[PLAN_KINDS[(k + 1) % 4]]} />
          </g>
        );
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" className="zoo-ring-total">{active.length ? total : "—"}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="zoo-ring-caption">{active.length ? "今天 · 项" : "不按圆环排"}</text>
    </svg>
  );
};
