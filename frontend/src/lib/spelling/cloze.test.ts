import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { checkSpelling } from "./check";
import { analyzeCloze, clozeFor, type ClozeFailureReason, type ClozeWord } from "./cloze";
import { spellingTargetForWord } from "./forms";

interface WordRow extends ClozeWord { pos: string }

const word = (overrides: Partial<ClozeWord> = {}): ClozeWord => ({
  id: 1,
  kanji: "食べる",
  kana: "たべる",
  example_jp: "彼は食べた。",
  example_meaning: "他吃了。",
  example_furigana: JSON.stringify([[2, 1, "た"]]),
  example_tokens: "1,-1,3,1",
  example_lemmas: JSON.stringify({ 2: { lemma: "食べる", morphs: [
    { surface: "食べ", lemma: "食べる", pos: "動詞", detail: "自立" },
    { surface: "た", lemma: "た", pos: "助動詞", detail: "*" }
  ] } }),
  ...overrides
});

const cleanSample = (value: string): string => value.replace(/[|\r\n]+/gu, " ").replace(/\s+/gu, " ").trim();
const formatWord = (row: WordRow): string => `#${row.id} ${cleanSample(row.kanji)}（${cleanSample(row.kana)}）`;

const classifyInflection = (row: WordRow, surface: string, reading: string): string | null => {
  const dictionaryTarget = spellingTargetForWord(row);
  if (surface === dictionaryTarget.surface || dictionaryTarget.forms.some((form) => form.surface === surface)) return null;
  if (/(?:なかった|なく|ない|ず)$/u.test(reading)) return "否定";
  if (/[ただ]$/u.test(reading)) return "过去";
  if (/[てで]$/u.test(reading)) return "て形";
  if (/く$/u.test(reading) && /形容词|形容詞/u.test(row.pos)) return "形容词连用";
  return "其他活用";
};

const reportPath = fileURLToPath(new URL("../../../../docs/audits/2026-10-03-spelling-cloze.md", import.meta.url));
let words: WordRow[] = [];

beforeAll(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(new Uint8Array(readFileSync(new URL("../../../public/nihongo.db", import.meta.url))));
  try {
    const result = db.exec(`
      SELECT id, kanji, kana, pos, example_jp, example_meaning, example_furigana,
        example_tokens, example_lemmas
      FROM words ORDER BY id
    `)[0];
    if (!result) throw new Error("nihongo.db 没有 words 表或词条");
    const positions = Object.fromEntries(result.columns.map((name, index) => [name, index]));
    words = result.values.map((values) => ({
      id: Number(values[positions.id]),
      kanji: String(values[positions.kanji] ?? ""),
      kana: String(values[positions.kana] ?? ""),
      pos: String(values[positions.pos] ?? ""),
      example_jp: String(values[positions.example_jp] ?? ""),
      example_meaning: String(values[positions.example_meaning] ?? ""),
      example_furigana: String(values[positions.example_furigana] ?? ""),
      example_tokens: String(values[positions.example_tokens] ?? ""),
      example_lemmas: String(values[positions.example_lemmas] ?? "")
    }));
  } finally {
    db.close();
  }
});

describe("clozeFor", () => {
  it("按词元挖出含活用助动词的整段，并用注音还原读音", () => {
    const result = clozeFor(word());
    expect(result).toMatchObject({
      cloze: { before: "彼は", after: "。", surface: "食べた", reading: "たべた" },
      target: { kana: "たべた", surface: "食べた", forms: [{ surface: "食べた", tag: "standard" }] }
    });
    expect(checkSpelling(result!.target, result!.cloze.surface).correct).toBe(true);
    expect(checkSpelling(result!.target, result!.cloze.reading).correct).toBe(true);
  });

  it.each([
    ["食べて", "たべて", "食べる", "たべる", "食", "た"],
    ["行かない", "いかない", "行く", "いく", "行", "い"],
    ["美しく", "うつくしく", "美しい", "うつくしい", "美", "うつく"]
  ])("保留活用 %s 的完整表层和假名", (surface, reading, kanji, kana, prefix, annotationReading) => {
    const sentence = `${surface}。`;
    const result = clozeFor(word({
      kanji,
      kana,
      example_jp: sentence,
      example_meaning: "例句。",
      example_furigana: JSON.stringify([[0, prefix.length, annotationReading]]),
      example_tokens: `${surface.length},1`,
      example_lemmas: JSON.stringify({ 0: kanji })
    }));
    expect(result?.cloze).toMatchObject({ surface, reading, before: "", after: "。" });
    expect(result && checkSpelling(result.target, surface).correct).toBe(true);
    expect(result && checkSpelling(result.target, reading).correct).toBe(true);
  });

  it("先用唯一词元定位，回退时才按唯一表记或读音定位", () => {
    const repeated = word({
      example_jp: "食べた。は食べた。",
      example_meaning: "他吃了。",
      example_furigana: JSON.stringify([[0, 1, "た"], [5, 1, "た"]]),
      example_tokens: "3,1,-1,3,1",
      example_lemmas: JSON.stringify({ 0: "食べる" })
    });
    expect(clozeFor(repeated)?.cloze.before).toBe("");

    const fallback = word({
      kanji: "学校", kana: "がっこう", example_jp: "学校へ。", example_furigana: JSON.stringify([[0, 2, "がっこう"]]),
      example_tokens: "", example_lemmas: ""
    });
    expect(clozeFor(fallback)?.cloze).toMatchObject({ before: "", surface: "学校", reading: "がっこう", after: "へ。" });

    const readingFallback = word({
      kanji: "夜", kana: "よる", example_jp: "よる。", example_furigana: "", example_tokens: "", example_lemmas: ""
    });
    expect(clozeFor(readingFallback)?.cloze).toMatchObject({ surface: "よる", reading: "よる" });
  });

  it("保留片假名原样，拒绝重复位置、缺注音和不可挖空的词", () => {
    const camera = clozeFor(word({
      kanji: "camera", kana: "カメラ", example_jp: "カメラ。", example_furigana: "",
      example_tokens: "", example_lemmas: ""
    }));
    expect(camera?.cloze.reading).toBe("カメラ");

    expect(analyzeCloze(word({ kanji: "学校", kana: "がっこう", example_jp: "学校と学校", example_furigana: "", example_tokens: "", example_lemmas: "" })))
      .toMatchObject({ result: null, reason: "ambiguous_match" });
    expect(analyzeCloze(word({ kanji: "学校", kana: "がっこう", example_jp: "学校。", example_furigana: "", example_tokens: "", example_lemmas: "" })))
      .toMatchObject({ result: null, reason: "missing_furigana" });
    expect(analyzeCloze(word({ example_jp: "", example_meaning: "" }))).toMatchObject({ result: null, reason: "no_example" });
    expect(analyzeCloze(word({ example_meaning: " " }))).toMatchObject({ result: null, reason: "no_translation" });
    expect(analyzeCloze(word({ kanji: "〜屋", kana: "〜や" }))).toMatchObject({ result: null, reason: "placeholder_word" });
  });

  it("字符串回退不会挖空负边界标记的纯假名助词", () => {
    const particle = word({
      kanji: "は", kana: "は", example_jp: "私は学校へ行く。", example_meaning: "我去学校。",
      example_furigana: JSON.stringify([[0, 1, "わたし"], [2, 2, "がっこう"], [5, 1, "い"]]),
      example_tokens: "1,-1,2,-1,2,1", example_lemmas: JSON.stringify({ 4: "行く" })
    });
    expect(analyzeCloze(particle)).toMatchObject({ result: null, reason: "no_unique_match" });
  });

  it("全库运行并钉住题面、读音和原句的不变量，生成失败样例清单", () => {
    expect(words).toHaveLength(10919);
    const failures = new Map<ClozeFailureReason, { count: number; samples: string[] }>();
    const methods: Record<string, number> = { lemma: 0, surface: 0, reading: 0 };
    const inflections = new Map<string, string[]>();
    let eligible = 0;
    const particleClozes: string[] = [];
    const invariantErrors: string[] = [];
    const apiMismatches: number[] = [];

    for (const row of words) {
      const publicResult = clozeFor(row);
      const analysis = analyzeCloze(row);
      if (JSON.stringify(publicResult) !== JSON.stringify(analysis.result)) apiMismatches.push(row.id);
      if (!analysis.result) {
        const reason = analysis.reason ?? "no_unique_match";
        const entry = failures.get(reason) ?? { count: 0, samples: [] };
        entry.count += 1;
        if (entry.samples.length < 20) {
          const observed = analysis.observed
            ? `（句中 ${analysis.observed.surface} / ${analysis.observed.reading}；词典 ${analysis.observed.expectedSurface} / ${analysis.observed.expectedKana}）`
            : "";
          entry.samples.push(`${formatWord(row)}${observed}：${cleanSample(row.example_jp) || "（无例句）"}`);
        }
        failures.set(reason, entry);
        continue;
      }

      eligible += 1;
      if (/助词|助詞/u.test(row.pos) && /^[ぁ-ゖァ-ヺー]+$/u.test(row.kanji)) {
        particleClozes.push(`${formatWord(row)}：${cleanSample(row.example_jp)}`);
      }
      methods[analysis.matchedBy ?? "surface"] += 1;
      const { cloze, target } = analysis.result;
      const errors: string[] = [];
      if (!checkSpelling(target, cloze.surface).correct) errors.push("surface 判错");
      if (!checkSpelling(target, cloze.reading).correct) errors.push("reading 判错");
      if (cloze.before + cloze.surface + cloze.after !== row.example_jp) errors.push("原句重建不一致");
      if (errors.length && invariantErrors.length < 20) {
        invariantErrors.push(`${formatWord(row)} ${errors.join("、")}：${cleanSample(row.example_jp)}`);
      }

      const kind = classifyInflection(row, cloze.surface, cloze.reading);
      if (kind) {
        const samples = inflections.get(kind) ?? [];
        samples.push(`${formatWord(row)}：${cloze.surface} / ${cloze.reading}；${cleanSample(row.example_jp)}`);
        inflections.set(kind, samples);
      }
    }

    expect(invariantErrors, invariantErrors.join("\n")).toEqual([]);
    expect(particleClozes, particleClozes.slice(0, 10).join("\n")).toEqual([]);
    expect(apiMismatches).toEqual([]);
    const successRate = (eligible * 100 / words.length).toFixed(2);
    const failureReasons: ClozeFailureReason[] = [
      "no_example", "no_translation", "placeholder_word", "ambiguous_match", "no_unique_match",
      "missing_furigana", "invalid_reading", "reading_not_accepted", "surface_not_accepted"
    ];
    const reasonLines = failureReasons.map((reason) => {
      const entry = failures.get(reason);
      return `| ${reason} | ${entry?.count ?? 0} | ${entry?.samples.length ?? 0} |`;
    });
    const methodLines = Object.entries(methods).map(([kind, count]) => `| ${kind} | ${count} |`);
    const inflectionKinds = ["过去", "て形", "否定", "形容词连用", "其他活用"];
    const inflectionLines = inflectionKinds.map((kind) => `| ${kind} | ${inflections.get(kind)?.length ?? 0} |`);
    const selectedInflections: string[] = [];
    for (let sampleIndex = 0; selectedInflections.length < 40; sampleIndex += 1) {
      let found = false;
      for (const kind of inflectionKinds) {
        const sample = inflections.get(kind)?.[sampleIndex];
        if (!sample) continue;
        selectedInflections.push(`- ${kind}：${sample}`);
        found = true;
        if (selectedInflections.length === 40) break;
      }
      if (!found) break;
    }

    const failureSections: string[] = [];
    for (const reason of failureReasons) {
      const entry = failures.get(reason);
      if (!entry?.count) continue;
      failureSections.push(
        `### ${reason}（${entry.count} 条，列出 ${entry.samples.length} 条）`,
        "",
        ...entry.samples.map((sample) => `- ${sample}`),
        ""
      );
    }

    const lines = [
      "# 单词拼写挖空例句全库审计",
      "",
      "数据源：`frontend/public/nihongo.db` 的 10,919 条 `words`。每条依次按词元边界、唯一表记、唯一读音定位；词元边界长度使用 UTF-16，负值功能词不作为挖空目标。",
      "",
      `- 可出题：${eligible} / ${words.length}（${successRate}%）。`,
      `- 不变量：${eligible} 条成功样本的表层、读音均通过 checkSpelling，且 before + surface + after 逐字还原原句；违反数 ${invariantErrors.length}。`,
      `- 纯假名助词出题数：${particleClozes.length}。`,
      "",
      "## 定位来源",
      "",
      "| 来源 | 数量 |",
      "|---|---:|",
      ...methodLines,
      "",
      "## 失败原因",
      "",
      "| 原因 | 数量 | 样例数 |",
      "|---|---:|---:|",
      ...reasonLines,
      "",
      ...failureSections,
      "## 活用形分布",
      "",
      "只统计句中表层不等于词典首选或收录词典写法的项目，按句中读音末尾作粗分类；「食べた / 食べて / 行かない / 美しく」分别落在过去、て形、否定、形容词连用。",
      "",
      "| 类别 | 数量 |",
      "|---|---:|",
      ...inflectionLines,
      "",
      "## 活用形样例",
      "",
      ...selectedInflections,
      ""
    ];
    writeFileSync(reportPath, `${lines.join("\n")}\n`);
  });
});
