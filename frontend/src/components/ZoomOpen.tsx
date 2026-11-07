import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { jsMotionAllowed } from "../lib/studyPreferences";
import { Sticker, type StickerName } from "./CapybaraMascot";
import "./ZoomOpen.css";

type Zoom = { x: number; y: number; go: () => void; art?: StickerName };

export function useZoomOpen() {
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const busy = useRef(false);
  const timer = useRef<number | null>(null);
  const pending = useRef<Zoom | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    pending.current = null;
    busy.current = false;
  }, []);

  const finish = useCallback(() => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    try { next.go(); }
    finally {
      setZoom(null);
      busy.current = false;
    }
  }, []);

  const open = useCallback((event: Pick<MouseEvent, "clientX" | "clientY"> | ReactMouseEvent<Element>, go: () => void, art?: StickerName, prefetch?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    prefetch?.();
    const next = { x: event.clientX, y: event.clientY, go, art };
    pending.current = next;
    const animate = jsMotionAllowed() && Capacitor.getPlatform() !== "wechat";
    if (animate) setZoom(next);
    // CSS 被停用或 animationend 丢失也必须放行；0 ms 仍挡住同一 tick 的连点。
    timer.current = window.setTimeout(finish, animate ? 300 : 0);
  }, [finish]);

  const overlay = zoom && typeof document !== "undefined"
    ? createPortal(
      <div className="zoom-open-blocker" aria-hidden="true">
        <div
          className="zoom-open"
          style={{ "--zoom-x": `${zoom.x}px`, "--zoom-y": `${zoom.y}px` } as CSSProperties}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && event.animationName === "zoom-open-expand") finish();
          }}
        >
          {zoom.art && <Sticker name={zoom.art} size={52} className="zoom-open-art" />}
        </div>
      </div>,
      document.body
    )
    : null;

  return { open, overlay };
}
