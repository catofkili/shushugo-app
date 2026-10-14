import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanjiChoiceItems } from "./KanjiChoiceItems";
import type { KanjiChoiceQuestion } from "../../lib/kanji-choice";
import { playKnow, playDontKnow } from "../../lib/zoo-sounds";

const harness = vi.hoisted(() => ({ visit: {} as object, revision: 0, effect: (() => {}) as () => void }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  // 服务端重渲染丢弃旧 effect；只执行本次最后一次渲染的挂载反馈。
  useEffect: (effect: () => void) => { harness.effect = effect; }
}));
vi.mock("../../app/AppContext", () => ({ useApp: () => ({ state: { pageHistory: harness.visit, wordStudyRevision: harness.revision } }) }));
vi.mock("../../components/ComboBadge", () => ({ ComboBadge: ({ combo }: { combo: number }) => <span>{combo} 连对</span> }));
vi.mock("../../lib/studyPreferences", () => ({ getStudyPreferences: () => ({ zooSounds: true }) }));
vi.mock("../../lib/haptics", () => ({ triggerMemoryHaptic: vi.fn() }));
vi.mock("../../lib/zoo-sounds", () => ({ playKnow: vi.fn(), playDontKnow: vi.fn() }));
const question: KanjiChoiceQuestion = { items: [0, 1].map(wordId => ({
  wordId, word: "山道", start: 0, length: 1, kana: "やまみち", meaning: "山路", answer: "やま", base: "やま", variant: "base", options: ["やま", "さん"]
})) };
const show = (choices: Record<number, string>, revealed = true) => {
  const html = renderToStaticMarkup(<KanjiChoiceItems char="山" question={question} choices={choices} activeItem={0} revealed={revealed} onSelect={() => {}} />);
  harness.effect();
  return html;
};
beforeEach(() => { harness.visit = {}; harness.revision = 0; vi.clearAllMocks(); });
describe("KanjiChoiceItems feedback", () => {
  it("只在核对时判分，换卡卸载后仍累计连对", () => {
    expect(show({ 0: "やま" }, false)).toContain("0 连对");
    expect(playKnow).not.toHaveBeenCalled();
    expect(show({ 0: "やま", 1: "やま" })).toContain("1 连对");
    expect(show({ 0: "やま", 1: "やま" })).toContain("2 连对");
    expect(show({ 0: "やま", 1: "やま" })).toContain("3 连对");
  });
  it("错答安静断连，不改原有选择和自评回调", () => {
    show({ 0: "やま", 1: "やま" });
    expect(show({ 0: "やま", 1: "さん" })).toContain("0 连对");
    expect(playDontKnow).toHaveBeenCalledTimes(1);
  });
  it("退出再进或重开学习时重新累计", () => {
    show({ 0: "やま", 1: "やま" });
    harness.revision += 1;
    expect(show({ 0: "やま", 1: "やま" })).toContain("1 连对");
    harness.visit = {};
    expect(show({ 0: "やま", 1: "やま" })).toContain("1 连对");
  });
});
