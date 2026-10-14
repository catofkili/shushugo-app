import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/studyPreferences", () => ({ jsMotionAllowed: () => false }));

import { countUpValue, useCountUp } from "./useCountUp";

function CountUpProbe({ target }: { target: number }) {
  return <span>{useCountUp(target)}</span>;
}

describe("useCountUp", () => {
  it("缓动结束时准确落在新目标", () => {
    expect(countUpValue(14, 52, 1)).toBe(52);
    expect(countUpValue(52, 14, 1)).toBe(14);
  });

  it("减少动效时首帧直接显示终值", () => {
    expect(renderToStaticMarkup(<CountUpProbe target={52} />)).toBe("<span>52</span>");
  });
});
