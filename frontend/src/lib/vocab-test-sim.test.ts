/**
 * 离线底噪模拟：VOCAB_SIM=1 VOCAB_SIM_LABEL=baseline npx vitest run src/lib/vocab-test-sim.test.ts
 * S = live.db 的 DISTINCT reviews.word_id；K = S 内词条表记出现的汉字。
 * 假设复习过就会，已知词只按 SLIP 失误；未知词只看可见题面和选项，绝不偷看答案。
 * 读音：K 内每个汉字的任一字典读音出现在选项中就加 1；训读只取点前词干。
 * 释义：题面汉字与中文选项共享的字符数（先做下方近似字形归一），不要求属于 K。
 * strict 有线索必答、无则跳过；eager 无线索时另有 50% 概率盲猜；并列均匀随机。
 * 局限：会一个字不等于会它的全部读音；没有语义推断、中文音到日语音的迁移、浊化或
 * 促音变体，也没有模拟遗忘/熟练度差异。字形映射有歧义，绝不是完整简繁转换。
 * 本模型未按真人结果调参；区间仅作外部参照，未命中也报告，不能据此伪造历史出题器。
 * 2026-10-19 未改动代码的 baseline：strict N2/N1=0.3674/0.3182，均值 5909；
 * eager=0.2924/0.2524，均值 5307，两档均在参考区间内，故没有放宽线索或调参。
 * e_b 是所有未知题的原始得分均值（按题数加权，含跳过），不是 clamp 后的 rate。
 * r = g + (1-g)e / g = (r-e)/(1-e) 只适用于无失误、未截断的期望；SLIP、逐级
 * clamp/四舍五入与自适应抽样均使它只是近似，不能直接用于校正单次真实测验。
 * semantic40 未知题始终作答，40% 正确、其余均匀选错；它是语义能力的敏感性档，
 * 不是使用答案线索的可部署作答器。h=C/(C+W)；e=(C−pW)/(C+W+U)，含跳过。
 * 2026-10-20：撤回扫描选 p 及 final 验收；模拟者不会真人的规则音读推断，结果仅供参考。
 * 校准常量的验收改用 vocab-test.test.ts 的真人回放，不由本模拟器选罚分。
 * 复现须保持 live.db 字节、生产代码（含其依赖）、读音表与种子一致；报告记录三个入口文件 SHA-256。
 * 仅文件读取真实快照；真实出题/计分全在独立内存库运行，写出仅限 .local/vocab-sim/。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { createHash } from "node:crypto";
import { Console } from "node:console";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import kanjiReadings from "../data/kanji_readings.json";

let testDb: Database;
vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));

import {
  getVocabTestResult, getVocabTestSession, startVocabTest, submitVocabTestAnswer,
  PENALTY, VOCAB_TEST_QUESTION_COUNT, VOCAB_TEST_LEVELS, type VocabTestAnswerState, type VocabTestQuestion
} from "./vocab-test";

const N = 200; // 每档完整测验场数，每场独立重置会话和种子。
const BASE_SEED = 20261019; // Mulberry32 初始种子；第 i 场加 i*7919，三档用同一组种子。
const SLIP = 0.03; // 已知词选错的概率；错选项从其余三个中均匀选，不会再次碰巧答对。
const RESPONSE_MS = 1200; // 正常作答时长，不触发读音/释义题时限。
const PROFILES = { strict: { BLIND_GUESS: 0 }, eager: { BLIND_GUESS: 0.5 }, semantic40: { BLIND_GUESS: 1 } } as const;
// 直写终端，避免测试运行器隐藏通过场次的日志；默认跳过时不会输出任何内容。
const console = new Console(process.stdout, process.stderr);
const LEVELS = VOCAB_TEST_LEVELS;
type Level = typeof LEVELS[number];
type Kind = VocabTestQuestion["kind"];
type Profile = keyof typeof PROFILES;
const LIVE_DB = resolve(".local/live.db");
const LABEL = process.env.VOCAB_SIM_LABEL ?? "final";
if (process.env.VOCAB_SIM && !existsSync(LIVE_DB)) throw new Error(`缺少只读冻结快照：${LIVE_DB}；不能跳过后声称模拟通过`);
const TOTAL = Number(process.env.VOCAB_SIM_TOTAL ?? VOCAB_TEST_QUESTION_COUNT);
if (![60, 80].includes(TOTAL)) throw new Error("VOCAB_SIM_TOTAL 只能是 60 或 80（60 为历史对照）");
const REFERENCE = [
  { date: "2026-10-19", rates: [1, 1, 0.82, 0.38, 0.32], estimated: 6199 },
  { date: "2026-09-23", rates: [1, 1, 0.83, 0.19, 0.13], estimated: 4779 },
  // 用户未提供这场逐级 rate，保留 null，不能用其他场的 rate 填补。
  { date: "2026-09-01", rates: [null, null, null, null, null], estimated: 4493 }
];

// 常见日文/繁体→简体的近似字形表；仅认同字，不增加近义词、语义或答案特例。
// 弁/発/復等存在一对多含义，此处各取常见中文写法，所以仍可能漏掉线索。
const SHAPE_PAIRS = `
魚鱼 気气 経经 時时 間间 関关 見见 聞闻 読读 書书 話话 語语
電电 車车 東东 楽乐 強强 広广 長长 門门 開开 閉闭 問问 題题 頭头 顔颜
風风 雲云 馬马 鳥鸟 鶏鸡 竜龙 貝贝 買买 売卖 貸贷 貨货 費费 資资
産产 業业 動动 転转 運运 進进 遠远 過过 達达 連连 辺边 選选 週周
帰归 帯带 満满 済济 漢汉 湯汤 無无 熱热 焼烧
紙纸 線线 組组 終终 結结 続续 練练 緑绿 縁缘 績绩 総总 給给 絵绘 統统 約约 細细
記记 計计 設设 許许 試试 認认 説说 調调 論论 議议 護护 訳译 証证 評评 課课 謝谢
駅驿 鉄铁 銀银 銅铜 銭钱 録录 鏡镜 鍵键 鎖锁 鈴铃 鉱矿 針针 釣钓 鋭锐 鑑鉴
飯饭 飲饮 館馆 飼饲 餓饿 飾饰 餅饼 養养 験验 駆驱 騒骚 駐驻 髪发 黒黑 黄黄
愛爱 悪恶 悩恼 応应 憶忆 態态 慣惯 憤愤 懐怀 夢梦 実实 対对 専专
戦战 単单 労劳 勝胜 負负 効效 勧劝 勢势 協协 圧压 厳严 変变
復复 複复 発发 弁辩 減减 増增 覚觉 観观 規规 視视 親亲 現现
節节 葉叶 芸艺 薬药 華华 蔵藏 伝传 仏佛 価价 値值 側侧 優优 備备
`;
const shapeEntries = SHAPE_PAIRS.trim().split(/\s+/).map((pair) => [...pair]);
const shapes = new Map(shapeEntries.map(([from, to]) => [from, to]));
const normalizeShape = (text: string): string => [...text].map((c) => shapes.get(c) ?? c).join("");
const kanji = (text: string): string[] => [...text].filter((c) => /\p{Script=Han}/u.test(c));
const readings: Record<string, { on?: string[]; kun?: string[] }> = kanjiReadings.readings;
const stems = new Map(Object.entries(readings).map(([c, entry]) => [
  c, [...new Set([...(entry.on ?? []), ...(entry.kun ?? []).map((r) => r.split(".")[0])])].filter(Boolean)
]));
let knownIds: Set<number>;
let knownKanji: Set<string>;
let sourceInfo: object;

const prng = (seed: number): (() => number) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (choices: number[], random: () => number): number => choices[Math.floor(random() * choices.length)];

const clueScores = (question: VocabTestQuestion, k: Set<string>): number[] => {
  if (question.kind === "reading") {
    const chars = kanji(question.readingScope ?? question.prompt).filter((c) => k.has(c));
    return question.options.map((option) => chars.filter((c) => stems.get(c)?.some((r) => option.includes(r))).length);
  }
  const chars = kanji(normalizeShape(question.prompt));
  return question.options.map((option) => {
    const normalized = normalizeShape(option);
    return chars.filter((c) => normalized.includes(c)).length;
  });
};

const selectUnknown = (scores: number[], blindGuess: number, random: () => number): number | null => {
  const highest = Math.max(...scores);
  if (highest >= 1) return pick(scores.flatMap((score, i) => score === highest ? [i] : []), random);
  return random() < blindGuess ? Math.floor(random() * scores.length) : null;
};

type Tally = { correct: number; wrong: number; unknown: number };
const tally = (): Tally => ({ correct: 0, wrong: 0, unknown: 0 });
const noiseStats = (counts: Tally) => {
  const n = counts.correct + counts.wrong + counts.unknown;
  return {
    n, ...counts,
    h: counts.correct + counts.wrong ? counts.correct / (counts.correct + counts.wrong) : null,
    e: n ? (counts.correct - PENALTY * counts.wrong) / n : null,
    correctRate: n ? counts.correct / n : null,
    wrongRate: n ? counts.wrong / n : null,
    unknownRate: n ? counts.unknown / n : null
  };
};
const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  // 线性插值经验分位数；这里是场间分布，不是生产计分返回的单场置信区间。
  const quantile = (p: number) => {
    const index = (sorted.length - 1) * p, lo = Math.floor(index);
    return sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo);
  };
  return { mean: values.reduce((sum, v) => sum + v, 0) / values.length, p05: quantile(0.05), p95: quantile(0.95) };
};
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const display = (value: number | null) => value == null ? "—" : Number(value.toFixed(4));

type Run = { seed: number; estimated: number; intervalWidth: number; rates: Record<Level, number>;
  answers: { id: number; level: string; kind: Kind; known: boolean; state: Exclude<VocabTestAnswerState, "timeout">; selected: number | null; answerIndex: number }[];
  raw: { level: string; total: number; answered: number; correct: number; wrong: number }[] };
const reports: { profile: Profile; levels: Record<Level, { rate: ReturnType<typeof distribution>; estimated: ReturnType<typeof distribution>; h: number | null; e: number | null; unknown: Record<"all" | Kind, ReturnType<typeof noiseStats>> }>;
  estimated: ReturnType<typeof distribution>; runs: Run[]; intervalWidth: ReturnType<typeof distribution>; unknownByKind: object }[] = [];
describe.skipIf(!process.env.VOCAB_SIM)("词汇量有依据猜测模拟（只读 live.db）", () => {
  describe.skipIf(!existsSync(LIVE_DB))("本机真实快照存在时", () => {
    beforeAll(async () => {
      if (!/^[\w-]+$/.test(LABEL)) throw new Error("VOCAB_SIM_LABEL 只能包含字母、数字、下划线和连字符");
      const SQL = await initSqlJs();
      const bytes = readFileSync(LIVE_DB);
      const source = new SQL.Database(new Uint8Array(bytes));
      try {
        knownIds = new Set(source.exec("SELECT DISTINCT word_id FROM reviews")[0].values.map(([id]) => Number(id)));
        const surfaces = source.exec("SELECT kanji FROM words WHERE id IN (SELECT DISTINCT word_id FROM reviews)")[0];
        knownKanji = new Set(surfaces.values.flatMap(([surface]) => kanji(String(surface ?? ""))));
        const rows = source.exec(`
          SELECT id, kanji, kana, meaning, pos, jlpt_level AS level FROM words
          WHERE jlpt_level IN ('N5','N4','N3','N2','N1')
            AND TRIM(COALESCE(meaning,''))<>'' AND TRIM(COALESCE(kana,''))<>'' ORDER BY id
        `)[0].values;
        sourceInfo = {
          liveDbSha256: sha256(bytes),
          questionCodeSha256: sha256(readFileSync(resolve("src/lib/vocab-test.ts"))),
          kanjiReadingsSha256: sha256(readFileSync(resolve("src/data/kanji_readings.json"))),
          knownWords: knownIds.size, knownKanji: knownKanji.size,
          populations: Object.fromEntries(LEVELS.map((level) => [level, {
            total: rows.filter((row) => row[5] === level).length,
            known: rows.filter((row) => row[5] === level && knownIds.has(Number(row[0]))).length
          }]))
        };
        testDb = new SQL.Database();
        testDb.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        testDb.run("CREATE TABLE words (id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, meaning TEXT, pos TEXT, jlpt_level TEXT)");
        testDb.run("CREATE TABLE reviews (id INTEGER PRIMARY KEY, word_id INTEGER, answer TEXT, score_after REAL, reviewed_on TEXT)");
        const insert = testDb.prepare("INSERT INTO words VALUES (?, ?, ?, ?, ?, ?)");
        try { rows.forEach((row) => insert.run(row)); } finally { insert.free(); }
      } finally { source.close(); }
      expect(knownIds.size).toBeGreaterThan(0);
      console.log("模拟数据来源", sourceInfo);
    });

    afterEach(() => { vi.restoreAllMocks(); });
    afterAll(() => {
      testDb?.close();
      if (reports.length !== Object.keys(PROFILES).length) return;
      const path = resolve(".local/vocab-sim", `${LABEL}.json`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({
        label: LABEL, source: sourceInfo, simulatorSha256: sha256(readFileSync(resolve("src/lib/vocab-test-sim.test.ts"))),
        parameters: { N, TOTAL, BASE_SEED, seedStride: 7919, SLIP, PENALTY, RESPONSE_MS, PROFILES, shapeMappings: shapes.size },
        reference: REFERENCE,
        note: "仅供参考：模拟者不会真人的规则音读推断，不能用于选择罚分或验收。e 为未知题未截断得分；rate 为校准后结果；分位数是场间分布，历史为旧出题。",
        profiles: reports
      }, null, 2) + "\n");
      console.log(`模拟报告：${path}`);
    });

    it("校验线索、盲猜、并列与统计口径", () => {
      expect(shapeEntries.every((pair) => pair.length === 2)).toBe(true);
      expect(shapes.size).toBeGreaterThanOrEqual(100);
      expect(shapes.size).toBeLessThanOrEqual(200);
      const q: VocabTestQuestion = {
        id: -1, level: "N2", kind: "reading", prompt: "魚水", readingScope: "魚",
        options: ["ぎょすい", "みず", "ぎょ", "とり"], answerIndex: 3, answer: "とり"
      };
      expect(clueScores(q, new Set(["魚", "水"]))).toEqual([1, 0, 1, 0]);
      expect(clueScores(q, new Set(["水"]))).toEqual([0, 0, 0, 0]);
      expect(clueScores({ ...q, prompt: "食", readingScope: "食", options: ["た", "たべる", "しょく", "みず"] }, new Set(["食"]))).toEqual([1, 1, 1, 0]);
      expect(clueScores({ ...q, kind: "meaning", prompt: "如魚得水", options: ["鱼水", "水", "鸟", "鱼鱼"] }, new Set())).toEqual([2, 1, 0, 1]);
      expect(selectUnknown([1, 0, 1, 0], 0, () => 0)).toBe(0);
      expect(selectUnknown([1, 0, 1, 0], 0, () => 0.99)).toBe(2);
      expect(selectUnknown([0, 0, 0, 0], 0, () => 0)).toBeNull();
      expect(selectUnknown([0, 0, 0, 0], 0.5, () => 0.4)).toBe(1);
      expect(selectUnknown([0, 0, 0, 0], 0.5, () => 0.6)).toBeNull();
      expect(noiseStats({ correct: 2, wrong: 1, unknown: 1 }).e).toBeCloseTo((2 - PENALTY) / 4);
      expect(distribution([0, 10, 20])).toEqual({ mean: 10, p05: 1, p95: 19 });
      expect(Array.from({ length: 10 }, prng(BASE_SEED))).toEqual(Array.from({ length: 10 }, prng(BASE_SEED)));
    });

    for (const profile of Object.keys(PROFILES) as Profile[]) {
      it(`${profile}：${N} 场真实 20→${TOTAL} 题流程`, () => {
        const BLIND_GUESS = PROFILES[profile].BLIND_GUESS;
        const unknown = Object.fromEntries(LEVELS.map((level) => [level, { all: tally(), reading: tally(), meaning: tally() }])) as Record<Level, Record<"all" | Kind, Tally>>;
        const byKind = { reading: tally(), meaning: tally() };
        const runs: Run[] = [];
        let random = prng(BASE_SEED);
        // 补题内部走默认 Math.random；局部替换才能让补充题目也复现。afterEach 必须恢复。
        vi.spyOn(Math, "random").mockImplementation(() => random());
        for (let i = 0; i < N; i++) {
          const seed = BASE_SEED + i * 7919;
          random = prng(seed);
          testDb.run("DELETE FROM app_state");
          expect(getVocabTestSession()).toBeNull();
          let session = startVocabTest(random);
          expect(session.questions).toHaveLength(20);
          expect(session.responses).toHaveLength(0);
          expect(session.scoreVersion).toBe(3);
          if (TOTAL !== session.plannedTotal) {
            session = { ...session, plannedTotal: TOTAL };
            testDb.run("UPDATE app_state SET value = ? WHERE key = 'vocab_test_session_v1'", [JSON.stringify(session)]);
          }
          for (const level of LEVELS) expect(session.questions.filter((q) => q.level === level)).toHaveLength(4);
          const answers: Run["answers"] = [];
          while (!session.finishedAt) {
            const q = session.questions[session.currentIndex];
            if (!q || session.currentIndex >= TOTAL) throw new Error("完整会话未正常推进");
            let selected: number | null;
            const known = knownIds.has(q.id);
            if (known) {
              selected = random() < SLIP
                ? pick(q.options.flatMap((_, index) => index === q.answerIndex ? [] : [index]), random)
                : q.answerIndex;
            } else if (profile === "semantic40") {
              selected = random() < 0.40 ? q.answerIndex : pick(q.options.flatMap((_, i) => i === q.answerIndex ? [] : [i]), random);
            } else {
              selected = selectUnknown(clueScores(q, knownKanji), BLIND_GUESS, random);
            }
            // 出题 API 信任传入的 answerState；必须从实际选择算对错，不能直接传“correct”。
            const state: Exclude<VocabTestAnswerState, "timeout"> = selected == null ? "unknown" : selected === q.answerIndex ? "correct" : "wrong";
            answers.push({ id: q.id, level: q.level, kind: q.kind, known, state, selected, answerIndex: q.answerIndex });
            if (!known) {
              const level = q.level as Level;
              unknown[level].all[state]++;
              unknown[level][q.kind][state]++;
              byKind[q.kind][state]++;
            }
            session = submitVocabTestAnswer(state, selected, RESPONSE_MS)!;
            if (session.currentIndex === 20) expect(session.questions).toHaveLength(TOTAL);
          }
          const saved = getVocabTestSession();
          const result = getVocabTestResult(saved)!;
          expect(result.answered).toBe(TOTAL);
          expect(saved!.questions).toHaveLength(TOTAL);
          expect(new Set(saved!.questions.map((q) => q.id)).size).toBe(TOTAL);
          expect(result.totalQuestions).toBe(TOTAL);
          runs.push({ seed, answers, estimated: result.estimated, intervalWidth: result.upper - result.lower, raw: result.levels.map(({ level, total, answered, correct, wrong }) => ({ level, total, answered, correct, wrong })), rates: Object.fromEntries(result.levels.map((b) => [b.level, b.rate!])) as Record<Level, number> });
          if ((i + 1) % 50 === 0) console.log(`${profile} ${i + 1}/${N}`);
        }
        const levels = Object.fromEntries(LEVELS.map((level) => [level, {
          rate: distribution(runs.map((run) => run.rates[level])),
          estimated: distribution(runs.map((run) => run.raw.find((b) => b.level === level)!.total * run.rates[level])),
          h: noiseStats(unknown[level].all).h,
          e: noiseStats(unknown[level].all).e,
          unknown: Object.fromEntries((["all", "reading", "meaning"] as const).map((kind) => [kind, noiseStats(unknown[level][kind])])) as Record<"all" | Kind, ReturnType<typeof noiseStats>>
        }])) as (typeof reports)[number]["levels"];
        const estimated = distribution(runs.map((run) => run.estimated));
        console.log(`${profile} 逐级 rate 与用户旧测验（9/1 未提供逐级数据）`);
        console.table(LEVELS.map((level, index) => ({
          level, mean: display(levels[level].rate.mean), p05: display(levels[level].rate.p05), p95: display(levels[level].rate.p95),
          ...Object.fromEntries(REFERENCE.map((r) => [r.date, r.rates[index]]))
        })));
        console.table([{ profile, ...estimated, ...Object.fromEntries(REFERENCE.map((r) => [r.date, r.estimated])) }]);
        console.log(`${profile} 未知词原始得分 e（分母含不认识）`);
        console.table(LEVELS.flatMap((level) => (["all", "reading", "meaning"] as const).map((kind) => {
          const s = noiseStats(unknown[level][kind]);
          return { level, kind, n: s.n, h: display(s.h), e: display(s.e), correct: display(s.correctRate), wrong: display(s.wrongRate), unknown: display(s.unknownRate) };
        })));
        console.table(Object.entries(byKind).map(([kind, counts]) => ({ kind, ...noiseStats(counts) })));
        reports.push({ profile, levels, estimated, unknownByKind: Object.fromEntries(Object.entries(byKind).map(([kind, counts]) => [kind, noiseStats(counts)])), intervalWidth: distribution(runs.map((r) => r.intervalWidth)), runs });
      }, 1_200_000);
    }
    it("参考模拟完整记录三档流程，不作为真人校准验收", () => {
      expect(reports).toHaveLength(Object.keys(PROFILES).length);
      for (const report of reports) {
        expect(report.runs).toHaveLength(N);
        expect(report.runs.every((run) => run.answers.length === TOTAL)).toBe(true);
      }
    });
  });
});
