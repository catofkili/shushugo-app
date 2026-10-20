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
vi.mock("./storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));

import {
  buildVocabTestQuestions,
  PENALTY,
  GUESS_FLOOR_CAP,
  CONFIDENCE_BONUS,
  calibrateLevelsV3,
  type VocabTestSession,
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

// 真人回放固定原始计数；历史中已舍入的 rate 不能冒充逐题作答。
const todayCounts = [[7, 0, 7], [7, 0, 8], [12, 1, 14], [9, 1, 24], [9, 2, 27]];
const replaySession = (counts = todayCounts): VocabTestSession => {
  const questions = counts.flatMap(([, , answered], band) => Array.from({ length: answered }, () => ({
    id: band, level: levels[band], kind: "reading" as const, prompt: "詞",
    options: ["し", "じ", "ち", "に"], answerIndex: 0, answer: "し"
  })));
  let questionIndex = 0;
  const responses = counts.flatMap(([correct, wrong, answered]) => Array.from({ length: answered }, (_, i) => ({
    questionIndex: questionIndex++, questionId: 0,
    answerState: i < correct ? "correct" as const : i < correct + wrong ? "wrong" as const : "unknown" as const,
    selectedOption: null, responseMs: 1000, answeredAt: 1
  })));
  return { version: 1, scoreVersion: 3, runId: "replay-2026-10-20", startedAt: 0, finishedAt: 80000,
    currentIndex: responses.length, questions, responses, plannedTotal: 80,
    populationByLevel: { N5: 888, N4: 873, N3: 2096, N2: 3606, N1: 4215 } };
};

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
   * 新版惩罚比随机猜测的无偏值更严；纯随机作答仍会被 clamp 到 0，不能得到正估计。
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

  it("新场次保留答对得分、答错罚分，再校准和奖励", () => {
    const session = startVocabTest(() => 0.3);
    const firstLevel = session.questions[0].level;
    const questions = session.questions.map((question, index) => ({ question, index }))
      .filter(({ question }) => question.level === firstLevel);
    const responses = questions.map(({ question, index }, number) => ({
      questionIndex: index,
      questionId: question.id,
      answerState: number < 3 ? "correct" as const : "wrong" as const,
      selectedOption: number < 3 ? question.answerIndex : (question.answerIndex + 1) % 4,
      responseMs: 900,
      answeredAt: 0
    }));
    const result = getVocabTestResult({ ...session, responses });
    expect(session.scoreVersion).toBe(3);
    expect(result?.levels.find((level) => level.level === firstLevel)?.rate).toBe(0.51);
  });

  it("旧场次仍用 −1/3，不会升级后变成新分数", () => {
    const session = startVocabTest(() => 0.3);
    const firstLevel = session.questions[0].level;
    const questions = session.questions.map((question, index) => ({ question, index }))
      .filter(({ question }) => question.level === firstLevel);
    const responses = questions.map(({ question, index }, number) => ({
      questionIndex: index,
      questionId: question.id,
      answerState: number < 3 ? "correct" as const : "wrong" as const,
      selectedOption: number < 3 ? question.answerIndex : (question.answerIndex + 1) % 4,
      responseMs: 900,
      answeredAt: 0
    }));
    expect(getVocabTestResult({ ...session, scoreVersion: 1, responses })?.levels.find((level) => level.level === firstLevel)?.rate).toBe(0.67);
    expect(getVocabTestResult({ ...session, scoreVersion: 2, responses })?.levels.find((level) => level.level === firstLevel)?.rate).toBe(0.46);
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
    // 小词表里没有同汉字读音候选时，允许同拍数近音合成，仍不能含答案。
    distractors.forEach((option) => {
      expect(option).toMatch(/^[ぁ-ん]+$/);
      expect(Math.abs(option.length - target!.answer.length)).toBeLessThanOrEqual(1);
      expect(option.includes(target!.answer) || target!.answer.includes(option)).toBe(false);
    });
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
    expect(probe.plannedTotal).toBe(80);

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
    expect(history[0].scoreVersion).toBe(3);
    // 这一场原本要出 80 题（分母是计划题数，不是「已经出好的那 20 道」）
    expect(history[0].totalQuestions).toBe(finished?.plannedTotal);
  });

  it.each([1, 2] as const)("v%s 旧会话与历史保留旧计分标记", (scoreVersion) => {
    const started = startVocabTest(() => 0.35);
    const oldSession = { ...started, scoreVersion, plannedTotal: 60, runId: `old-vocab-test-${scoreVersion}` };
    testDb.run("UPDATE app_state SET value = ? WHERE key = 'vocab_test_session_v1'", [JSON.stringify(oldSession)]);
    const first = getVocabTestSession()!.questions[0];
    submitVocabTestAnswer("correct", first.answerIndex, 1000);
    const finished = finishVocabTest();
    expect(getVocabTestResult(finished)?.scoreVersion).toBe(scoreVersion);
    recordVocabTestRun(finished);
    expect(getVocabTestHistory()[0].scoreVersion).toBe(scoreVersion);
    expect(getVocabTestHistory()[0].totalQuestions).toBe(60); // 未完成旧会话仍保留历史题数
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


describe("v3 自校准与兼容性", () => {
  it.each([
    { old: 6199, rates: [1, 1, 0.82, 0.38, 0.32], counts: [7, 6, 11, 18, 18],
      population: [888, 873, 2096, 3606, 4215], estimated: 4075 },
    { old: 4779, rates: [1, 1, 0.83, 0.19, 0.13], counts: [7, 7, 12, 16, 18],
      population: [888, 876, 2144, 3617, 4215], estimated: 3962 }
  ])("旧场 $old 用历史 rate/词数参考回放，不能编造原始对错数", ({ old, rates, counts, population, estimated }) => {
    const raw = getVocabTestResult({ ...replaySession(), scoreVersion: 2 })!.levels
      .map((b, i) => ({ ...b, rate: rates[i], answered: counts[i], total: population[i] }));
    expect(Math.round(raw.reduce((sum, b) => sum + b.total * b.rate, 0))).toBe(old);
    const result = calibrateLevelsV3(raw);
    expect(Math.round(result.levels.reduce((sum, b) => sum + b.total * b.rate!, 0))).toBe(estimated);
  });

  it("同一份原始作答的 v1/v2 估计、区间及推荐完全保留", () => {
    const session = replaySession();
    const v1 = getVocabTestResult({ ...session, scoreVersion: 1 })!;
    const v2 = getVocabTestResult({ ...session, scoreVersion: 2 })!;
    expect(v1.levels.map((b) => b.rate)).toEqual([1, 0.88, 0.83, 0.36, 0.31]);
    expect(v2.levels.map((b) => b.rate)).toEqual([1, 0.88, 0.78, 0.33, 0.25]);
    expect([v1.estimated, v1.lower, v1.upper, v1.recommendation]).toEqual([6001, 4822, 7180, "N2"]);
    expect([v2.estimated, v2.lower, v2.upper, v2.recommendation]).toEqual([5535, 4060, 7010, "N2"]);
  });

  it("今天 5697 那场回放为 3600–3800，底噪来自最难带，推荐 N2，区间放大", () => {
    const session = replaySession();
    const raw = getVocabTestResult({ ...session, scoreVersion: 2 })!;
    const calibrated = calibrateLevelsV3(raw.levels);
    expect((9 - 2 * PENALTY) / 27).toBeCloseTo(0.248148);
    // 保留原始带 rate 的既有两位小数口径，0.248148 在这里为 0.25。
    expect(calibrated.floor).toBe(raw.levels[4].rate);
    expect(calibrated.floor).toBe(0.25);
    const result = getVocabTestResult(session)!;
    expect(result.levels.map((b) => b.rate)).toEqual([1, 0.92, 0.78, 0.12, 0]);
    expect(result.levels).toEqual(calibrated.levels);
    expect(result.estimated).toBe(3759);
    expect(result.estimated).toBeGreaterThanOrEqual(3600);
    expect(result.estimated).toBeLessThanOrEqual(3800);
    expect(result.recommendation).toBe("N2");
    expect(result.upper - result.estimated).toBeGreaterThanOrEqual(raw.upper - raw.estimated);
    recordVocabTestRun(session);
    expect(getVocabTestHistory()[0].levels.map((b) => b.rate)).toEqual([1, 0.92, 0.78, 0.12, 0]);
  });

  it("强者最难带 0.9 时底噪封顶 0.3，各带保留正值，估计随水平单调", () => {
    const raw = getVocabTestResult({ ...replaySession(), scoreVersion: 2 })!.levels;
    const estimates = [0.85, 0.9, 0.95, 1].map((rate) => {
      const calibrated = calibrateLevelsV3(raw.map((b) => ({ ...b, rate })));
      expect(calibrated.floor).toBe(GUESS_FLOOR_CAP);
      expect(calibrated.levels.every((b) => b.rate! > 0)).toBe(true);
      return calibrated.levels.reduce((sum, b) => sum + b.total * b.rate!, 0);
    });
    expect(estimates.every((estimate, i) => i === 0 || estimate >= estimates[i - 1])).toBe(true);
    expect(estimates[2]).toBeGreaterThan(estimates[1]);
  });

  it("初学者最难带为零时只给 10% 奖励，夹到 [0,1]，不改输入", () => {
    const raw = getVocabTestResult({ ...replaySession(), scoreVersion: 2 })!.levels
      .map((b, i) => ({ ...b, rate: [1, 0.5, 0.2, 0.1, 0][i] }));
    const calibrated = calibrateLevelsV3(raw);
    expect(calibrated.floor).toBe(0);
    expect(calibrated.levels.map((b) => b.rate)).toEqual([1, 0.55, 0.22, 0.11, 0]);
    expect(raw.map((b) => b.rate)).toEqual([1, 0.5, 0.2, 0.1, 0]);
  });

  it("最难带少于五题不参与底噪；五题即可参与", () => {
    const raw = getVocabTestResult({ ...replaySession(), scoreVersion: 2 })!.levels;
    raw[3] = { ...raw[3], rate: 0.2 };
    raw[4] = { ...raw[4], answered: 4, rate: 0 };
    expect(calibrateLevelsV3(raw).floor).toBe(raw[3].rate);
    raw[4].answered = 5;
    expect(calibrateLevelsV3(raw).floor).toBe(0);
  });

  it("没有合格样本时底噪为零，未答带保留 null，空数组可处理", () => {
    const raw = getVocabTestResult({ ...replaySession(), scoreVersion: 2 })!.levels
      .map((b, i) => ({ ...b, answered: 4, rate: i === 4 ? null : 0.5 }));
    const calibrated = calibrateLevelsV3(raw);
    expect(calibrated.floor).toBe(0);
    expect(calibrated.levels.map((b) => b.rate)).toEqual([0.55, 0.55, 0.55, 0.55, null]);
    expect(calibrateLevelsV3([])).toEqual({ floor: 0, levels: [] });
  });

  it("未作答带的区间不确定性也按 v3 倍率放大", () => {
    const session = replaySession([[2, 0, 2], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    session.populationByLevel = { N5: 10000, N1: 100 };
    const v2 = getVocabTestResult({ ...session, scoreVersion: 2 })!;
    const v3 = getVocabTestResult(session)!;
    expect(v2.estimated - v2.lower).toBe(196);
    expect(v3.estimated - v3.lower).toBe(Math.ceil(196 * CONFIDENCE_BONUS));
  });

  it("新会话完成 80 题后，历史 version=3 与逐级结果一致", () => {
    // 假名词保留释义题，测流程而非依赖小型夹具能合成多少读音干扰项。
    for (let i = 0; i < 120; i++) testDb.run(
      "INSERT INTO words VALUES (?, '', ?, ?, ?, '名词')",
      [30000 + i, `てすと${i}`, `测试释义${i}`, levels[i % 5]]
    );
    let session = startVocabTest(() => 0.3);
    expect(session.scoreVersion).toBe(3);
    expect(session.plannedTotal).toBe(80);
    while (!session.finishedAt) session = submitVocabTestAnswer("correct", session.questions[session.currentIndex].answerIndex, 1000)!;
    expect(session.responses).toHaveLength(80);
    expect(new Set(session.questions.map((q) => q.id)).size).toBe(80);
    recordVocabTestRun(session);
    const result = getVocabTestResult(session)!;
    const history = getVocabTestHistory()[0];
    expect(history.scoreVersion).toBe(3);
    expect(history.estimated).toBe(result.estimated);
    expect(history.levels).toEqual(result.levels.map(({ level, rate, answered }) => ({ level, rate, answered })));
    expect(JSON.parse(String(testDb.exec("SELECT levels_json FROM vocab_test_history")[0].values[0][0])).version).toBe(3);
  });

  it("v2 保留逐题样本方差，v3 按底噪和信心奖励放大", () => {
    const started = startVocabTest(() => 0.35);
    const questions = Array.from({ length: 40 }, (_, i) => ({ ...started.questions[0], id: i + 1, level: "N3" }));
    const responses = questions.map((q, i) => ({ questionIndex: i, questionId: q.id,
      answerState: i < 25 ? "correct" as const : i < 30 ? "wrong" as const : "unknown" as const,
      selectedOption: null, responseMs: 1000, answeredAt: 1 }));
    const session = { ...started, questions, responses, populationByLevel: { N3: 1000 }, plannedTotal: 40 };
    const v2 = getVocabTestResult({ ...session, scoreVersion: 2 })!;
    const v3 = getVocabTestResult({ ...session, scoreVersion: 3 })!;
    const variance = (25 + 5 * 1.15 ** 2 - (25 - 5 * 1.15) ** 2 / 40) / (40 * 39);
    expect(v2.upper - v2.estimated).toBe(Math.ceil(1.96 * 1000 * Math.sqrt(variance)));
    const varianceV3 = variance * (CONFIDENCE_BONUS / (1 - GUESS_FLOOR_CAP)) ** 2;
    expect(v3.levels.find((b) => b.level === "N3")?.rate).toBe(0.28);
    expect(v2.levels.find((b) => b.level === "N3")?.rate).toBe(0.48);
    expect(v3.upper - v3.estimated).toBe(Math.ceil(1.96 * 1000 * Math.sqrt(varianceV3)));
  });
});
