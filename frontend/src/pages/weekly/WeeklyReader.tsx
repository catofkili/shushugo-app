import { forwardRef, type ComponentPropsWithoutRef } from "react";

export type WeeklyReaderProps = ComponentPropsWithoutRef<"section"> & { resetKey: string; onTurn: (delta: number) => void };

/** Web keeps its original section; the Mini Program supplies a native scroller. */
export const WeeklyReader = forwardRef<HTMLElement, WeeklyReaderProps>(function WeeklyReader({ resetKey, onTurn, ...props }, ref) {
  void resetKey;
  void onTurn;
  return <section {...props} ref={ref} />;
});
