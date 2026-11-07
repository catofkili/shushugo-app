import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 执行生产 TSX 的真实手势回调，只替换 React setter / 提交边界；无需 DOM、数据库或复制一份手势实现。
const source = ts.createSourceFile("WordStudy.tsx", readFileSync(new URL("./WordStudy.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializer = (name: string) => {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`missing production callback: ${name}`);
  return found.getText(source);
};
const makeGesture = (motion: boolean, swiped = 120, axis = "x") => {
  const context = {
    gestureRef: { current: { axis } as { axis: string } | null },
    swipeXRef: { current: swiped }, dragStartYRef: { current: 0 }, swipeArmedRef: { current: 1 },
    flingTimerRef: { current: null as number | null }, submittingRef: { current: false }, swipeEnabled: true,
    setDragging: vi.fn(), setDragOffset: vi.fn(), setSwipeX: vi.fn(), setFlingDir: vi.fn(),
    submitAnswer: vi.fn(async () => {}), jsMotionAllowed: () => motion,
    SWIPE_COMMIT_PX: Number(initializer("SWIPE_COMMIT_PX")), SWIPE_FLING_MS: Number(initializer("SWIPE_FLING_MS")),
    window: globalThis
  };
  const compiled = ts.transpileModule(`const resetDrag = ${initializer("resetDrag")};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const reset = new Function(...Object.keys(context), `${compiled}; return resetDrag;`)(...Object.values(context)) as () => void;
  return { context, reset };
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("WordStudy 甩卡提交时机", () => {
  it.each(["off", "reduced"])("%s 不创建飞出定时器，当场交给原提交入口", () => {
    const { context, reset } = makeGesture(false);
    reset();
    expect(context.submitAnswer).toHaveBeenCalledExactlyOnceWith("know", "swipe");
    expect(vi.getTimerCount()).toBe(0);
    expect(context.setFlingDir).not.toHaveBeenCalledWith(1);
  });
  it("全开保持飞出方向，150ms 内提交；连着 touchend / cancel 不重复评分", () => {
    const { context, reset } = makeGesture(true, -120);
    reset();
    expect(context.setFlingDir).toHaveBeenCalledWith(-1);
    expect(context.submitAnswer).not.toHaveBeenCalled();
    context.gestureRef.current = { axis: "x" };
    context.swipeXRef.current = -140;
    reset();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(149);
    expect(context.submitAnswer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(context.submitAnswer).toHaveBeenCalledExactlyOnceWith("forgot", "swipe");
    expect(context.flingTimerRef.current).toBeNull();
    vi.advanceTimersByTime(240);
    expect(context.submitAnswer).toHaveBeenCalledOnce();
  });
  it("低于阈值、纵向手势或异步提交尚未完成时不评分", () => {
    for (const [distance, axis, submitting] of [[95, "x", false], [120, "y", false], [120, "x", true]] as const) {
      const { context, reset } = makeGesture(false, distance, axis);
      context.submittingRef.current = submitting;
      reset();
      expect(context.submitAnswer).not.toHaveBeenCalled();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["flinging", "submitting"])("%s 时撤销不能抢先换卡", async (phase) => {
    const flushPendingAnswer = vi.fn();
    const compiled = ts.transpileModule(`const undo = ${initializer("undo")};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const undo = new Function("flingTimerRef", "submittingRef", "dailyReviewRoundRef", "flushPendingAnswer", `${compiled}; return undo;`)(
      { current: phase === "flinging" ? 1 : null }, { current: phase === "submitting" }, { current: null }, flushPendingAnswer
    ) as () => Promise<void>;
    await undo();
    expect(flushPendingAnswer).not.toHaveBeenCalled();
  });
});
