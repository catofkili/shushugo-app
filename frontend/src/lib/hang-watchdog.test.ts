import { describe, expect, it } from "vitest";
import { detectHang } from "./hang-watchdog";

describe("hang watchdog classifier", () => {
  it("ignores 60 seconds spent in the background", () => {
    expect(detectHang(0, 60_000, [
      { at: 1_000, visible: false },
      { at: 60_000, visible: true }
    ])).toBeNull();
  });

  it("reports a visible stall at eight seconds and ignores shorter pauses", () => {
    expect(detectHang(0, 7_999)).toBeNull();
    expect(detectHang(0, 8_000)).toEqual({ durationMs: 8_000 });
  });

  it("ignores the first interval just after returning to the foreground", () => {
    expect(detectHang(0, 6_000, [{ at: 1_000, visible: true }])).toBeNull();
  });

  it("keeps the ten-second foreground grace across a short first heartbeat", () => {
    expect(detectHang(6_000, 12_000, [{ at: 5_000, visible: true }])).toBeNull();
  });
});
