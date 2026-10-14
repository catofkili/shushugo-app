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

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const open = useCallback((event: Pick<MouseEvent, "clientX" | "clientY"> | ReactMouseEvent<Element>, go: () => void, art?: StickerName) => {
    if (busy.current) return;
    busy.current = true;
    if (!jsMotionAllowed() || Capacitor.getPlatform() === "wechat") {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        try { go(); }
        finally { busy.current = false; }
      }, 300);
      return;
    }
    setZoom({ x: event.clientX, y: event.clientY, go, art });
  }, []);

  const finish = useCallback(() => {
    if (!zoom) return;
    try { zoom.go(); }
    finally {
      setZoom(null);
      busy.current = false;
    }
  }, [zoom]);

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
