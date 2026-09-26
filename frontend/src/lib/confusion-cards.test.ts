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
  confusionCardPool,
  confusionCardProgress,
  clearConfusionTasks,
  createConfusionTasks,
  matchingCard,
  materializeConfusionCards,
  matchable,
  pickConfusionNext,
  recordConfusionReview,
  replayConfusionReviews
} from "./confusion-cards";
import { confusionGroups, displayForm, setConfusionMastered } from "./confusion-groups";
import { firstValue, rowsFor } from "./study-core";
import { distinctionReviewFor } from "../data/confusion_distinction_reviews";

describe("疑难辨析 Anki 卡", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
  });

  it("候选 = 有人工辨析稿的组，幂等", () => {
    const inserted = materializeConfusionCards();
    expect(inserted).toBeGreaterThan(0);
    expect(materializeConfusionCards()).toBe(0);
  });

  it("只把人工审校为不可互换的非同义组放进 Anki 队列", () => {
    const groups = confusionGroups();
    const eligible = groups.filter(matchable);
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every((group) => group.type !== "synonym" && distinctionReviewFor(group.key)?.level === "major")).toBe(true);
    expect(groups.filter((group) => group.type === "synonym" || distinctionReviewFor(group.key)?.level === "interchangeable").every((group) => !matchable(group))).toBe(true);
    expect(eligible.every((group) => new Set(group.members.map((member) => `${displayForm(member)}\u0000${member.kana}`)).size === group.members.length)).toBe(true);
  });

  it("旧版本遗留的不可辨析组到期状态不进入复习池或当天清单", () => {
    materializeConfusionCards();
    const legacy = confusionGroups().find((group) => !matchable(group))!;
    testDb.run("INSERT OR IGNORE INTO confusion_progress (group_key) VALUES (?)", [legacy.key]);
    testDb.run("UPDATE confusion_progress SET seen_count = 1, fsrs_due = ?, fsrs_state = 2 WHERE group_key = ?", ["2000-01-01T00:00:00.000Z", legacy.key]);
    const dueBefore = confusionCardPool().due;
    clearConfusionTasks();
    createConfusionTasks({ fresh: 0, review: 100 });
    expect(confusionCardPool().due).toBe(dueBefore);
    expect(rowsFor("SELECT group_key FROM confusion_tasks").map((row) => String(row.group_key))).not.toContain(legacy.key);
  });

  it("卡片包含整组词形和手写辨析；没有辨析稿的组不生成卡", () => {
    const key = String(rowsFor("SELECT group_key FROM confusion_progress LIMIT 1")[0].group_key);
    const card = matchingCard(key)!;
    expect(card.members.length).toBeGreaterThanOrEqual(2);
    expect(card.members.every((member) => member.surface && member.kana)).toBe(true);
    expect(card.summary.length).toBeGreaterThan(0);
    expect(matchingCard("homophone:根本不存在")).toBeNull();
  });

  it("止系列用主体、对象和句型提示区别", () => {
    const card = matchingCard("stem:止")!;
    const noteFor = (kana: string) => card.members.find((member) => member.kana === kana)?.note ?? "";

    expect(card.overview).toContain("停下者作主体");
    expect(noteFor("とまる")).toContain("「が」");
    expect(noteFor("とめる")).toContain("受影响对象");
    expect(noteFor("とめる")).toContain("「を」");
    expect(noteFor("やむ")).toContain("雨、风");
    expect(noteFor("やめる")).toContain("「〜のをやめる」");
  });

  it("新学优先给成员学过的组；已掌握的组不进队列", () => {
    const some = String(rowsFor("SELECT group_key FROM confusion_progress LIMIT 1 OFFSET 5")[0].group_key);
    const card = matchingCard(some)!;
    card.members.forEach((member) => {
      testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [member.id]);
      testDb.run("UPDATE progress SET seen_count = 5 WHERE word_id = ?", [member.id]);
    });
    const mastered = String(rowsFor("SELECT group_key FROM confusion_progress LIMIT 1 OFFSET 6")[0].group_key);
    setConfusionMastered(mastered, true);
    expect(createConfusionTasks({ fresh: 3, review: 5 })).toEqual({ fresh: 3, review: 0 });
    const tasks = rowsFor("SELECT group_key FROM confusion_tasks ORDER BY order_index").map((row) => String(row.group_key));
    expect(tasks[0]).toBe(some);
    expect(tasks).not.toContain(mastered);
    expect(confusionCardPool().unseen).toBeGreaterThan(3);
  });

  it("作答进 FSRS 与流水，重放能原样重建", () => {
    const first = pickConfusionNext()!;
    recordConfusionReview(first, "know");
    expect(confusionCardProgress().done).toBe(1);
    const second = pickConfusionNext()!;
    expect(second).not.toBe(first);
    recordConfusionReview(second, "forgot");
    expect(pickConfusionNext()).toBe(second);
    const before = rowsFor("SELECT group_key, seen_count, forgot_count, fsrs_due, fsrs_state FROM confusion_progress WHERE group_key IN (?, ?) ORDER BY group_key", [first, second]);
    testDb.run("UPDATE confusion_progress SET seen_count = 0, fsrs_due = NULL, fsrs_state = NULL WHERE group_key IN (?, ?)", [first, second]);
    expect(replayConfusionReviews([first, second])).toBe(2);
    expect(rowsFor("SELECT group_key, seen_count, forgot_count, fsrs_due, fsrs_state FROM confusion_progress WHERE group_key IN (?, ?) ORDER BY group_key", [first, second])).toEqual(before);
    expect(firstValue<number>("SELECT COUNT(*) FROM confusion_reviews", [], 0)).toBe(2);
  });
});
