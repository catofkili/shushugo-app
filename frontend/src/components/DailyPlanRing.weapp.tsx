import { useEffect, useId, useRef, useState } from "react";
import { Canvas } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { PLAN_KINDS, PLAN_LABELS, type PlanKind } from "../lib/daily-plan";
import { queryTouchRect, touchPoint, type TouchEventLike, type TouchRect } from "../lib/touch-adapter";
import { anglesOf, moveDailyPlanBoundary, polar, RING_COLORS, RING_START, type RingValue } from "./daily-plan-ring-geometry";

interface Props {
  value: Record<PlanKind, RingValue>;
  onChange: (next: Record<PlanKind, RingValue>) => void;
  onCommit: () => void;
  active: PlanKind[];
  focus: PlanKind | null;
  onFocus: (kind: PlanKind | null) => void;
  size?: number;
}

type RingCanvas = {
  width: number;
  height: number;
  getContext: (kind: "2d") => CanvasRenderingContext2D;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
};

const STROKE = 22;
const HANDLE_HIT_RADIUS = 23;
export const DailyPlanRing = ({ value, onChange, onCommit, active, focus, onFocus, size = 240 }: Props) => {
  const canvasId = `daily-plan-ring-${useId().replace(/:/g, "")}`;
  const pixelRatio = Taro.getSystemInfoSync().pixelRatio || 1;
  const [canvasReady, setCanvasReady] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [offset, setOffset] = useState(RING_START);
  const canvasRef = useRef<{ node: RingCanvas; context: CanvasRenderingContext2D } | null>(null);
  const dragRef = useRef<{ knob: number; rect: TouchRect; angle: number; processedAngle: number; raf: number } | null>(null);
  const gestureRef = useRef<{
    rect: TouchRect | null;
    start: { x: number; y: number };
    latest: { x: number; y: number };
    ended: boolean;
    knob: number | null;
  } | null>(null);
  const counts = PLAN_KINDS.map((kind) => value[kind].fresh + value[kind].review);
  const angles = anglesOf(counts);
  const bounds = [offset];
  angles.forEach((angle) => bounds.push(bounds[bounds.length - 1] + angle));
  const latest = useRef({ value, active, focus, onFocus, onChange, onCommit, offset, counts, bounds, angles });
  latest.current = { value, active, focus, onFocus, onChange, onCommit, offset, counts, bounds, angles };

  useEffect(() => {
    let alive = true;
    // Taro commits the Canvas WXML after the effect; querying on the same tick returns no node.
    Taro.nextTick(() => {
      if (!alive) return;
      Taro.createSelectorQuery().select(`#${canvasId}`).fields({ node: true, size: true } as any).exec((result) => {
        if (!alive) return;
        const node = result?.[0]?.node as RingCanvas | undefined;
        if (!node) return;
        node.width = Math.round(size * pixelRatio);
        node.height = Math.round(size * pixelRatio);
        const context = node.getContext("2d");
        context.scale(pixelRatio, pixelRatio);
        canvasRef.current = { node, context };
        setCanvasReady(true);
      });
    });
    return () => {
      alive = false;
      const drag = dragRef.current;
      if (drag?.raf) canvasRef.current?.node.cancelAnimationFrame(drag.raf);
      dragRef.current = null;
      gestureRef.current = null;
    };
  }, [canvasId, pixelRatio, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvasReady || !canvas) return;
    const { context: ctx } = canvas;
    const center = size / 2;
    const radius = center - 18;
    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = "butt";
    ctx.lineWidth = STROKE;
    ctx.strokeStyle = "rgba(0,0,0,.08)";
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();
    PLAN_KINDS.forEach((kind, index) => {
      const span = bounds[index + 1] - bounds[index];
      if (span <= 0.0001) return;
      ctx.globalAlpha = !active.includes(kind) ? 0.18 : focus && focus !== kind ? 0.35 : 1;
      ctx.strokeStyle = RING_COLORS[kind];
      ctx.lineWidth = focus === kind ? STROKE + 6 : STROKE;
      ctx.beginPath();
      ctx.arc(center, center, radius, bounds[index], bounds[index + 1]);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    [0, 1, 2, 3].sort((a, b) => (a === dragging ? 1 : b === dragging ? -1 : 0)).forEach((knob) => {
      const [x, y] = polar(center, center, radius, bounds[knob + 1]);
      ctx.beginPath();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,.18)";
      ctx.lineWidth = 2;
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = RING_COLORS[PLAN_KINDS[(knob + 1) % 4]];
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    const total = PLAN_KINDS.reduce((sum, kind, index) => sum + (active.includes(kind) ? counts[index] : 0), 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#3a2e22";
    ctx.font = "900 31px sans-serif";
    ctx.fillText(active.length ? String(total) : "—", center, center - 7);
    ctx.fillStyle = "#818781";
    ctx.font = "12px sans-serif";
    ctx.fillText(active.length ? "今天 · 项" : "不按圆环排", center, center + 17);
  }, [active, bounds, canvasReady, counts, dragging, focus, size]);

  const pointerAngle = (rect: TouchRect, x: number, y: number) => {
    const px = ((x - rect.left) / rect.width) * size - size / 2;
    const py = ((y - rect.top) / rect.height) * size - size / 2;
    return Math.atan2(py, px);
  };

  const scheduleFrame = () => {
    const drag = dragRef.current;
    const canvas = canvasRef.current?.node;
    if (!drag || !canvas || drag.raf) return;
    drag.raf = canvas.requestAnimationFrame(() => {
      const current = dragRef.current;
      if (!current) return;
      current.raf = 0;
      if (current.angle === current.processedAngle) return;
      current.processedAngle = current.angle;
      const update = moveDailyPlanBoundary(latest.current.value, current.knob, current.angle, latest.current.offset);
      if (!update) return;
      latest.current.value = update.value;
      latest.current.offset = update.offset;
      if (current.knob === 3) setOffset(update.offset);
      latest.current.onChange(update.value);
    });
  };

  const finishDrag = () => {
    const drag = dragRef.current;
    const canvas = canvasRef.current?.node;
    if (!drag || !canvas) return;
    if (drag.raf) canvas.cancelAnimationFrame(drag.raf);
    drag.raf = 0;
    if (drag.angle !== drag.processedAngle) {
      drag.processedAngle = drag.angle;
      const update = moveDailyPlanBoundary(latest.current.value, drag.knob, drag.angle, latest.current.offset);
      if (update) {
        latest.current.value = update.value;
        latest.current.offset = update.offset;
        if (drag.knob === 3) setOffset(update.offset);
        latest.current.onChange(update.value);
      }
    }
    dragRef.current = null;
    setDragging(null);
    canvas.requestAnimationFrame(() => setTimeout(() => latest.current.onCommit(), 0));
  };

  const onTouchStart = (event: TouchEventLike) => {
    const point = touchPoint(event);
    if (!point || gestureRef.current) return;
    event.preventDefault?.();
    const gesture = {
      rect: null as TouchRect | null,
      start: { x: point.clientX, y: point.clientY },
      latest: { x: point.clientX, y: point.clientY },
      ended: false,
      knob: null as number | null
    };
    gestureRef.current = gesture;
    void queryTouchRect(`#${canvasId}`).then((rect) => {
      if (gestureRef.current !== gesture) return;
      if (!rect || rect.width <= 0 || rect.height <= 0) { gestureRef.current = null; return; }
      gesture.rect = rect;
      const px = ((gesture.start.x - rect.left) / rect.width) * size;
      const py = ((gesture.start.y - rect.top) / rect.height) * size;
      const center = size / 2;
      const radius = size / 2 - 18;
      let nearest: { index: number; distance: number } | null = null;
      for (let knob = 0; knob < 4; knob += 1) {
        const [x, y] = polar(center, center, radius, latest.current.bounds[knob + 1]);
        const distance = Math.hypot(px - x, py - y);
        if (distance <= HANDLE_HIT_RADIUS && (!nearest || distance < nearest.distance)) nearest = { index: knob, distance };
      }
      gesture.knob = nearest?.index ?? null;
      if (gesture.knob !== null) {
        const startAngle = pointerAngle(rect, gesture.start.x, gesture.start.y);
        const angle = pointerAngle(rect, gesture.latest.x, gesture.latest.y);
        dragRef.current = { knob: gesture.knob, rect, angle, processedAngle: startAngle, raf: 0 };
        setDragging(gesture.knob);
        if (!gesture.ended && angle !== startAngle) scheduleFrame();
      }
      if (gesture.ended) {
        if (gesture.knob !== null) {
          dragRef.current!.angle = pointerAngle(rect, gesture.latest.x, gesture.latest.y);
          gestureRef.current = null;
          finishDrag();
        } else {
          gestureRef.current = null;
          onTapFocus(gesture, rect);
        }
      }
    });
  };

  const onTapFocus = (gesture: NonNullable<typeof gestureRef.current>, rect: TouchRect) => {
    const { x, y } = gesture.latest;
    const localX = ((x - rect.left) / rect.width) * size - size / 2;
    const localY = ((y - rect.top) / rect.height) * size - size / 2;
    const radial = Math.hypot(localX, localY);
    if (radial < size / 2 - 18 - STROKE || radial > size / 2 - 18 + STROKE) return;
    let theta = pointerAngle(rect, x, y) - latest.current.offset;
    while (theta < 0) theta += Math.PI * 2;
    while (theta >= Math.PI * 2) theta -= Math.PI * 2;
    const index = latest.current.bounds.findIndex((bound, i) => i < 4 && theta >= bound - latest.current.offset && theta < latest.current.bounds[i + 1] - latest.current.offset);
    const kind = PLAN_KINDS[index < 0 ? 0 : index];
    latest.current.onFocus(latest.current.focus === kind ? null : kind);
  };

  const onTouchMove = (event: TouchEventLike) => {
    const gesture = gestureRef.current;
    const point = touchPoint(event);
    if (!gesture || !point) return;
    event.preventDefault?.();
    gesture.latest = { x: point.clientX, y: point.clientY };
    const drag = dragRef.current;
    if (!gesture.rect || !drag) return;
    drag.angle = pointerAngle(gesture.rect, point.clientX, point.clientY);
    scheduleFrame();
  };

  const onTouchEnd = (event: TouchEventLike) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const point = touchPoint(event, true);
    if (point && (point.clientX !== 0 || point.clientY !== 0)) gesture.latest = { x: point.clientX, y: point.clientY };
    gesture.ended = true;
    if (!gesture.rect) return;
    gestureRef.current = null;
    if (gesture.knob === null) onTapFocus(gesture, gesture.rect);
    else {
      const drag = dragRef.current;
      if (drag) drag.angle = pointerAngle(gesture.rect, gesture.latest.x, gesture.latest.y);
      finishDrag();
    }
  };

  return (
    <Canvas
      id={canvasId}
      type="2d"
      disableScroll
      className="zoo-ring"
      style={{ display: "block", width: `${size}px`, height: `${size}px`, touchAction: "none" } as any}
      onTouchStart={onTouchStart as any}
      onTouchMove={onTouchMove as any}
      onTouchEnd={onTouchEnd as any}
      onTouchCancel={onTouchEnd as any}
      aria-label={`每日学习量：${PLAN_KINDS.map((kind, index) => `${PLAN_LABELS[kind]} ${counts[index]}`).join("，")}`}
    />
  );
};
