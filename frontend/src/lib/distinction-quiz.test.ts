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

import { confusionGroups, masteredConfusionKeys, resetConfusionGroups } from "./confusion-groups";
import { ensureUserTables } from "./study-core";
import { reviewedQuestionMeaning } from "./models/question-meaning-overrides";
import { buildQuestions, quizGroups, settleGroup } from "./distinction-quiz";

describe("辨析题", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
    )));
    ensureUserTables();
    resetConfusionGroups();
  });

  it("每题只有一个答案且同组题面互不相同", () => {
    const groups = quizGroups({ kind: "type", type: "pair" });
    const questions = buildQuestions(groups, () => 0.25);
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.options.filter((option) => option.id === question.answerId)).toHaveLength(1);
      const member = groups.flatMap((group) => group.members).find((item) => item.id === question.answerId);
      expect(question.prompt).toBe(reviewedQuestionMeaning(member!.kanji, member!.kana));
    }
    for (const group of groups) {
      const prompts = questions.filter((question) => question.groupKey === group.key).map((question) => question.prompt);
      expect(new Set(prompts).size).toBe(prompts.length);
    }
  });

  it("同表记异读组的选项靠假名分开", () => {
    const groups = quizGroups({ kind: "type", type: "reading-register" });
    expect(groups.length).toBeGreaterThan(0);
    for (const question of buildQuestions(groups, () => 0.5)) {
      const kanas = question.options.map((option) => option.kana);
      expect(new Set(kanas).size).toBe(kanas.length);
    }
  });

  it("没有题面的组不会进入练习范围", () => {
    expect(quizGroups({ kind: "group", key: "pair:not-a-real-group" })).toEqual([]);
  });

  it("结算只改 confusion_mastered，不写 reviews", () => {
    const group = quizGroups({ kind: "type", type: "pair" })[0];
    const before = Number(testDb.exec("SELECT COUNT(*) FROM reviews")[0]?.values[0]?.[0] ?? 0);
    settleGroup(group.key, true);
    expect(masteredConfusionKeys()).toContain(group.key);
    settleGroup(group.key, false);
    expect(masteredConfusionKeys()).not.toContain(group.key);
    const after = Number(testDb.exec("SELECT COUNT(*) FROM reviews")[0]?.values[0]?.[0] ?? 0);
    expect(after).toBe(before);
  });

  it("练习上限不截断一组", () => {
    const groups = confusionGroups().filter((group) => group.members.length >= 2).slice(0, 20);
    const questions = buildQuestions(groups, () => 0.25);
    expect(questions.length).toBeLessThanOrEqual(24);
    for (let index = 0; index < questions.length; ) {
      const key = questions[index].groupKey;
      const count = questions.filter((question) => question.groupKey === key).length;
      expect(count).toBe(groups.find((group) => group.key === key)?.members.length ?? 0);
      index += count;
    }
  });

  it("已学范围不把仅有自报起点的辨析词算成真实学过", () => {
    const group = quizGroups({ kind: "type", type: "pair" })[0];
    for (const member of group.members) {
      testDb.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [member.id]);
      testDb.run("UPDATE progress SET seen_count=1 WHERE word_id=?", [member.id]);
      testDb.run(`INSERT INTO level_prior_baselines
        (entity,entity_key,stability,due,last_review,starting_level,familiarity)
        VALUES ('words',?,30,'2026-10-01','2026-09-01','N4',75)`, [String(member.id)]);
    }
    expect(quizGroups({ kind: "learned" }).some((item) => item.key === group.key)).toBe(false);
    for (const member of group.members) {
      testDb.run("INSERT INTO reviews (word_id,answer,score_after,reviewed_on,direction) VALUES (?,'know',1,'2026-09-23','forward')", [member.id]);
    }
    expect(quizGroups({ kind: "learned" }).some((item) => item.key === group.key)).toBe(true);
  });
});
