import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpellingInline, { shouldInlineSpelling } from "./SpellingInline";
import type { SpellingCard, SpellingRound } from "../../lib/spelling";

const mocks = vi.hoisted(() => ({ record: vi.fn(), mark: vi.fn(), seed: vi.fn(() => true),
  eligible: vi.fn(() => 1), choose: vi.fn(() => "audio"), available: vi.fn(() => ["meaning", "audio"]),
  card: vi.fn(), props: null as Record<string, any> | null }));
vi.mock("../../lib/spelling", async () => {
  const prefs = await import("../../lib/spelling/prefs");
  const inline = await import("../../lib/spelling/inline");
  return { ...inline, getSpellingPrefs: () => ({ ...prefs.DEFAULT_SPELLING_PREFS, inlineAfterGraduation: true }),
    spellingCard: mocks.card, chooseSpellingMode: mocks.choose, availableSpellingModes: mocks.available,
    spellingLookup: () => ({}), checkCardInput: vi.fn(), markAskedToday: mocks.mark,
    recordSpellingRound: mocks.record,
    lastEncounterToday: () => true, spellingInlineToday: () => 0, spellingDoneToday: () => 0,
    askedToday: () => false, seedSpellingCardFor: mocks.seed };
});
vi.mock("../../lib/study-core", () => ({ firstValue: mocks.eligible, today: () => "2026-10-03" }));
vi.mock("../../lib/studyPreferences", () => ({ getStudyPreferences: () => ({ autoPlay: false, voiceId: "" }) }));
vi.mock("./SpellingCardView", () => ({ SpellingCardView: (props: Record<string, any>) => {
  mocks.props = props; return <div>拼写卡</div>;
} }));

const card: SpellingCard = { wordId: 7, mode: "audio", meaning: "吃", pos: "动词", moraCount: 3, jlptLevel: "N5",
  target: { kana: "たべる", surface: "食べる", forms: [], altReadings: [], isLoanword: false } };
const round = (grade: SpellingRound["grade"], typed = "taberu"): SpellingRound => ({ typed, verdict: null, hintsUsed: 0, grade, elapsedMs: 300 });
beforeEach(() => { vi.clearAllMocks(); mocks.card.mockReturnValue(card); mocks.eligible.mockReturnValue(1); mocks.seed.mockReturnValue(true); });

describe("插播结算与原学习流程隔离", () => {
  it("按注入的题面选择函数出卡；选了档位写 inline 流水，换卡回调只关闭插播", () => {
    const close = vi.fn(); renderToStaticMarkup(<SpellingInline wordId={7} onClose={close} />);
    expect(mocks.card).toHaveBeenCalledWith(7, "audio");
    expect(mocks.choose).toHaveBeenCalledWith(7, expect.objectContaining({ modes: ["meaning"] }), ["meaning", "audio"]);
    const chosen = round("fuzzy");
    mocks.props!.onFinish(chosen);
    expect(mocks.record).toHaveBeenCalledWith(7, chosen, "inline");
    expect(mocks.mark).toHaveBeenCalledWith(7);
    expect(close).not.toHaveBeenCalled();
    mocks.props!.onNext();
    expect(close).toHaveBeenCalledOnce();
  });
  it("已有卡也必须通过当前正向资格，失败不调用播种", async () => {
    const { DEFAULT_SPELLING_PREFS } = await import("../../lib/spelling/prefs");
    const prefs = { ...DEFAULT_SPELLING_PREFS, inlineAfterGraduation: true, minStabilityDays: 21 };
    mocks.eligible.mockReturnValue(0); expect(shouldInlineSpelling(7, prefs)).toBe(false); expect(mocks.seed).not.toHaveBeenCalled();
    mocks.eligible.mockReturnValue(1); expect(shouldInlineSpelling(7, prefs)).toBe(true);
    expect(mocks.seed).toHaveBeenCalledWith(7, { minStabilityDays: 21 });
  });
});
