import { useEffect, useState, type ReactNode } from "react";

export interface DisclosureProps {
  className?: string;
  summaryClassName?: string;
  weappSummaryClassName?: string;
  weappSummary?: ReactNode | ((open: boolean) => ReactNode);
  summary: ReactNode | ((open: boolean) => ReactNode);
  children: ReactNode;
  forceOpen?: boolean;
  defaultOpen?: boolean;
  indicator?: "triangle" | "none";
}

export function Disclosure({ className, summaryClassName, summary, children, forceOpen, defaultOpen = false }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={summaryClassName}>{typeof summary === "function" ? summary(open) : summary}</summary>
      {children}
    </details>
  );
}
