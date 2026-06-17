import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PointerEvent } from "react";
import { PencilLine, Undo2 } from "lucide-react";

type DrawPoint = { x: number; y: number };

interface FloatingDoodlePenProps {
  resetKey?: string | number;
  surfaceSelector?: string;
}

export function FloatingDoodlePen({ resetKey, surfaceSelector }: FloatingDoodlePenProps) {
  const [penActive, setPenActive] = useState(false);
  const [penPosition, setPenPosition] = useState({ x: 20, y: 112 });
  const [strokeVersion, setStrokeVersion] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<DrawPoint[][]>([]);
  const strokesByKeyRef = useRef<Record<string, DrawPoint[][]>>({});
  const currentStrokeRef = useRef<DrawPoint[] | null>(null);
  const penPositionInitializedRef = useRef(false);
  const previousSurfaceKeyRef = useRef("default");
  const suppressNextClickRef = useRef(false);
  const penDragRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false
  });

  const configureCanvasContext = (context: CanvasRenderingContext2D) => {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 6;
    context.strokeStyle = "rgba(255, 43, 43, 0.34)";
  };

  const surfaceKey = String(resetKey ?? "default");
  const hasStrokes = strokeVersion >= 0 && strokesRef.current.length > 0;

  // Strokes are stored in "surface-local" document coordinates (relative to the
  // top-left of the doodle surface, independent of scroll). The canvas itself is
  // kept at viewport size and fixed in place, so it never grows with the page —
  // crucial on iOS/WKWebView, where an oversized canvas silently stops drawing.
  const surfaceOffset = useCallback((): DrawPoint => {
    if (!surfaceSelector) return { x: 0, y: 0 };
    const el = document.querySelector<HTMLElement>(surfaceSelector);
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }, [surfaceSelector]);

  const toScreen = (point: DrawPoint, offset: DrawPoint): DrawPoint => ({
    x: point.x + offset.x,
    y: point.y + offset.y
  });

  const redrawDoodles = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    configureCanvasContext(context);

    const offset = surfaceOffset();
    strokesRef.current.forEach((stroke) => {
      if (stroke.length < 2) return;
      const first = toScreen(stroke[0], offset);
      context.beginPath();
      context.moveTo(first.x, first.y);
      stroke.slice(1).forEach((point) => {
        const next = toScreen(point, offset);
        context.lineTo(next.x, next.y);
      });
      context.stroke();
    });
  }, [surfaceOffset]);

  const clearCanvas = useCallback(() => {
    strokesRef.current = [];
    currentStrokeRef.current = null;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const clampPenPosition = (x: number, y: number) => ({
    x: Math.min(Math.max(x, 12), Math.max(window.innerWidth - 60, 12)),
    y: Math.min(Math.max(y, 72), Math.max(window.innerHeight - 96, 72))
  });

  useEffect(() => {
    redrawDoodles();
    if (!penPositionInitializedRef.current) {
      setPenPosition(clampPenPosition(window.innerWidth - 76, 112));
      penPositionInitializedRef.current = true;
    }
    window.addEventListener("resize", redrawDoodles);
    // Capture phase so we also catch scrolling of inner scroll containers
    // (the app scrolls inside <main>, not the window).
    window.addEventListener("scroll", redrawDoodles, true);
    return () => {
      window.removeEventListener("resize", redrawDoodles);
      window.removeEventListener("scroll", redrawDoodles, true);
    };
  }, [redrawDoodles]);

  // Keep the floating pen inside the viewport when the window resizes or the
  // device rotates — otherwise a portrait position lingers and overlaps content
  // in landscape.
  useEffect(() => {
    const reclamp = () => setPenPosition((current) => clampPenPosition(current.x, current.y));
    window.addEventListener("resize", reclamp);
    window.addEventListener("orientationchange", reclamp);
    return () => {
      window.removeEventListener("resize", reclamp);
      window.removeEventListener("orientationchange", reclamp);
    };
  }, []);

  useEffect(() => {
    strokesByKeyRef.current[previousSurfaceKeyRef.current] = strokesRef.current;
    strokesRef.current = strokesByKeyRef.current[surfaceKey] ?? [];
    previousSurfaceKeyRef.current = surfaceKey;
    currentStrokeRef.current = null;
    setStrokeVersion((value) => value + 1);
    setPenActive(false);
    requestAnimationFrame(redrawDoodles);
  }, [redrawDoodles, surfaceKey]);

  useEffect(() => clearCanvas, [clearCanvas]);

  const canvasPointFromEvent = (event: PointerEvent<HTMLCanvasElement>): DrawPoint => {
    const offset = surfaceOffset();
    return {
      x: event.clientX - offset.x,
      y: event.clientY - offset.y
    };
  };

  const drawSegment = (from: DrawPoint, to: DrawPoint) => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const offset = surfaceOffset();
    const start = toScreen(from, offset);
    const end = toScreen(to, offset);
    configureCanvasContext(context);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  };

  const handleCanvasPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!penActive) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPointFromEvent(event);
    currentStrokeRef.current = [point];
    strokesRef.current.push(currentStrokeRef.current);
    strokesByKeyRef.current[surfaceKey] = strokesRef.current;
    setStrokeVersion((value) => value + 1);
  };

  const handleCanvasPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!penActive || !currentStrokeRef.current) return;
    event.preventDefault();
    const nextPoint = canvasPointFromEvent(event);
    const stroke = currentStrokeRef.current;
    const previousPoint = stroke[stroke.length - 1];
    stroke.push(nextPoint);
    strokesByKeyRef.current[surfaceKey] = strokesRef.current;
    drawSegment(previousPoint, nextPoint);
  };

  const finishCanvasStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    currentStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const startPenDrag = (clientX: number, clientY: number) => {
    penDragRef.current = {
      active: true,
      pointerId: -1,
      startX: clientX,
      startY: clientY,
      originX: penPosition.x,
      originY: penPosition.y,
      moved: false
    };
  };

  const updatePenDrag = (clientX: number, clientY: number) => {
    if (!penDragRef.current.active) return;
    const deltaX = clientX - penDragRef.current.startX;
    const deltaY = clientY - penDragRef.current.startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      penDragRef.current.moved = true;
    }
    setPenPosition(clampPenPosition(penDragRef.current.originX + deltaX, penDragRef.current.originY + deltaY));
  };

  const finishPenDrag = () => {
    if (!penDragRef.current.active) return;
    suppressNextClickRef.current = penDragRef.current.moved;
    penDragRef.current.active = false;
  };

  const togglePen = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setPenActive((value) => !value);
  };

  const undoLastStroke = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    strokesByKeyRef.current[surfaceKey] = strokesRef.current;
    currentStrokeRef.current = null;
    setStrokeVersion((value) => value + 1);
    redrawDoodles();
  };

  const handlePenPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    startPenDrag(event.clientX, event.clientY);
    penDragRef.current.pointerId = event.pointerId;
  };

  const handlePenPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!penDragRef.current.active || penDragRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    updatePenDrag(event.clientX, event.clientY);
  };

  const handlePenPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!penDragRef.current.active || penDragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishPenDrag();
  };

  // The canvas is portalled to <body> and kept at viewport size + fixed, so it is
  // always positioned relative to the viewport regardless of ancestor transforms,
  // and never exceeds platform canvas-size limits.
  const canvasLayer = (
    <canvas
      ref={canvasRef}
      className={`fixed inset-0 z-30 ${penActive ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"}`}
      style={{ touchAction: penActive ? "none" : "auto" }}
      aria-hidden="true"
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={finishCanvasStroke}
      onPointerCancel={finishCanvasStroke}
    />
  );

  const floatingControls = (
    <>
      <button
        type="button"
        onPointerDown={handlePenPointerDown}
        onPointerMove={handlePenPointerMove}
        onPointerUp={handlePenPointerUp}
        onPointerCancel={handlePenPointerUp}
        onClick={togglePen}
        className={`focus-ring fixed z-[9999] grid h-12 w-12 touch-none place-items-center rounded-2xl border shadow-xl backdrop-blur transition ${
          penActive
            ? "border-red-300/70 bg-red-500/28 text-red-50 shadow-red-500/20"
            : "border-white/20 bg-[#343838]/90 text-white/78 shadow-black/25"
        }`}
        style={{ left: penPosition.x, top: penPosition.y }}
        title={penActive ? "关闭批注笔" : "打开批注笔"}
        aria-label={penActive ? "关闭批注笔" : "打开批注笔"}
        aria-pressed={penActive}
      >
        <PencilLine size={20} />
      </button>
      {penActive && (
        <button
          type="button"
          onClick={undoLastStroke}
          disabled={!hasStrokes}
          className="focus-ring fixed z-[9999] grid h-10 w-10 place-items-center rounded-2xl border border-white/20 bg-[#343838]/90 text-white/78 shadow-xl backdrop-blur transition disabled:opacity-35"
          style={{ left: penPosition.x, top: penPosition.y + 54 }}
          title="撤回上一笔"
          aria-label="撤回上一笔"
        >
          <Undo2 size={17} />
        </button>
      )}
    </>
  );

  // Portal the canvas AND the controls together so they share one stacking
  // context on <body>. The controls' high z-index then reliably sits above the
  // canvas — otherwise the body-level canvas would cover the buttons and steal
  // their taps (turning "put the pen back" / "undo" into stray doodles).
  return createPortal(
    <>
      {canvasLayer}
      {floatingControls}
    </>,
    document.body
  );
}
