import { describe, expect, it } from "vitest";
import { CAPY_TOOL_ICONS, pickCapyTools } from "./capy-tool-selection";

describe("pickCapyTools", () => {
  it.each([0, 1, 2])("chooses exactly %i unique tools", (count) => {
    let first = true;
    const selected = pickCapyTools(() => {
      if (first) {
        first = false;
        return (count + 0.5) / 3;
      }
      return 0;
    });
    expect(CAPY_TOOL_ICONS).toHaveLength(11);
    expect(new Set(CAPY_TOOL_ICONS).size).toBe(11);
    expect(selected.size).toBe(count);
    expect([...selected].every((icon) => CAPY_TOOL_ICONS.includes(icon))).toBe(true);
  });
});
