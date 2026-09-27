import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import type { DisclosureProps } from "./Disclosure";

export function Disclosure({
  className,
  summaryClassName,
  weappSummaryClassName,
  weappSummary,
  summary,
  children,
  forceOpen,
  defaultOpen = false,
  indicator = "triangle"
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const summaryContent = typeof weappSummary === "function"
    ? weappSummary(open)
    : weappSummary ?? (typeof summary === "function" ? summary(open) : summary);
  const summaryClasses = [weappSummaryClassName, summaryClassName, indicator === "none" ? "" : "disclosure-summary"]
    .filter(Boolean)
    .join(" ");

  return (
    <View className={`${className ?? ""}${open ? " is-open" : ""}`}>
      <View
        className={summaryClasses}
        role="button"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {summaryContent}
        {indicator === "triangle" && <Text className="disclosure-summary-indicator">{open ? "▴" : "▾"}</Text>}
      </View>
      {/* Taro's View template drops the native hidden prop, so hide through the generated CSS utility. */}
      <View className={open ? "" : "hidden"}>{children}</View>
    </View>
  );
}
