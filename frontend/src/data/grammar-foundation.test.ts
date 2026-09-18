import { describe, expect, it } from "vitest";
import { grammarPoints } from "./grammar";
import {
  FOUNDATION_SECTION_LABELS,
  grammarFoundationRules,
  grammarFoundationSections
} from "./grammar-foundation";
import { verbConjugationRules } from "./verb-conjugation-foundation";

describe("grammar foundation", () => {
  it("covers the six macro layers without duplicate rules", () => {
    expect(grammarFoundationRules).toHaveLength(43);
    expect(new Set(grammarFoundationRules.map((rule) => rule.id)).size).toBe(grammarFoundationRules.length);
    expect(new Set(grammarFoundationRules.map((rule) => rule.section))).toEqual(new Set(Object.keys(FOUNDATION_SECTION_LABELS)));
    expect(grammarFoundationSections).toHaveLength(Object.keys(FOUNDATION_SECTION_LABELS).length);
    ["N5", "N4"].forEach((level) => {
      expect(grammarFoundationRules.some((rule) => rule.level === level), level).toBe(true);
    });
  });

  it("links every framework rule to real grammar cards", () => {
    const grammarIds = new Set(grammarPoints.map((point) => point.id));
    grammarFoundationRules.forEach((rule) => {
      expect(["N5", "N4", "N3", "N2", "N1"]).toContain(rule.level);
      expect(rule.patterns.length, rule.id).toBeGreaterThan(0);
      expect(rule.checkpoints.length, rule.id).toBeGreaterThan(0);
      rule.relatedGrammarIds.forEach((grammarId) => {
        expect(grammarIds.has(grammarId), `${rule.id} -> ${grammarId}`).toBe(true);
      });
    });
  });

  it("explains verb conjugation with consistent, full-width tables", () => {
    const verbRule = grammarFoundationRules.find((rule) => rule.id === "verb-conjugation-system");
    expect(verbRule?.tables).toHaveLength(4);
    verbRule?.tables?.forEach((table) => {
      expect(table.headers.length, table.title).toBeGreaterThan(1);
      table.rows.forEach((row) => expect(row, table.title).toHaveLength(table.headers.length));
    });
    expect(grammarFoundationRules.flatMap((rule) => rule.patterns).some((pattern) => /\b[VSNA]\b/.test(pattern))).toBe(false);
  });

  it("gives every required verb form its own substantial entry", () => {
    const requiredIds = [
      "verb-form-dictionary",
      "verb-form-plain",
      "verb-form-terminal",
      "verb-form-attributive",
      "verb-form-masu",
      "verb-form-nai",
      "verb-form-te",
      "verb-form-ta",
      "verb-form-mizen",
      "verb-form-renyo",
      "verb-form-ba",
      "verb-form-tara",
      "verb-form-volitional",
      "verb-form-imperative",
      "verb-form-prohibitive",
      "verb-form-potential",
      "verb-form-passive",
      "verb-form-causative",
      "verb-form-causative-passive",
      "verb-form-tai",
      "verb-form-literary-negative",
      "verb-form-mai"
    ];

    expect(verbConjugationRules.map((rule) => rule.id)).toEqual(requiredIds);
    verbConjugationRules.forEach((rule) => {
      expect(rule.summary.length, rule.id).toBeGreaterThan(45);
      expect(rule.patterns.length, rule.id).toBeGreaterThanOrEqual(4);
      expect(rule.checkpoints.length, rule.id).toBeGreaterThanOrEqual(4);
      expect(rule.tables?.length, rule.id).toBeGreaterThan(0);
      rule.tables?.forEach((table) => {
        table.rows.forEach((row) => expect(row, `${rule.id}: ${table.title}`).toHaveLength(table.headers.length));
      });
    });
  });

  it("does not relabel concrete or advanced grammar families as foundations", () => {
    const retiredIds = [
      "cause-and-reason",
      "conditionals",
      "concession-and-contrast",
      "comparison-and-degree",
      "desire-intent-decision",
      "permission-and-obligation",
      "inference-and-evidence",
      "certainty-and-expectation",
      "evaluation-and-stance",
      "lexicalized-patterns"
    ];
    const ids = new Set(grammarFoundationRules.map((rule) => rule.id));
    retiredIds.forEach((id) => expect(ids.has(id), id).toBe(false));
    expect(grammarFoundationRules.some((rule) => /^n[12]-/.test(rule.id))).toBe(false);
  });
});
