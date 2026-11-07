import { afterEach, expect, it, vi } from "vitest";
import { afterPaint } from "./after-paint";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("计算必须等 rAF 结束后再让出一个任务，卸载能取消", () => {
  vi.useFakeTimers();
  let frame: FrameRequestCallback = () => undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  const cancelFrame = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  const compute = vi.fn();
  const cancel = afterPaint(compute);
  expect(compute).not.toHaveBeenCalled();
  frame(16);
  expect(compute).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(compute).toHaveBeenCalledTimes(1);
  const cancelNext = afterPaint(compute);
  frame(32);
  cancelNext();
  vi.runAllTimers();
  expect(compute).toHaveBeenCalledTimes(1);
  cancel();
  expect(cancelFrame).toHaveBeenCalledWith(1);
});
