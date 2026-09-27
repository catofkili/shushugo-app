import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

interface Props {
  className: string;
  style?: CSSProperties;
  contentClassName?: string;
  centerContent?: boolean;
  scrollTop?: number;
  scrollWithAnimation?: boolean;
  scrollToTopSignal?: number;
  onScroll?: (scrollTop: number) => void;
  onClick?: (event: { stopPropagation(): void }) => void;
  onPointerDown?: (event: { stopPropagation(): void }) => void;
  catchMove?: boolean;
  role?: string;
  "aria-modal"?: boolean | "true" | "false";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "data-grammar-point-id"?: string | number;
  "data-doodle-surface"?: string;
  inert?: boolean;
  children: ReactNode;
}

export function ScrollArea({ className, style, scrollTop, scrollWithAnimation, scrollToTopSignal, onScroll, onClick, onPointerDown, role, "aria-modal": ariaModal, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "data-grammar-point-id": grammarPointId, "data-doodle-surface": doodleSurface, inert, children }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const previousSignal = useRef(scrollToTopSignal);
  useLayoutEffect(() => {
    if (area.current && scrollTop !== undefined) {
      if (scrollWithAnimation) area.current.scrollTo({ top: scrollTop, behavior: "smooth" });
      else area.current.scrollTop = scrollTop;
    } else if (area.current && previousSignal.current !== scrollToTopSignal && scrollToTopSignal !== undefined) {
      area.current.scrollTo({ top: 0, behavior: "smooth" });
    }
    previousSignal.current = scrollToTopSignal;
  }, [scrollTop, scrollWithAnimation, scrollToTopSignal]);
  return <div ref={area} data-word-scrollable="true" data-grammar-point-id={grammarPointId} data-doodle-surface={doodleSurface} className={className} style={{ ...style, overflowY: "auto" }} onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)} onClick={onClick} onPointerDown={onPointerDown} role={role} aria-modal={ariaModal} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} inert={inert}>{children}</div>;
}
