import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { jsMotionAllowed } from "../lib/studyPreferences";

// 前 96 px 跟手，之后逐渐增加阻力，不能像旧版 110 px 上限那样突然卡死。
export const cordPullDistance = (distance: number) => distance <= 96 ? Math.max(0, distance) : 96 + 160 * Math.log1p((distance - 96) / 160);
export const cordPullOpens = (dx: number, dy: number) => dy >= 64 && dy > Math.abs(dx) * .8;

/** 绳索本身就是触点，不截获整张主页的滚动；点击和辅助技术也能打开。
 * 先展开与二楼同色的纸幕再交接路由，避免主页工具栏与报告生硬闪切。
 */
export function WeeklyReportEntrance({ unread, onOpen }: { unread: boolean; onOpen: (entry: "button" | "pull") => void }) {
  const [distance, setDistance] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState<"button" | "pull" | null>(null);
  const drag = useRef<{x:number;y:number;id:number} | null>(null);
  const suppressClick = useRef(false);
  const committed = useRef(false);
  const cancelDrag = useCallback(() => {
    if (!drag.current || committed.current) return;
    drag.current = null;
    suppressClick.current = true;
    setDragging(false);
    setDistance(0);
  }, []);
  const open = (entry: "button" | "pull") => {
    if (committed.current) return;
    committed.current = true;
    if (!jsMotionAllowed()) onOpen(entry);
    else setOpening(entry);
  };
  useEffect(() => {
    if (!opening) return;
    const timer = window.setTimeout(() => onOpen(opening), 620);
    return () => window.clearTimeout(timer);
  }, [opening, onOpen]);
  useEffect(() => {
    const cancelWhenHidden = () => { if (document.hidden) cancelDrag(); };
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("pagehide", cancelDrag);
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () => {
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("pagehide", cancelDrag);
      document.removeEventListener("visibilitychange", cancelWhenHidden);
    };
  }, [cancelDrag]);
  const end = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (!cancelled && cordPullOpens(event.clientX - start.x, event.clientY - start.y)) {
      // 从松手处接着展开，不能先把绳索和纸幕归零再播放开门。
      setDistance(Math.max(0, event.clientY - start.y));
      open("pull");
    } else setDistance(0);
  };
  const pull = cordPullDistance(distance);
  return <>
    <button type="button" className={`zoo-weekly-cord${unread ? " is-new" : ""}${opening ? " is-opening" : ""}${dragging ? " is-dragging" : ""}${distance >= 64 ? " is-ready" : ""}`} aria-label={unread ? "有新的学习回顾，向下拉动或点击打开" : "向下拉动或点击打开学习回顾"} aria-busy={!!opening} style={{"--cord-pull":`${pull}px`} as CSSProperties}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || committed.current) return;
        suppressClick.current = false;
        setDragging(true);
        drag.current = {x:event.clientX,y:event.clientY,id:event.pointerId};
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        if (event.buttons === 0) { cancelDrag(); return; }
        const dx = event.clientX-start.x, dy = event.clientY-start.y;
        if (Math.hypot(dx,dy)>8) suppressClick.current = true;
        setDistance(Math.max(0,dy));
      }}
      onPointerUp={event => end(event)} onPointerCancel={event => {suppressClick.current=true;end(event,true);}}
      onLostPointerCapture={event => { if (drag.current?.id === event.pointerId) cancelDrag(); }}
      onClick={event => { if (event.detail === 0 || !suppressClick.current) open("button"); }}>
      <span className="zoo-cord-thread" aria-hidden="true" />
      <span className="zoo-cord-leaf" aria-hidden="true"><i/><b/></span>
      {unread && <span className="zoo-cord-light" aria-hidden="true"/>}
    </button>
    {createPortal(<div className={`wr-entrance-veil${opening ? " is-opening" : ""}${dragging ? " is-dragging" : ""}`} style={{"--curtain-peek":`${pull * .7}px`} as CSSProperties} aria-hidden="true"><span>日</span><i/><b/></div>, document.body)}
  </>;
}
