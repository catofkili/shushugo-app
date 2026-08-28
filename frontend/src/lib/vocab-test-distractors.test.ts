import { describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import fs from "node:fs";

/**
 * 干扰项质量的体检，跑**出厂库**（`public/nihongo.db`，在仓库里，所以结果可复现）。
 *
 * 钉的是「干扰项要挑近的」这条（docs/VOCAB_TEST_BUILD.md §2.2）。
 * 上线时踩过一次：干扰项是同级里随机取的，实测 —— 失礼（しつれい，漢語サ変名詞）
 * 抽到 よみかえす／おいかえす／めざめる（和語動詞）／どれぐらい（副詞），
 * **知道它是个漢語名词就能全排除**，不用认识这个词，词汇量随之偏高。
 *
 * 同一批目标词上，同级随机取的基线是：
 *   同词性 39.0% · 同表记类型 92.5% · 拍数差 ≤1 73.8%（27,132 个干扰项）
 * 下面的门槛就是照着这个差距定的。
 */
let testDb: Database;
vi.mock("./database", () => ({ getDatabase: () => testDb, initDatabase: async () => testDb, exportDatabase: () => null, importDatabase: async () => undefined }));
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));

import { buildVocabTestQuestions, type VocabTestWordRow } from "./vocab-test";
import { classifyPos } from "./word-library";
import { moraCount } from "../features/word-study/word-study-utils";
import { isLoanwordSourceSurface, kanjiReadingSurface, preferredWordSurface } from "./orthography";

describe("词汇量测验的干扰项", () => {
  it("读音题的干扰项同词性、同表记类型、拍数差不超过 1", async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(fs.readFileSync("public/nihongo.db")));
    const result = testDb.exec(`
      SELECT id, kanji, kana, meaning, pos, jlpt_level FROM words
      WHERE jlpt_level IN ('N5','N4','N3','N2','N1')
        AND TRIM(COALESCE(meaning,'')) <> '' AND TRIM(COALESCE(kana,'')) <> ''
    `)[0];
    const rows: VocabTestWordRow[] = result.values.map((value) => ({
      id: Number(value[0]), kanji: String(value[1] ?? ""), kana: String(value[2] ?? ""),
      meaning: String(value[3] ?? ""), pos: String(value[4] ?? ""), level: String(value[5] ?? "")
    }));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const byKana = new Map<string, VocabTestWordRow>();
    rows.forEach((row) => { if (!byKana.has(row.kana)) byKana.set(row.kana, row); });

    const firstMora = (kana: string) => (kana.match(/^.[ゃゅょぁぃぅぇぉ]?/) ?? [kana.slice(0, 1)])[0];
    let samePos = 0, sameLoan = 0, moraOk = 0, total = 0;
    let questions = 0, uniqueFirst = 0, uniqueLast = 0;
    const perLevel: Record<string, number> = {};
    const runs = 8;
    for (let seed = 0; seed < runs; seed += 1) {
      let state = seed * 7919 + 13;
      const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
      buildVocabTestQuestions(rows, random).questions.forEach((question) => {
        perLevel[question.level] = (perLevel[question.level] ?? 0) + 1;
        if (question.kind !== "reading") return;
        const target = byId.get(question.id)!;
        questions += 1;
        const others = question.options.filter((option) => option !== question.answer);
        if (!others.some((option) => firstMora(option) === firstMora(question.answer))) uniqueFirst += 1;
        if (!others.some((option) => option.slice(-1) === question.answer.slice(-1))) uniqueLast += 1;
        others.forEach((option) => {
          const distractor = byKana.get(option);
          if (!distractor) return;
          total += 1;
          if (classifyPos(distractor.pos ?? "") === classifyPos(target.pos ?? "")) samePos += 1;
          if (isLoanwordSourceSurface(distractor) === isLoanwordSourceSurface(target)) sameLoan += 1;
          if (Math.abs(moraCount(distractor.kana) - moraCount(target.kana)) <= 1) moraOk += 1;
        });
      });
    }

    expect(total).toBeGreaterThan(500);

    /**
     * ⚠️ 最重要的一条：**认识一个汉字不能就够选对**。
     *
     * 上线时实测 85.7% 的读音题里只有正确答案是那个首拍、59.9% 尾拍唯一 ——
     * 経済(けいざい) 四个选项只有一个以 けい 开头，知道 経 读 けい 就能选对。
     * 用户的 N2 正确率被抬到 57%，词汇量整体高估约一倍。
     */
    expect(uniqueFirst / questions).toBeLessThan(0.05);
    expect(uniqueLast / questions).toBeLessThan(0.05);

    /**
     * ⚠️ 同词性从 97.5% 掉到 ~82% 是**故意换的**，不是退步。
     * 音位约束比词性约束重要得多：返済(へんさい) 配 済む(すむ) 虽然词性不同，
     * 但它正是在考「済 在这里读 さい 不读 す」；而同词性却读音无关的选项一眼可排。
     * 门槛因此定在 0.75，掉破它才说明音位槽把池子放得太宽了。
     */
    expect(samePos / total).toBeGreaterThan(0.75);
    expect(sameLoan / total).toBe(1);
    expect(moraOk / total).toBe(1);
    // 保底 9 + Neyman：低带不会被 N2/N1 饿死，高带拿到更多题
    VOCAB_TEST_EXPECTED_ALLOCATION.forEach(([level, count]) => {
      expect(perLevel[level] / runs).toBe(count);
    });
  }, 120000);
});

/** docs/VOCAB_TEST_BUILD.md §3.3 的分配落到 60 题上的样子。 */
const VOCAB_TEST_EXPECTED_ALLOCATION: [string, number][] = [
  ["N5", 10], ["N4", 10], ["N3", 12], ["N2", 14], ["N1", 14]
];


/**
 * ⚠️ 两类「明明答对了却判错」，都是用户实测报回来的。
 *
 * ① **同题面的另一个正确答案被当成干扰项。**
 *    `側|そば`（旁边；附近）出题，题面是 そば（側 在正字表里是「常写假名」档），
 *    而库里还有 `蕎麦|そば`（荞麦面）—— 荞麦面被摆成干扰项，可它就是 そば 的正确答案。
 *    库里这样的题面有 93 个（释义）+ 59 个（读音，如 生物 → せいぶつ / なまもの）。
 *
 * ② **干扰项是答案的一部分。** `お金` 摆了 **かね** —— 那是题面里唯一那个汉字「金」
 *    的正确读音，而 お 就明摆在题面上。判它错等于惩罚部分知识，
 *    而部分知识本来就该算会（Nation 的规格）。
 */
describe("⚠️ 干扰项不能其实是对的", () => {
  it("同题面的另一个合法答案、以及答案的子串，都不许当干扰项", async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(fs.readFileSync("public/nihongo.db")));
    const result = testDb.exec(`
      SELECT id, kanji, kana, meaning, pos, jlpt_level FROM words
      WHERE jlpt_level IN ('N5','N4','N3','N2','N1')
        AND TRIM(COALESCE(meaning,'')) <> '' AND TRIM(COALESCE(kana,'')) <> ''
    `)[0];
    const rows: VocabTestWordRow[] = result.values.map((value) => ({
      id: Number(value[0]), kanji: String(value[1] ?? ""), kana: String(value[2] ?? ""),
      meaning: String(value[3] ?? ""), pos: String(value[4] ?? ""), level: String(value[5] ?? "")
    }));

    const byPrompt = (pick: (row: VocabTestWordRow) => string) => {
      const map = new Map<string, Set<string>>();
      rows.forEach((row) => [preferredWordSurface(row), kanjiReadingSurface(row)].forEach((surface) => {
        if (!surface) return;
        const bucket = map.get(surface) ?? new Set<string>();
        bucket.add(pick(row).trim());
        map.set(surface, bucket);
      }));
      return map;
    };
    const readings = byPrompt((row) => row.kana);
    const meanings = byPrompt((row) => row.meaning);

    let checked = 0, alsoCorrect = 0, nested = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      let state = seed * 7919 + 13;
      const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
      buildVocabTestQuestions(rows, random).questions.forEach((question) => {
        checked += 1;
        const valid = (question.kind === "reading" ? readings : meanings).get(question.prompt) ?? new Set<string>();
        question.options.filter((option) => option !== question.answer).forEach((option) => {
          if (valid.has(option)) alsoCorrect += 1;
          if (question.kind === "reading"
            && (question.answer.includes(option) || option.includes(question.answer))) nested += 1;
        });
      });
    }
    expect(checked).toBeGreaterThan(500);
    expect(alsoCorrect).toBe(0);
    expect(nested).toBe(0);
  }, 120000);
});
