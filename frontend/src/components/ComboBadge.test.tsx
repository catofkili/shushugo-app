import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComboBadge } from "./ComboBadge";

describe("ComboBadge", () => {
  it.each([0, 1, 2])("%s 连对不渲染", combo => {
    expect(renderToStaticMarkup(<ComboBadge combo={combo} />)).toBe("");
  });
  it("3 连对显示数字和小火苗", () => {
    const html = renderToStaticMarkup(<ComboBadge combo={3} />);
    expect(html).toContain('combo-badge-number">3</span><span> 连对');
    expect(html).toContain("sf-lit sf-t1");
  });
  it.each([5, 10, 20])("%s 连对换 tier 2 并闪光晕", combo => {
    const html = renderToStaticMarkup(<ComboBadge combo={combo} />);
    expect(html).toContain("sf-lit sf-t2");
    expect(html).toContain("combo-badge-milestone");
  });
});
