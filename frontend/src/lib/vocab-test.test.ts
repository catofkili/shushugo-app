import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));

import {
  buildVocabTestQuestions,
  finishVocabTest,
  getVocabTestResult,
  getVocabTestSession,
  guessRate,
  startVocabTest,
  submitVocabTestAnswer,
  type VocabTestWordRow
} from "./vocab-test";

const levels = ["N5", "N4", "N3", "N2", "N1"];

const sampleRows = (): VocabTestWordRow[] => levels.flatMap((level) => Array.from({ length: 8 }, (_, index) => ({
  id: levels.indexOf(level) * 100 + index + 1,
  kanji: `${level}漢字${index}`,
  kana: `${level.toLowerCase()}かな${index}`,
  meaning: `${level} meaning ${index}`,
  level
})));

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  testDb = new SQL.Database();
  testDb.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  testDb.run("CREATE TABLE words (id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, meaning TEXT, jlpt_level TEXT, pos TEXT)");
  testDb.run("CREATE TABLE reviews (id INTEGER PRIMARY KEY, word_id INTEGER, answer TEXT, score_after REAL, reviewed_on TEXT)");
  sampleRows().forEach((row) => {
    testDb.run("INSERT INTO words (id, kanji, kana, meaning, jlpt_level) VALUES (?, ?, ?, ?, ?)", [row.id, row.kanji, row.kana, row.meaning, row.level]);
  });
});

describe("词汇量测验题库", () => {
  it("五个等级都抽到题，读音题和释义题的选项各自唯一", () => {
    const { questions, populationByLevel } = buildVocabTestQuestions(sampleRows(), () => 0.25);
    expect(questions.length).toBe(40);
    expect(populationByLevel).toEqual({ N5: 8, N4: 8, N3: 8, N2: 8, N1: 8 });
    expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
    expect(new Set(questions.map((question) => question.level))).toEqual(new Set(levels));
    questions.forEach((question) => {
      // 1 个正确 + 3 个干扰。加上界面上的「不认识」才是五个按钮
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.options[question.answerIndex]).toBe(question.answer);
    });
  });
});

describe("词汇量测验会话", () => {
  it("逐题落盘、可结束，且不写学习流水", () => {
    const session = startVocabTest(() => 0.1);
    expect(session.currentIndex).toBe(0);
    const current = session.questions[0];
    const next = submitVocabTestAnswer("correct", current.answerIndex, 1200);
    expect(next?.responses).toHaveLength(1);
    expect(next?.currentIndex).toBe(1);
    expect(getVocabTestSession()?.responses[0].answerState).toBe("correct");

    const finished = finishVocabTest();
    expect(finished?.finishedAt).toEqual(expect.any(Number));
    const result = getVocabTestResult(finished);
    expect(result?.answered).toBe(1);
    expect(result?.population).toBe(40);
    expect(Number(testDb.exec("SELECT COUNT(*) FROM reviews")[0]?.values?.[0]?.[0] ?? 0)).toBe(0);
  });

  it("不认识和错误分别进入测量统计", () => {
    const session = startVocabTest(() => 0.2);
    const first = session.questions[0];
    submitVocabTestAnswer("wrong", (first.answerIndex + 1) % 4, 1000);
    const second = getVocabTestSession()!.questions[1];
    submitVocabTestAnswer("unknown", null, 500);
    const result = getVocabTestResult(getVocabTestSession());
    expect(result?.answered).toBe(2);
    expect(result?.levels.reduce((sum, level) => sum + level.wrong, 0)).toBe(1);
    expect(result?.levels.reduce((sum, level) => sum + level.unknown, 0)).toBe(1);
    expect(second).toBeDefined();
  });
});

describe("⚠️ 计分的无偏性", () => {
  /**
   * 这条钉住的是 DISTRACTOR_COUNT(3) 和 levelResult 里 `wrong / 3` 的一致性 ——
   * 惩罚必须是 1/(实义选项数 − 1)。曾经出过 4 个干扰配 `/3` 的版本，
   * 纯猜的人期望得分变成 −0.067 而不是 0，而 clamp(0,1) 把负数截掉、看不出来。
   */
  it("纯靠猜的人（四选一里四分之一蒙对）估计词汇量为 0", () => {
    startVocabTest(() => 0.3);
    const perLevel: Record<string, number> = {};
    for (;;) {
      const session = getVocabTestSession();
      const question = session?.questions[session.currentIndex];
      if (!session || !question) break;
      const seen = perLevel[question.level] ?? 0;
      perLevel[question.level] = seen + 1;
      const guessedRight = seen % 4 === 0;
      submitVocabTestAnswer(
        guessedRight ? "correct" : "wrong",
        guessedRight ? question.answerIndex : (question.answerIndex + 1) % 4,
        900
      );
    }
    const result = getVocabTestResult(finishVocabTest());
    expect(result?.answered).toBe(40);
    result?.levels.forEach((level) => expect(level.rate).toBe(0));
    expect(result?.estimated).toBe(0);
  });

  it("全会的人拿满分", () => {
    startVocabTest(() => 0.4);
    for (;;) {
      const session = getVocabTestSession();
      const question = session?.questions[session.currentIndex];
      if (!session || !question) break;
      submitVocabTestAnswer("correct", question.answerIndex, 800);
    }
    const result = getVocabTestResult(finishVocabTest());
    expect(result?.estimated).toBe(result?.population);
    expect(result?.gamma).toBe(0);
  });
});

describe("⚠️ 可信度不能给乱答的人高分", () => {
  it("纯随机乱答满场，可信度落到 0", () => {
    startVocabTest(() => 0.55);
    const perLevel: Record<string, number> = {};
    for (;;) {
      const session = getVocabTestSession();
      const question = session?.questions[session.currentIndex];
      if (!session || !question) break;
      const seen = perLevel[question.level] ?? 0;
      perLevel[question.level] = seen + 1;
      const guessedRight = seen % 4 === 0;
      submitVocabTestAnswer(
        guessedRight ? "correct" : "wrong",
        guessedRight ? question.answerIndex : (question.answerIndex + 1) % 4,
        900
      );
    }
    const result = getVocabTestResult(finishVocabTest());
    // 蒙满全场：(4/3)·(30/40) = 1 → 折扣把整个分数抹掉
    expect(result?.guessedShare).toBe(1);
    expect(result?.confidence).toBe(0);
  });

  it("答满全场且从不乱猜的人拿高分", () => {
    startVocabTest(() => 0.65);
    for (;;) {
      const session = getVocabTestSession();
      const question = session?.questions[session.currentIndex];
      if (!session || !question) break;
      submitVocabTestAnswer("correct", question.answerIndex, 800);
    }
    const result = getVocabTestResult(finishVocabTest());
    expect(result?.guessedShare).toBe(0);
    expect(result?.confidence).toBeGreaterThan(90);
  });
});

describe("⚠️ γ 量的是「不会还猜」，不是「答错」", () => {
  it("不会就点不认识的人 γ = 0，从不点不认识的人 γ = 1", () => {
    expect(guessRate(0, 10)).toBe(0);
    expect(guessRate(10, 0)).toBe(1);
    expect(guessRate(0, 0)).toBe(0);
  });

  it("认真作答、只是答错几题的人不该被算成在乱猜", () => {
    // 答错 1、点了 9 次不认识：旧写法 W/(C+W) 会给 0.33，实际他几乎没在猜
    expect(guessRate(1, 9)).toBeLessThan(0.2);
    // 反过来：一题不认识都没点、错了一半，那就是在猜
    expect(guessRate(9, 0)).toBe(1);
  });
});

describe("⚠️ 干扰项要挑近的", () => {
  const near: VocabTestWordRow[] = [
    { id: 1, kanji: "付属", kana: "ふぞく", meaning: "附属", level: "N2", pos: "名词" },
    { id: 2, kanji: "感知", kana: "かんち", meaning: "感知", level: "N2", pos: "名词" },
    { id: 3, kanji: "祝辞", kana: "しゅくじ", meaning: "贺词", level: "N2", pos: "名词" },
    { id: 4, kanji: "現場", kana: "げんば", meaning: "现场", level: "N2", pos: "名词" },
    { id: 5, kanji: "読み返す", kana: "よみかえす", meaning: "重读", level: "N2", pos: "动词" },
    { id: 6, kanji: "", kana: "どれぐらい", meaning: "多少", level: "N2", pos: "副词" },
    { id: 7, kanji: "coach", kana: "コーチ", meaning: "教练", level: "N2", pos: "名词" }
  ];

  it("读音题的干扰项同词性、同表记类型、拍数差不超过 1", () => {
    const { questions } = buildVocabTestQuestions(near, () => 0.37);
    const target = questions.find((question) => question.id === 1);
    expect(target?.kind).toBe("reading");
    const distractors = (target?.options ?? []).filter((option) => option !== "ふぞく");
    expect(distractors).toHaveLength(3);
    // 和語動詞 / 副詞 / 外来語 一个都不该混进来 —— 那些不用认识「付属」就能排除
    expect(distractors).not.toContain("よみかえす");
    expect(distractors).not.toContain("どれぐらい");
    expect(distractors).not.toContain("コーチ");
    distractors.forEach((option) => expect(["かんち", "しゅくじ", "げんば"]).toContain(option));
  });
});
