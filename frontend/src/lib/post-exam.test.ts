import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key)
};
(globalThis as any).window = { dispatchEvent: () => true };

let testDb: Database;
vi.mock("./database", () => ({ getDatabase: () => testDb }));

import { ensureUserTables } from "./study-core";
import { setState } from "./database/db-utils";
import {
  choosePostExamIntensity,
  defaultStudyPreferences,
  getEffectiveStudyPreferences,
  isPostExamLightActive,
  postExamChoice,
  postExamRecovery,
  type StudyPreferences
} from "./studyPreferences";

const examPrefs = (): StudyPreferences => ({
  ...defaultStudyPreferences,
  dailyGoal: 24,
  grammarDailyGoal: 6,
  kanjiDailyGoal: 8,
  confusionDailyGoal: 7,
  reviewCap: -1,
  jlptPlanEnabled: true,
  planExamKind: "jlpt",
  jlptTarget: "N3",
  jlptExamDate: "2026-12-06",
  jlptPlanStartedOn: "2026-09-22"
});

describe("JLPT 考后轻量期", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    ensureUserTables();
  });

  beforeEach(() => {
    storage.set("mn-study-preferences", JSON.stringify(examPrefs()));
    setState("post_exam_choice", "");
  });

  it("从考试次日开始七天，第八天自动结束", () => {
    const prefs = examPrefs();
    expect(postExamRecovery(new Date(2026, 11, 6, 23), prefs)).toBeNull();
    expect(postExamRecovery(new Date(2026, 11, 7, 9), prefs)).toEqual({ key: "2026-12-06", target: "N3", daysLeft: 7 });
    expect(postExamRecovery(new Date(2026, 11, 13, 9), prefs)?.daysLeft).toBe(1);
    expect(postExamRecovery(new Date(2026, 11, 14, 9), prefs)).toBeNull();
    expect(postExamRecovery(new Date(2026, 11, 7, 9), { ...prefs, planExamKind: "eju" })).toBeNull();
  });

  it("保留平时额度，轻量期暂停新学并限制复习；选择原强度后立即恢复", () => {
    const light = getEffectiveStudyPreferences(new Date(2026, 11, 7, 9));
    expect([light.dailyGoal, light.grammarDailyGoal, light.kanjiDailyGoal, light.confusionDailyGoal]).toEqual([0, 0, 0, 0]);
    expect([light.reviewCap, light.grammarReviewCap, light.kanjiReviewCap, light.confusionReviewCap]).toEqual([60, 10, 10, 5]);
    expect(storage.get("mn-study-preferences")).toBe(JSON.stringify(examPrefs())); // 平时额度只存于偏好，不被恢复期改写

    choosePostExamIntensity("2026-12-06", "usual");
    expect(postExamChoice("2026-12-06")).toBe("usual");
    const usual = getEffectiveStudyPreferences(new Date(2026, 11, 7, 9));
    expect([usual.dailyGoal, usual.grammarDailyGoal, usual.reviewCap]).toEqual([24, 6, -1]);
    expect(isPostExamLightActive(new Date(2026, 11, 7, 9))).toBe(false);
  });

  it("选择新目标沿用同一考试日期的恢复期选择", () => {
    choosePostExamIntensity("2026-12-06", "light");
    const nextTarget = { ...examPrefs(), jlptTarget: "N2" as const };
    expect(postExamRecovery(new Date(2026, 11, 7, 9), nextTarget)?.key).toBe("2026-12-06");
    expect(postExamChoice(postExamRecovery(new Date(2026, 11, 7, 9), nextTarget)!.key)).toBe("light");
  });
});
