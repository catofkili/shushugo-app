import { describe, expect, it } from "vitest";
import { normalizeGrammarLevel, saveGrammarLevelPreference } from "./grammarPreferences";

describe("grammar level preference", () => {
  it("只接受全部或五个 JLPT 等级", () => {
    expect(normalizeGrammarLevel("N3")).toBe("N3");
    expect(normalizeGrammarLevel("something-else")).toBe("N5");
  });

  it("存储不可用时仍返回本次选择", () => {
    expect(saveGrammarLevelPreference("N2")).toBe("N2");
  });
});
