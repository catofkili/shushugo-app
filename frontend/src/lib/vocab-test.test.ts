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
  getVocabTestHistory,
  getVocabTestResult,
  getVocabTestSession,
  guessRate,
  kanjiCoreReading,
  recordVocabTestRun,
  startVocabTest,
  submitVocabTestAnswer,
  VOCAB_TEST_PROBE_PER_LEVEL,
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

describe("读音题只问看不见的那部分", () => {
  it("拆得出汉字段就只问汉字那几拍", () => {
    expect(kanjiCoreReading("培う", "つちかう")).toEqual({ core: "培", reading: "つちか" });
    expect(kanjiCoreReading("お金", "おかね")).toEqual({ core: "金", reading: "かね" });
    expect(kanjiCoreReading("食べる", "たべる")).toEqual({ core: "食", reading: "た" });
  });

  it("汉字中间夹假名的拆不出来（整段词组同理）", () => {
    expect(kanjiCoreReading("手が離せない", "てがはなせない")).toBeNull();
    expect(kanjiCoreReading("引き起こす", "ひきおこす")).toBeNull();
    // 纯汉字词本来就没有送假名，走整词读音那条路
    expect(kanjiCoreReading("経済", "けいざい")).toBeNull();
  });

  /**
   * ⚠️ 三种「不认识也能选对」的题，判据要一次挡掉（都是实测报上来的）：
   *  培う —— 题面那个 う 排掉不以 う 结尾的选项 → 改成只问 培（つちか）
   *  手にかける —— 汉字部分只有 て（1/6 拍），考的是「手读て」不是这个词 → 改出释义题
   *  手が離せない —— 手・が・せない 全露着 → 改出释义题
   */
  it("汉字占比太小或夹着假名的词改出释义题", () => {
    const rows: VocabTestWordRow[] = [
      ...sampleRows(),
      { id: 9001, kanji: "培う", kana: "つちかう", meaning: "培养", level: "N1", pos: "动词" },
      { id: 9002, kanji: "手にかける", kana: "てにかける", meaning: "亲手照料", level: "N3", pos: "动词" },
      { id: 9003, kanji: "手が離せない", kana: "てがはなせない", meaning: "抽不开身", level: "N2", pos: "惯用语" }
    ];
    rows.forEach((row) => testDb.run(
      "INSERT OR IGNORE INTO words (id, kanji, kana, meaning, jlpt_level, pos) VALUES (?, ?, ?, ?, ?, ?)",
      [row.id, row.kanji, row.kana, row.meaning, row.level, row.pos ?? ""]
    ));
    const questions = buildVocabTestQuestions(rows, () => 0.3).questions;
    const byId = new Map(questions.map((question) => [question.id, question]));

    const cultivate = byId.get(9001);
    if (cultivate) {
      expect(cultivate.kind).toBe("reading");
      expect(cultivate.answer).toBe("つちか");
      expect(cultivate.readingScope).toBe("培");
      // 送假名不能出现在任何选项里，否则题面那个「う」又成了排除线索
      cultivate.options.forEach((option) => expect(option.endsWith("う")).toBe(false));
    }
    expect(byId.get(9002)?.kind ?? "meaning").toBe("meaning");
    expect(byId.get(9003)?.kind ?? "meaning").toBe("meaning");
  });
});

describe("自适应出题", () => {
  /**
   * ⚠️ 「先摸底、再往说不准的那一带压题」是这个测验的核心：
   * 一个 N5/N4 全会、N1 全不会的人，把题继续均摊到那两带就是纯浪费 ——
   * 他的词汇量落在哪，取决于 N3/N2 答对多少。
   */
  it("摸底之后把剩下的题压到「说不准」的那一带", () => {
    // 每级 30 个词：题不够时分配再聪明也压不下去，得让供给不是瓶颈
    ["N5", "N4", "N3", "N2", "N1"].forEach((level, levelIndex) => {
      for (let index = 0; index < 30; index += 1) {
        const id = 20000 + levelIndex * 100 + index;
        testDb.run(
          "INSERT OR IGNORE INTO words (id, kanji, kana, meaning, jlpt_level, pos) VALUES (?, ?, ?, ?, ?, '名词')",
          [id, `${level}語${index}`, `${level.toLowerCase()}ご${index}`, `${level} 释义 ${index}`, level]
        );
      }
    });
    startVocabTest(() => 0.3);
    const probe = getVocabTestSession()!;
    expect(probe.questions.length).toBe(VOCAB_TEST_PROBE_PER_LEVEL * 5);
    expect(probe.plannedTotal).toBe(60);

    // 摸底：N5/N4 全对，N1 全错，N3/N2 一半
    for (let index = 0; index < probe.questions.length; index += 1) {
      const session = getVocabTestSession()!;
      const question = session.questions[session.currentIndex];
      const known = question.level === "N5" || question.level === "N4"
        || ((question.level === "N3" || question.level === "N2") && index % 2 === 0);
      submitVocabTestAnswer(known ? "correct" : "unknown", known ? question.answerIndex : null, 800);
    }

    const extended = getVocabTestSession()!;
    expect(extended.questions.length).toBeGreaterThan(probe.questions.length);
    const added = extended.questions.slice(probe.questions.length);
    const countOf = (level: string) => added.filter((question) => question.level === level).length;
    // 已经判明的两带拿到的题最少
    expect(countOf("N5")).toBeLessThan(countOf("N3"));
    expect(countOf("N4")).toBeLessThan(countOf("N2"));
    // 每一带都还得有题：最终估计是 Σ(该级词数 × 该级答对率)，某一带一题没有就只能靠假设填
    ["N5", "N4", "N3", "N2", "N1"].forEach((level) => {
      expect(extended.questions.filter((question) => question.level === level).length).toBeGreaterThan(0);
    });
  });
});

describe("历史成绩", () => {
  it("按 run_id 幂等：同一次测验记两遍只有一行", () => {
    const session = startVocabTest(() => 0.35);
    submitVocabTestAnswer("correct", session.questions[0].answerIndex, 1200);
    const finished = finishVocabTest();

    recordVocabTestRun(finished);
    recordVocabTestRun(finished);

    const history = getVocabTestHistory();
    expect(history).toHaveLength(1);
    expect(history[0].runId).toBe(finished?.runId);
    expect(history[0].answered).toBe(1);
    // 这一场原本要出 60 题（分母是计划题数，不是「已经出好的那 20 道」）
    expect(history[0].totalQuestions).toBe(finished?.plannedTotal);
  });

  // ⚠️ 用时 = 真正花在答题上的秒数，不是墙上时间。实测出过「2 题 · 用时 4160 分 36 秒」：
  // 中途切走、隔天回来接着答，全被算成了「用时」。
  it("用时按每题时限封顶，切走的那段不算", () => {
    startVocabTest(() => 0.25);
    submitVocabTestAnswer("correct", 0, 3_000);
    submitVocabTestAnswer("wrong", 1, 60 * 60 * 1000);   // 切走一小时后才点
    const finished = finishVocabTest();
    recordVocabTestRun(finished);

    const [row] = getVocabTestHistory();
    expect(row.answered).toBe(2);
    // 3 秒 + 封顶（读音题 15 秒 / 释义题 10 秒），无论如何不该是几千分钟
    expect(row.durationSeconds).toBeLessThanOrEqual(3 + 15);
    expect(row.durationSeconds).toBeGreaterThanOrEqual(3);
  });

  // 打开看了一眼就退出去，不该在历史里留一条「0 题」的记录
  it("一题没答的会话不进历史", () => {
    startVocabTest(() => 0.45);
    recordVocabTestRun(finishVocabTest());
    expect(getVocabTestHistory().filter((row) => row.answered === 0)).toEqual([]);
  });
});
