import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { confusionGroups, displayForm, resetConfusionGroups, type ConfusionType } from "./confusion-groups";
import { distinctionNotesFor, distinctionReviewFor } from "../data/confusion_distinction_reviews";
import { reviewedQuestionMeaning } from "./models/question-meaning-overrides";

const loadFactoryDb = async () => {
  const SQL = await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(
    fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
  )));
  resetConfusionGroups();
};

describe.skipIf(!process.env.CANDIDATES_OUT)("导出辨析组题面候选", () => {
  it("写出每组成员的现状", async () => {
    await loadFactoryDb();
    const exportGroups = (predicate: (type: ConfusionType) => boolean) => confusionGroups().filter((group) => predicate(group.type)).flatMap((group) => {
      const review = distinctionReviewFor(group.key);
      if (!review) return [];
      const notes = distinctionNotesFor(review.summary, group.members.map((member) => ({
        key: String(member.id), forms: [displayForm(member), member.kanji, member.kana]
      })));
      return [{
        groupKey: group.key,
        type: group.type,
        level: review.level,
        summary: review.summary,
        members: group.members.map((member) => ({
          id: member.id,
          kanji: member.kanji,
          kana: member.kana,
          surface: displayForm(member),
          jlpt: member.jlptLevel,
          meaning: member.meaning,
          note: notes.get(String(member.id)) ?? "",
          reviewedQuestionMeaning: reviewedQuestionMeaning(member.kanji, member.kana) ?? null,
          exampleJp: member.exampleJp,
          exampleMeaning: member.exampleMeaning
        }))
      }];
    });
    const out = exportGroups((type) => type !== "synonym");
    writeFileSync(process.env.CANDIDATES_OUT!, JSON.stringify(out, null, 2));
    expect(out.length).toBeGreaterThan(300);
    // synonym 组（814 组，有人工稿）第一轮没做，单独一份清单：形状同上。
    const synonym = exportGroups((type) => type === "synonym");
    writeFileSync(process.env.CANDIDATES_OUT!.replace(/\.json$/, "-synonym.json"), JSON.stringify(synonym, null, 2));
    expect(synonym.length).toBeGreaterThan(700);
  });

  // 第二轮（覆盖）：没有人工稿的组（同音 / 近义 / 一形多读）里还没精修题面的成员。
  // 这些组没有 summary，靠同组其它成员的题面和例句去分 —— 所以整组都导，
  // 已精修的成员带着 reviewedQuestionMeaning 一起给，缺的那些才是要写的。
  it("写出无人工稿组里缺题面的成员", async () => {
    await loadFactoryDb();
    const out = confusionGroups().flatMap((group) => {
      if (distinctionReviewFor(group.key)) return [];
      const members = group.members.map((member) => ({
        id: member.id,
        kanji: member.kanji,
        kana: member.kana,
        surface: displayForm(member),
        jlpt: member.jlptLevel,
        meaning: member.meaning,
        reviewedQuestionMeaning: reviewedQuestionMeaning(member.kanji, member.kana) ?? null,
        exampleJp: member.exampleJp,
        exampleMeaning: member.exampleMeaning
      }));
      if (members.every((member) => member.reviewedQuestionMeaning)) return [];
      return [{ groupKey: group.key, type: group.type, label: group.label, members }];
    });
    writeFileSync(process.env.CANDIDATES_OUT!.replace(/\.json$/, "-unreviewed.json"), JSON.stringify(out, null, 2));
    // 这是工单，空了才是做完了（第二轮 2026-09-16 起为空）。
    expect(out.length).toBeGreaterThanOrEqual(0);
  });
});

describe("人工辨析组题面回归", () => {
  beforeAll(loadFactoryDb);

  it("人工辨析组的每个成员题面首义互不相同（可互换组除外）", () => {
    const firstSense = (text: string) => text.split(/[；;]/)[0].trim();
    const bad: string[] = [];
    confusionGroups().forEach((group) => {
      const review = distinctionReviewFor(group.key);
      if (!review || review.level !== "major") return;
      const seen = new Map<string, string>();
      group.members.forEach((member) => {
        const questionMeaning = reviewedQuestionMeaning(member.kanji, member.kana);
        if (!questionMeaning) {
          bad.push(`${group.key}: ${displayForm(member)} 没有题面`);
          return;
        }
        const sense = firstSense(questionMeaning);
        if (seen.has(sense)) {
          bad.push(`${group.key}: ${displayForm(member)} 与 ${seen.get(sense)} 首义都是「${sense}」`);
        }
        seen.set(sense, displayForm(member));
      });
    });
    expect(bad).toEqual([]);
  });
});
