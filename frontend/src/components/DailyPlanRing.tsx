import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PLAN_KINDS, PLAN_LABELS, type PlanKind } from "../lib/daily-plan";
import { queryTouchRect, touchEventsEnabled, touchPoint, type TouchEventLike, type TouchRect } from "../lib/touch-adapter";
import { anglesOf, arcPath, moveDailyPlanBoundary, polar, RING_COLORS, RING_START } from "./daily-plan-ring-geometry";
import type { RingValue } from "./daily-plan-ring-geometry";

export { RING_COLORS } from "./daily-plan-ring-geometry";
export type { RingValue } from "./daily-plan-ring-geometry";

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

export const DailyPlanRing = ({ value, onChange, onCommit, active, focus, onFocus, size = 240 }: Props) => {
  const touchRectId = `daily-plan-ring-${useId().replace(/:/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // 段 0 从哪个角度起。拖顶上那颗（辨析|单词）时这个偏移跟着变，别的滑钮才不动。
  const [offset, setOffset] = useState(RING_START);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 18;

  const counts = PLAN_KINDS.map((kind) => value[kind].fresh + value[kind].review);
  const total = PLAN_KINDS.reduce((sum, kind, index) => sum + (active.includes(kind) ? counts[index] : 0), 0);
  const angles = anglesOf(counts);
  const bounds = [offset];
  angles.forEach((angle) => bounds.push(bounds[bounds.length - 1] + angle));

  // 拖动中的临时量：按下时量的框、最新的指针角度、待处理的 rAF。都不进 state —— 它们每帧都变。
  const drag = useRef<{ knob: number; rect: Pick<DOMRect, "left" | "top" | "width" | "height">; angle: number; processedAngle: number; raf: number } | null>(null);
  const touchDrag = useRef<{ knob: number; rect: TouchRect | null; start: { x: number; y: number }; latest: { x: number; y: number }; ended: boolean } | null>(null);
  // rAF 里的回调可能来自上一帧的渲染，所以算数一律读这个 ref，不读闭包里的旧值
  const latest = useRef({ value, counts, angles, bounds, offset });
  // eslint-disable-next-line react-hooks/refs -- 渲染期写 ref 正是为了让 rAF 回调拿到最新一帧
  latest.current = { value, counts, angles, bounds, offset };

  /**
   * 拖第 k 个滑钮 = 在第 k 段和第 k+1 段（k=3 时是第 0 段）之间搬数量。两段的数量之和 T
   * 和角度之和 A 固定；滑钮落在 θ（相对第 k 段起点）：要 log1p(a) / (log1p(a) + log1p(T−a)) = θ/A，
   * 左边随 a 单调递增，整数上二分。
   */
  const moveKnob = (k: number, angle: number) => {
    const { value: current, offset: currentOffset } = latest.current;
    const next = moveDailyPlanBoundary(current, k, angle, currentOffset);
    if (!next) return;
    latest.current.value = next.value;
    latest.current.offset = next.offset;
    if (k === 3) setOffset(next.offset);
    onChange(next.value);
  };

  const pointerAngle = (rect: Pick<DOMRect, "left" | "top" | "width" | "height">, clientX: number, clientY: number) => {
    const x = ((clientX - rect.left) / rect.width) * size - cx;
    const y = ((clientY - rect.top) / rect.height) * size - cy;
    return Math.atan2(y, x);
  };

  const flush = () => {
    const state = drag.current;
    if (!state) return;
    state.raf = 0;
    if (state.angle === state.processedAngle) return;
    state.processedAngle = state.angle;
    moveKnob(state.knob, state.angle);
  };

  const onPointerDown = (k: number) => (event: ReactPointerEvent) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = svgRef.current!.getBoundingClientRect();
    const angle = pointerAngle(rect, event.clientX, event.clientY);
    drag.current = { knob: k, rect, angle, processedAngle: angle, raf: 0 };
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
    if (state.angle !== state.processedAngle) flush();
    drag.current = null;
    setDragging(null);
    // 先让最后一帧画出来，再做落盘重排那几十条 SQL
    requestAnimationFrame(() => setTimeout(onCommit, 0));
  };
  const onTouchStart = (k: number, event: TouchEventLike) => {
    const point = touchPoint(event);
    if (!point || touchDrag.current || drag.current) return;
    event.preventDefault?.();
    const pointAtStart = { x: point.clientX, y: point.clientY };
    const state = { knob: k, rect: null as TouchRect | null, start: pointAtStart, latest: pointAtStart, ended: false };
    touchDrag.current = state;
    void queryTouchRect(`#${touchRectId}`).then((rect) => {
      if (touchDrag.current !== state) return;
      if (!rect || rect.width <= 0 || rect.height <= 0) { touchDrag.current = null; return; }
      state.rect = rect;
      const startAngle = pointerAngle(rect, state.start.x, state.start.y);
      const angle = pointerAngle(rect, state.latest.x, state.latest.y);
      drag.current = { knob: k, rect, angle, processedAngle: startAngle, raf: 0 };
      setDragging(k);
      if (!state.ended && angle !== startAngle && !drag.current.raf) drag.current.raf = requestAnimationFrame(flush);
      if (state.ended) {
        touchDrag.current = null;
        endDrag();
      }
    });
  };
  const onTouchMove = (event: TouchEventLike) => {
    const state = touchDrag.current;
    const point = touchPoint(event);
    if (!state || !point) return;
    event.preventDefault?.();
    state.latest = { x: point.clientX, y: point.clientY };
    if (!state.rect) return;
    const active = drag.current;
    if (!active) return;
    active.angle = pointerAngle(state.rect, point.clientX, point.clientY);
    if (!active.raf) active.raf = requestAnimationFrame(flush);
  };
  const onTouchEnd = (event: TouchEventLike) => {
    const state = touchDrag.current;
    if (!state) return;
    const point = touchPoint(event, true);
    if (point) state.latest = { x: point.clientX, y: point.clientY };
    state.ended = true;
    if (!state.rect) return;
    const active = drag.current;
    if (active) active.angle = pointerAngle(state.rect, state.latest.x, state.latest.y);
    touchDrag.current = null;
    endDrag();
  };
  useEffect(() => () => { if (drag.current?.raf) cancelAnimationFrame(drag.current.raf); }, []);

  const stroke = 22;
  return (
    <svg
      id={touchRectId}
      ref={svgRef}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="zoo-ring"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onTouchMove={touchEventsEnabled() ? (event) => onTouchMove(event as unknown as TouchEventLike) : undefined}
      onTouchEnd={touchEventsEnabled() ? (event) => onTouchEnd(event as unknown as TouchEventLike) : undefined}
      onTouchCancel={touchEventsEnabled() ? (event) => onTouchEnd(event as unknown as TouchEventLike) : undefined}
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
          <g key={k} onPointerDown={onPointerDown(k)} onTouchStart={touchEventsEnabled() ? (event) => onTouchStart(k, event as unknown as TouchEventLike) : undefined} style={{ cursor: dragging === k ? "grabbing" : "grab", touchAction: "none" }}>
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
