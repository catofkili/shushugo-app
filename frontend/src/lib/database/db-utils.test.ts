import { describe, expect, it } from "vitest";
import { studyDate } from "./db-utils";

describe("studyDate", () => {
  it("uses the previous local day before 4am", () => {
    expect(studyDate(new Date(2026, 5, 19, 3, 59))).toBe("2026-06-18");
  });

  it("uses the current local day from 4am onward", () => {
    expect(studyDate(new Date(2026, 5, 19, 4, 0))).toBe("2026-06-19");
  });

  it("handles month boundaries in local time", () => {
    expect(studyDate(new Date(2026, 2, 1, 2, 0))).toBe("2026-02-28");
  });
});
