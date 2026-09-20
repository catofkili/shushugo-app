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
  createConfusionTasks,
  gradeMatching,
  matchingCard,
  materializeConfusionCards,
  pickConfusionNext,
  recordConfusionReview,
  replayConfusionReviews
} from "./confusion-cards";
import { setConfusionMastered } from "./confusion-groups";
import { firstValue, rowsFor } from "./study-core";

describe("疑难连线卡", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
  });

  it("候选 = 能出题的组（有 major 辨析稿、题面齐），幂等", () => {
    const inserted = materializeConfusionCards();
    expect(inserted).toBeGreaterThan(200);
    expect(materializeConfusionCards()).toBe(0);
  });

  it("连线题：每对都有词形和题面，反面有辨析稿；不能出题的组返回 null", () => {
    const key = String(rowsFor("SELECT group_key FROM confusion_progress LIMIT 1")[0].group_key);
    const card = matchingCard(key)!;
    expect(card.pairs.length).toBeGreaterThanOrEqual(2);
    expect(card.pairs.every((pair) => pair.surface && pair.prompt)).toBe(true);
    expect(new Set(card.pairs.map((pair) => pair.prompt.split(/[；;]/)[0])).size).toBe(card.pairs.length);
    expect(card.summary.length).toBeGreaterThan(0);
    expect(matchingCard("homophone:根本不存在")).toBeNull();
  });

  it("评分：全对认识、错一模糊、错两忘记", () => {
    expect(gradeMatching(0)).toBe("know");
    expect(gradeMatching(1)).toBe("fuzzy");
    expect(gradeMatching(2)).toBe("forgot");
  });

  it("新学优先给成员学过的组；已掌握的组不进队列", () => {
    const some = String(rowsFor("SELECT group_key FROM confusion_progress LIMIT 1 OFFSET 5")[0].group_key);
    const card = matchingCard(some)!;
    card.pairs.forEach((pair) => {
      testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [pair.id]);
      testDb.run("UPDATE progress SET seen_count = 5 WHERE word_id = ?", [pair.id]);
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
    recordConfusionReview(first, gradeMatching(0));
    expect(confusionCardProgress().done).toBe(1);
    const second = pickConfusionNext()!;
    expect(second).not.toBe(first);
    recordConfusionReview(second, gradeMatching(2));
    expect(pickConfusionNext()).toBe(second);
    const before = rowsFor("SELECT group_key, seen_count, forgot_count, fsrs_due, fsrs_state FROM confusion_progress WHERE group_key IN (?, ?) ORDER BY group_key", [first, second]);
    testDb.run("UPDATE confusion_progress SET seen_count = 0, fsrs_due = NULL, fsrs_state = NULL WHERE group_key IN (?, ?)", [first, second]);
    expect(replayConfusionReviews([first, second])).toBe(2);
    expect(rowsFor("SELECT group_key, seen_count, forgot_count, fsrs_due, fsrs_state FROM confusion_progress WHERE group_key IN (?, ?) ORDER BY group_key", [first, second])).toEqual(before);
    expect(firstValue<number>("SELECT COUNT(*) FROM confusion_reviews", [], 0)).toBe(2);
  });
});
