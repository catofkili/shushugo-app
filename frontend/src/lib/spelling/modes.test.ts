import { vi, describe, expect, it } from "vitest";

const db = vi.hoisted(() => ({
  row: [] as Array<Record<string, unknown>>,
  calls: 0
}));

vi.mock("../database/db-utils", () => ({
  rowsFor: () => {
    db.calls += 1;
    return db.row;
  }
}));

import { availableSpellingModes, chooseSpellingMode } from "./modes";
import type { SpellingMode } from "./types";

describe("拼写题面形式", () => {
  it("默认开放意思和听写；挖空能力按 wordId 缓存", () => {
    db.row = [{
      id: 901001, kanji: "学校", kana: "がっこう", example_jp: "学校。", example_meaning: "学校。",
      example_furigana: JSON.stringify([[0, 2, "がっこう"]]), example_tokens: "2,1", example_lemmas: ""
    }];
    const first = availableSpellingModes(901001);
    db.row = [];
    const second = availableSpellingModes(901001);
    expect(first).toEqual(["meaning", "audio", "cloze"]);
    expect(second).toEqual(first);
    expect(db.calls).toBe(1);

    expect(availableSpellingModes(901002)).toEqual(["meaning", "audio"]);
    expect(db.calls).toBe(2);
  });

  it("rotate 稳定按词 id 选；random 使用传入随机源", () => {
    const modes: SpellingMode[] = ["meaning", "audio", "cloze"];
    const rotate = { modes, modeStrategy: "rotate" as const };
    expect([0, 1, 2, 3, 4].map((id) => chooseSpellingMode(id, rotate, modes)))
      .toEqual(["meaning", "audio", "cloze", "meaning", "audio"]);
    expect(chooseSpellingMode(1, { modes, modeStrategy: "random" }, modes, () => 0.8)).toBe("cloze");
  });

  it("只选偏好列表里的形式；所选形式不可用时退回 meaning", () => {
    const rotate = { modes: ["audio", "cloze"] as SpellingMode[], modeStrategy: "rotate" as const };
    expect(chooseSpellingMode(0, rotate, ["meaning", "audio"])).toBe("audio");
    expect(chooseSpellingMode(1, rotate, ["meaning", "audio"])).toBe("meaning");
    expect(chooseSpellingMode(1, { modes: [], modeStrategy: "random" }, ["audio"])).toBe("meaning");
  });
});
