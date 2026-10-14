import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AnswerFeedbackBar } from "./AnswerFeedbackBar";
import { playKnow, playDontKnow } from "../lib/zoo-sounds";
import { triggerMemoryHaptic } from "../lib/haptics";

// 仓库没有 DOM 测试依赖：保留真实 JSX/服务端渲染，单独执行挂载 effect 和事件。
const harness = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, sounds: true }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); }
}));
// 反馈条挂到 body（createPortal）；这里没有 DOM，原地渲染
vi.mock("react-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-dom")>(), createPortal: (node: unknown) => node }));
vi.mock("../lib/zoo-sounds", () => ({ playKnow: vi.fn(), playDontKnow: vi.fn() }));
vi.mock("../lib/haptics", () => ({ triggerMemoryHaptic: vi.fn() }));
vi.mock("../lib/studyPreferences", () => ({ getStudyPreferences: () => ({ zooSounds: harness.sounds }) }));

const props = { correct: true, answer: "あした", combo: 3, onContinue: vi.fn() };
let onKey: (event: Partial<KeyboardEvent>) => void;
let cleanups: Array<() => void>;
beforeEach(() => {
  vi.clearAllMocks();
  harness.effects = [];
  harness.sounds = true;
  cleanups = [];
  vi.stubGlobal("document", { body: {} });
  vi.stubGlobal("window", { addEventListener: vi.fn((_event, listener) => { onKey = listener; }), removeEventListener: vi.fn() });
});
afterEach(() => { cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });
const mount = (correct = true) => {
  const tree = AnswerFeedbackBar({ ...props, correct });
  harness.effects.forEach(effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
  return tree;
};

function button(node: ReactElement<any>): ReactElement<any> | undefined {
  if (node.type === "button") return node;
  const children = [node.props.children].flat();
  for (const child of children) {
    if (child && typeof child === "object") { const found = button(child); if (found) return found; }
  }
}

describe("AnswerFeedbackBar", () => {
  it("答对显示稳定轮换的鼓励与主色继续按钮", () => {
    const html = renderToStaticMarkup(<AnswerFeedbackBar {...props} questionNumber={1} />);
    expect(html).toContain("漂亮");
    expect(html).toContain("answer-feedback-primary");
    expect(html).toContain('stroke="#FFFFFF"');
    expect(html).toContain("继续");
    expect(html).not.toContain("あした");
  });
  it("答错显示正确答案与琥珀按钮", () => {
    const html = renderToStaticMarkup(<AnswerFeedbackBar {...props} correct={false} />);
    expect(html).toContain("正确答案");
    expect(html).toContain("あした");
    expect(html).toContain("answer-feedback-amber");
    expect(html).toContain('stroke="#FFFFFF"');
  });
  it("点击继续只调用一次", () => {
    const tree = mount();
    button(tree)!.props.onClick();
    button(tree)!.props.onClick();
    expect(props.onContinue).toHaveBeenCalledTimes(1);
  });
  it.each(["Enter", " "])("键盘 %s 可以继续且阻止重复提交", key => {
    mount();
    const preventDefault = vi.fn();
    onKey({ key, preventDefault });
    onKey({ key, preventDefault });
    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });
  it("答对播连对音效与认识触觉，StrictMode 重跑不重复", () => {
    mount();
    harness.effects[0]();
    expect(playKnow).toHaveBeenCalledExactlyOnceWith(3);
    expect(playDontKnow).not.toHaveBeenCalled();
    expect(triggerMemoryHaptic).toHaveBeenCalledExactlyOnceWith("know");
  });
  it("答错播柔和答错音与忘记触觉", () => {
    mount(false);
    expect(playDontKnow).toHaveBeenCalledTimes(1);
    expect(playKnow).not.toHaveBeenCalled();
    expect(triggerMemoryHaptic).toHaveBeenCalledWith("forgot");
  });
  it("关闭答题音效时仍有触觉", () => {
    harness.sounds = false;
    mount();
    expect(playKnow).not.toHaveBeenCalled();
    expect(triggerMemoryHaptic).toHaveBeenCalled();
  });
});
