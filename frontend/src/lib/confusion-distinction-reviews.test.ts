import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import {
  confusionGroups,
  displayForm,
  resetConfusionGroups,
  type ConfusionType
} from "./confusion-groups";
import { distinctionNotesFor, distinctionReviewFor, distinctionReviewMap } from "../data/confusion_distinction_reviews";

const HANDWRITTEN_TYPES: readonly ConfusionType[] = [
  "pair",
  "kanji-choice",
  "reading-register",
  "stem",
  "synonym"
];

describe("辨析人工稿覆盖率", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
    )));
    resetConfusionGroups();
  });

  it("所有需要写区别的运行时分组都有稳定人工稿，且没有幽灵 key", () => {
    const groups = confusionGroups();
    const handwritten = groups.filter((group) => HANDWRITTEN_TYPES.includes(group.type));
    const groupKeys = new Set(groups.map((group) => group.key));
    const missing = handwritten
      .filter((group) => !distinctionReviewFor(group.key))
      .map((group) => group.key);
    const extra = [...distinctionReviewMap.keys()].filter((key) => !groupKeys.has(key));

    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
    expect(distinctionReviewMap.size).toBe(handwritten.length);
    [...distinctionReviewMap.values()].forEach((review) => {
      expect(review.summary.trim().length).toBeGreaterThan(0);
      expect(["interchangeable", "major"]).toContain(review.level);
    });
  });

  it("同音、同表记异读和音形相近没有被硬塞人工区别", () => {
    const forbiddenPrefixes = ["homophone:", "reading-sense:"];
    expect([...distinctionReviewMap.keys()].some((key) =>
      forbiddenPrefixes.some((prefix) => key.startsWith(prefix))
    )).toBe(false);
  });

  it("把同一句里的多个词条差异拆回各自卡片", () => {
    const review = distinctionReviewFor("stem:押");
    expect(review).not.toBeNull();
    const notes = distinctionNotesFor(review!.summary, [
      { key: "push", forms: ["押す"] },
      { key: "hold", forms: ["押さえる"] },
      { key: "insert", forms: ["押し込む"] },
      { key: "out", forms: ["押し出す"] },
      { key: "through", forms: ["押し切る"] },
      { key: "away", forms: ["押しやる"] },
      { key: "confine", forms: ["押し込める"] }
    ]);

    expect(notes.get("push")).toBe("按、推");
    expect(notes.get("hold")).toBe("按住或控制");
    expect(notes.get("insert")).toBe("塞入");
  });

  it("每个不能互换的词都有自己的卡内说明", () => {
    const missing = confusionGroups().flatMap((group) => {
      const review = distinctionReviewFor(group.key);
      if (review?.level !== "major") return [];
      const notes = distinctionNotesFor(review.summary, group.members.map((member) => ({
        key: String(member.id),
        forms: [displayForm(member), member.kanji, member.kana]
      })));
      return group.members
        .filter((member) => !notes.has(String(member.id)))
        .map((member) => `${group.key} -> ${displayForm(member)}`);
    });

    expect(missing).toEqual([]);
  });
});
