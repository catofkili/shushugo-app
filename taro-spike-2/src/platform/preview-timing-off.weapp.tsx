import type { ReactNode } from 'react';

export default function PreviewTimingBoundary({ children }: { kind: 'study' | 'vocab'; children: ReactNode }) {
  return <>{children}</>;
}
