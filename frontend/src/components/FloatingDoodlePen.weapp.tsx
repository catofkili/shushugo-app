import { useEffect, useId, useRef, useState } from "react";
import { Canvas, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { PencilLine, Undo2 } from "lucide-react";
import { queryTouchRect, touchPoint, type TouchEventLike, type TouchPoint } from "../lib/touch-adapter";

type Point = { x: number; y: number };
const CANVAS_ID = "floating-doodle-pen";
type CanvasNode = { width: number; height: number; getContext: (kind: "2d") => CanvasRenderingContext2D };

/** Native Canvas and touch implementation; the web component relies on DOM portals and pointer capture. */
export function FloatingDoodlePen({ resetKey, surfaceSelector }: { resetKey?: string | number; surfaceSelector?: string }) {
  const info = Taro.getSystemInfoSync();
  const width = info.windowWidth;
  const height = info.windowHeight;
  const pixelRatio = info.pixelRatio || 1;
  const canvasId = `${CANVAS_ID}-${useId().replace(/:/g, "")}`;
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState({ x: Math.max(12, width - 76), y: Math.max(72, height - 200) });
  const [hasStrokes, setHasStrokes] = useState(false);
  const strokes = useRef<Point[][]>([]);
  const strokesByKey = useRef<Record<string, Point[][]>>({});
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const previousKey = useRef(String(resetKey ?? "default"));
  const stroke = useRef<Point[] | null>(null);
  const drawingTouch = useRef<{ start: TouchPoint; latest: TouchPoint; ended: boolean } | null>(null);
  const offset = useRef<Point>({ x: 0, y: 0 });
  const penDrag = useRef<{ x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const surfaceKey = String(resetKey ?? "default");

  const configure = (context: CanvasRenderingContext2D) => {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 6;
    context.strokeStyle = "rgba(255, 43, 43, 0.34)";
  };
  const redraw = () => {
    const context = contextRef.current;
    if (!context) return;
    context.clearRect(0, 0, width, height);
    configure(context);
    strokes.current.forEach((line) => {
      if (line.length < 2) return;
      const first = screenPoint(line[0]);
      context.beginPath();
      context.moveTo(first.x, first.y);
      line.slice(1).forEach((point) => {
        const next = screenPoint(point);
        context.lineTo(next.x, next.y);
      });
      context.stroke();
    });
  };

  useEffect(() => {
    let alive = true;
    Taro.createSelectorQuery().select(`#${canvasId}`).fields({ node: true, size: true } as any).exec((result) => {
      if (!alive) return;
      const node = result?.[0]?.node as CanvasNode | undefined;
      if (!node) return;
      node.width = Math.round(width * pixelRatio);
      node.height = Math.round(height * pixelRatio);
      const context = node.getContext("2d");
      context.scale(pixelRatio, pixelRatio);
      configure(context);
      contextRef.current = context;
      redraw();
    });
    return () => { alive = false; contextRef.current = null; };
  }, [canvasId, height, pixelRatio, width]);

  useEffect(() => {
    strokesByKey.current[previousKey.current] = strokes.current;
    strokes.current = strokesByKey.current[surfaceKey] ?? [];
    previousKey.current = surfaceKey;
    stroke.current = null;
    setHasStrokes(strokes.current.length > 0);
    void queryTouchRect(surfaceSelector || "#floating-doodle-pen-surface").then((rect) => {
      offset.current = rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 };
      redraw();
    });
  }, [surfaceKey, surfaceSelector, width, height]);

  const localPoint = (point: TouchPoint): Point => ({ x: point.clientX - offset.current.x, y: point.clientY - offset.current.y });
  const screenPoint = (point: Point): Point => ({ x: point.x + offset.current.x, y: point.y + offset.current.y });
  const appendPoint = (next: Point) => {
    const points = stroke.current;
    if (!points) return;
    const previous = points[points.length - 1];
    if (previous.x === next.x && previous.y === next.y) return;
    points.push(next);
    strokesByKey.current[surfaceKey] = strokes.current;
    const context = contextRef.current;
    if (!context) return;
    configure(context);
    const from = screenPoint(previous);
    const to = screenPoint(next);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  };
  const startDrawing = (event: TouchEventLike) => {
    if (!active) return;
    event.preventDefault?.();
    const point = touchPoint(event);
    if (!point) return;
    const state = { start: point, latest: point, ended: false };
    drawingTouch.current = state;
    void queryTouchRect(surfaceSelector || "#floating-doodle-pen-surface").then((rect) => {
      if (drawingTouch.current !== state) return;
      offset.current = rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 };
      stroke.current = [localPoint(state.start)];
      strokes.current.push(stroke.current);
      strokesByKey.current[surfaceKey] = strokes.current;
      setHasStrokes(true);
      appendPoint(localPoint(state.latest));
      if (state.ended) { stroke.current = null; drawingTouch.current = null; }
    });
  };
  const moveDrawing = (event: TouchEventLike) => {
    if (!active || !drawingTouch.current) return;
    event.preventDefault?.();
    const next = touchPoint(event);
    if (!next) return;
    drawingTouch.current.latest = next;
    if (stroke.current) appendPoint(localPoint(next));
  };
  const finishDrawing = (event: TouchEventLike) => {
    const state = drawingTouch.current;
    if (!state) return;
    const point = touchPoint(event, true);
    if (point) state.latest = point;
    state.ended = true;
    if (!stroke.current) return;
    appendPoint(localPoint(state.latest));
    stroke.current = null;
    drawingTouch.current = null;
  };
  const startPenDrag = (event: TouchEventLike) => {
    const point = touchPoint(event);
    if (!point) return;
    penDrag.current = { x: point.clientX, y: point.clientY, originX: position.x, originY: position.y, moved: false };
  };
  const movePenDrag = (event: TouchEventLike) => {
    const drag = penDrag.current;
    const point = touchPoint(event);
    if (!drag || !point) return;
    const dx = point.clientX - drag.x;
    const dy = point.clientY - drag.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    setPosition({
      x: Math.min(Math.max(drag.originX + dx, 12), Math.max(width - 60, 12)),
      y: Math.min(Math.max(drag.originY + dy, 72), Math.max(height - 96, 72))
    });
  };
  const endPenDrag = () => {
    if (!penDrag.current) return;
    suppressClick.current = penDrag.current.moved;
    penDrag.current = null;
  };
  const undo = () => {
    strokes.current = strokes.current.slice(0, -1);
    strokesByKey.current[surfaceKey] = strokes.current;
    stroke.current = null;
    setHasStrokes(strokes.current.length > 0);
    redraw();
  };
  const toggle = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setActive((value) => !value);
  };

  return <>
    <Canvas
      id={canvasId}
      type="2d"
      className="fixed inset-0 z-30"
      style={{ width: `${width}px`, height: `${height}px`, pointerEvents: active ? "auto" : "none" }}
      onTouchStart={(event) => startDrawing(event as unknown as TouchEventLike)}
      onTouchMove={(event) => moveDrawing(event as unknown as TouchEventLike)}
      onTouchEnd={finishDrawing}
      onTouchCancel={finishDrawing}
      catchMove={active}
    />
    <View
      className={`focus-ring fixed z-[9999] grid h-12 w-12 touch-none place-items-center rounded-2xl border shadow-xl backdrop-blur transition ${active ? "border-red-300/70 bg-red-500/28 text-red-50 shadow-red-500/20" : "doodle-pen-idle border-white/20 bg-[#343838]/90 text-white/78 shadow-black/25"}`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onTouchStart={(event) => startPenDrag(event as unknown as TouchEventLike)}
      onTouchMove={(event) => movePenDrag(event as unknown as TouchEventLike)}
      onTouchEnd={endPenDrag}
      onTouchCancel={endPenDrag}
      onClick={toggle}
    >
      <PencilLine size={20} />
    </View>
    {active && <View
      className={`doodle-pen-idle focus-ring fixed z-[9999] grid h-10 w-10 place-items-center rounded-2xl border border-white/20 bg-[#343838]/90 text-white/78 shadow-xl backdrop-blur transition ${hasStrokes ? "" : "opacity-35"}`}
      style={{ left: `${position.x}px`, top: `${position.y + 54}px` }}
      onClick={hasStrokes ? undo : undefined}
    ><Undo2 size={17} /></View>}
  </>;
}
