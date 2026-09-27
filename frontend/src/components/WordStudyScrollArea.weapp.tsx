import { ScrollView, View } from "@tarojs/components";
import type { ReactNode } from "react";

export function WordStudyScrollArea({ className, centerContent = false, children }: { className: string; centerContent?: boolean; children: ReactNode }) {
  return <ScrollView scrollY enhanced showScrollbar={false} data-word-scrollable="true" className={`word-study-scroll-area ${className}`}>
    <View className={`word-study-scroll-area-content${centerContent ? " word-study-scroll-area-centered" : ""}`}>{children}</View>
  </ScrollView>;
}
