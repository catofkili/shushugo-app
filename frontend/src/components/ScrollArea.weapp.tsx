import { ScrollView, View } from "@tarojs/components";
import type { CSSProperties, ReactNode } from "react";

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

export function ScrollArea({ className, style, contentClassName = "", centerContent = false, scrollTop, scrollWithAnimation, scrollToTopSignal, onScroll, onClick, onPointerDown, catchMove, role, "aria-modal": ariaModal, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "data-grammar-point-id": grammarPointId, "data-doodle-surface": doodleSurface, inert, children }: Props) {
  return <ScrollView key={scrollToTopSignal} scrollY enhanced showScrollbar={false} data-word-scrollable="true" data-grammar-point-id={grammarPointId} data-doodle-surface={doodleSurface} scrollTop={scrollTop} scrollWithAnimation={scrollWithAnimation} onScroll={(event) => onScroll?.(event.detail.scrollTop)} onClick={onClick} onTouchStart={onPointerDown} catchMove={catchMove} role={role} aria-modal={ariaModal} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} inert={inert} style={style} className={`scroll-area ${className}`}>
    <View className={`scroll-area-content${centerContent ? " scroll-area-centered" : ""} ${contentClassName}`}>{children}</View>
  </ScrollView>;
}
