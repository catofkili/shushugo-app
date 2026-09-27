import type { ReactNode } from "react";

export function WordStudyScrollArea({ className, children }: { className: string; centerContent?: boolean; children: ReactNode }) {
  return <div data-word-scrollable="true" className={className}>{children}</div>;
}
