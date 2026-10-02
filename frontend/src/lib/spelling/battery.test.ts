import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import initSqlJs, { type Database } from "sql.js";
import { cleanWordSurface } from "../orthography";
import { checkSpelling } from "./check";
import { spellingTargetForWord } from "./forms";
import type { SpellingLookup, SpellingProblemCode, SpellingTarget, SpellingVerdict } from "./types";

type WordRow = { id: number; kanji: string; kana: string; meaning: string };
type CorpusEntry = { word: WordRow; target: SpellingTarget };
type Sample = {
  id: number;
  word: string;
  kana: string;
  input: string;
  expected: string;
  actual: string;
};
type Category = {
  total: number;
  checked: number;
  passed: number;
  exceptions: Sample[];
  failures: Sample[];
  skipped: Sample[];
};
type VariantPayload = { japanese_to_simplified: Record<string, string> };
type ReadingPayload = { units: Array<[number, string, string, string, string, number, number]> };

const HAN = /[㐀-䶿一-鿿豈-﫿々〆\u{20000}-\u{2fa1f}]/u;
const KATAKANA = /[ァ-ヺ]/u;
const KANA = /[ぁ-ゖ゙゚ァ-ヺー]/u;
const SMALL_KANA = new Set([...
  "ぁぃぅぇぉゃゅょゎゕゖァィゥェォャュョヮヵヶ"
]);
const NON_COMBINING = /^[っッんンー]/u;
const NOISE = /[〜～~・\s]/gu;
const READING_SWAPS = ["か", "さ", "た", "な", "は", "ま", "ら", "あ", "い", "う", "え", "お"];
const READING_DELETIONS: SpellingProblemCode[] = ["empty", "too_short", "wrong_reading", "other_reading", "long_vowel", "sokuon", "hatsuon", "source_language"];
const GENERATOR_STYLES = ["hepburn", "nihon", "ime"] as const;
type GeneratorStyle = (typeof GENERATOR_STYLES)[number];

const TEST_BASE: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo", ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "wi", ゑ: "we", を: "o",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
  ゕ: "ka", ゖ: "ke", ゔ: "vu"
};
const TEST_KUNREI: Record<string, string> = { し: "si", ち: "ti", つ: "tu", ふ: "hu", じ: "zi", ぢ: "di", づ: "du" };
const TEST_COMPOUNDS: Record<string, string> = {
  てぃ: "thi", でぃ: "di", ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  うぁ: "wa", うぃ: "wi", うぇ: "we", うぉ: "wo", ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo", ゔゅ: "vyu",
  しぇ: "she", じぇ: "je", ちぇ: "che", つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
  てゅ: "tyu", とぅ: "twu", でゅ: "dyu", どぅ: "dwu", ぢゃ: "dya", ぢゅ: "dyu", ぢょ: "dyo"
};
const TEST_YOON: Record<string, Record<string, string>> = {
  し: { a: "sha", u: "shu", o: "sho" },
  ち: { a: "cha", u: "chu", o: "cho" },
  じ: { a: "ja", u: "ju", o: "jo" }
};
const TEST_VOWEL: Record<string, string> = {
  あ: "a", か: "a", さ: "a", た: "a", な: "a", は: "a", ま: "a", や: "a", ら: "a", わ: "a", が: "a", ざ: "a", だ: "a", ば: "a", ぱ: "a",
  い: "i", き: "i", し: "i", ち: "i", に: "i", ひ: "i", み: "i", り: "i", ぎ: "i", じ: "i", ぢ: "i", び: "i", ぴ: "i",
  う: "u", く: "u", す: "u", つ: "u", ぬ: "u", ふ: "u", む: "u", ゆ: "u", る: "u", ぐ: "u", ず: "u", づ: "u", ぶ: "u", ぷ: "u", ゔ: "u",
  え: "e", け: "e", せ: "e", て: "e", ね: "e", へ: "e", め: "e", れ: "e", げ: "e", ぜ: "e", で: "e", べ: "e", ぺ: "e",
  お: "o", こ: "o", そ: "o", と: "o", の: "o", ほ: "o", も: "o", よ: "o", ろ: "o", ご: "o", ぞ: "o", ど: "o", ぼ: "o", ぽ: "o",
  ぁ: "a", ゃ: "a", ゎ: "a", ぃ: "i", ぅ: "u", ゅ: "u", ぇ: "e", ぉ: "o", ょ: "o"
};
const readJson = <T>(url: URL): T => JSON.parse(readFileSync(url, "utf8")) as T;

let db: Database;
let corpus: CorpusEntry[] = [];
let simplifiedForms: Record<string, string>;
const kanjiReadings = new Map<string, string[]>();
const kanjiLevels = new Map<string, number>();
const commonKanjiByLevel = new Map<number, string[]>();

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database(new Uint8Array(readFileSync(new URL("../../../public/nihongo.db", import.meta.url))));
  const result = db.exec("SELECT id, kanji, kana, meaning FROM words ORDER BY id")[0];
  if (!result) throw new Error("nihongo.db 没有 words 表或词条");
  const positions = Object.fromEntries(result.columns.map((name, index) => [name, index]));
  const rows: WordRow[] = result.values.map((row) => ({
    id: Number(row[positions.id]),
    kanji: String(row[positions.kanji]),
    kana: String(row[positions.kana]),
    meaning: String(row[positions.meaning])
  }));
  corpus = rows.map((word) => ({ word, target: spellingTargetForWord(word) }));
  simplifiedForms = readJson<VariantPayload>(new URL("../../data/kanji_variants.json", import.meta.url)).japanese_to_simplified;
  const readingData = readJson<ReadingPayload>(new URL("../../data/kanji_reading_unit_runtime.json", import.meta.url));
  for (const unit of readingData.units) {
    const [type, character, reading] = [unit[0], unit[1], independentHiragana(unit[2])];
    const level = unit[6];
    if (type === 0 && HAN.test(character) && Number.isInteger(level)) {
      kanjiLevels.set(character, Math.min(kanjiLevels.get(character) ?? level, level));
    }
    if (!HAN.test(character) || !reading || !/^[ぁ-ゖー]+$/u.test(reading)) continue;
    const options = kanjiReadings.get(character) ?? [];
    if (!options.includes(reading)) options.push(reading);
    kanjiReadings.set(character, options);
  }
  const frequencies = new Map<string, number>();
  for (const { target } of corpus) {
    for (const form of target.forms) {
      for (const char of form.surface) if (HAN.test(char)) frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
    }
  }
  for (const character of frequencies.keys()) {
    const level = kanjiLevels.get(character) ?? 5;
    const group = commonKanjiByLevel.get(level) ?? [];
    group.push(character);
    commonKanjiByLevel.set(level, group);
  }
  for (const group of commonKanjiByLevel.values()) {
    group.sort((a, b) => frequencies.get(b)! - frequencies.get(a)! || a.localeCompare(b));
  }
});

afterAll(() => db?.close());

const independentHiragana = (text: string): string => [...text].map((char) => {
  const point = char.codePointAt(0) ?? 0;
  return point >= 0x30a1 && point <= 0x30f6 ? String.fromCodePoint(point - 0x60) : char;
}).join("");

const independentKatakana = (text: string): string => [...text].map((char) => {
  const point = char.codePointAt(0) ?? 0;
  return point >= 0x3041 && point <= 0x3096 ? String.fromCodePoint(point + 0x60) : char;
}).join("");

const simplifiedVariants = (surface: string, map: Record<string, string>): string[] => {
  let variants = [""];
  for (const char of surface) {
    const choices = map[char]?.split("/") ?? [char];
    variants = variants.flatMap((prefix) => choices.map((choice) => prefix + choice));
  }
  return variants.filter((variant) => variant !== surface);
};

const independentMoras = (raw: string): string[] => {
  const out: string[] = [];
  for (const char of independentHiragana(raw.normalize("NFKC").replace(NOISE, "").replace(/\s+/gu, ""))) {
    const previous = out[out.length - 1];
    if (SMALL_KANA.has(char) && previous && !NON_COMBINING.test(previous)) out[out.length - 1] = previous + char;
    else out.push(char);
  }
  return out;
};

const independentNativeMoras = (raw: string): string[] => {
  const out: string[] = [];
  for (const char of raw.normalize("NFKC").replace(NOISE, "").replace(/\s+/gu, "")) {
    const previous = out[out.length - 1];
    if (SMALL_KANA.has(char) && previous && !NON_COMBINING.test(previous)) out[out.length - 1] = previous + char;
    else out.push(char);
  }
  return out;
};

const vowelOf = (mora: string): string => {
  const chars = [...mora];
  return TEST_VOWEL[independentHiragana(chars[chars.length - 1] ?? "")] ?? "";
};

const moraSpelling = (mora: string, style: GeneratorStyle): string => {
  if (TEST_COMPOUNDS[mora]) return TEST_COMPOUNDS[mora];
  const chars = [...mora];
  if (chars.length === 2 && ["ゃ", "ゅ", "ょ"].includes(chars[1])) {
    const vowel = chars[1] === "ゃ" ? "a" : chars[1] === "ゅ" ? "u" : "o";
    const special = TEST_YOON[chars[0]]?.[vowel];
    if (special) {
      if (style === "nihon" && chars[0] === "し") return `s${chars[1] === "ゃ" ? "ya" : chars[1] === "ゅ" ? "yu" : "yo"}`;
      if (style === "nihon" && chars[0] === "ち") return `t${chars[1] === "ゃ" ? "ya" : chars[1] === "ゅ" ? "yu" : "yo"}`;
      if (style === "nihon" && chars[0] === "じ") return `z${chars[1] === "ゃ" ? "ya" : chars[1] === "ゅ" ? "yu" : "yo"}`;
      return special;
    }
    const base = TEST_BASE[chars[0]] ?? "";
    const stem = base.endsWith("i") ? base.slice(0, -1) : "";
    return stem ? `${stem}${chars[1] === "ゃ" ? "ya" : chars[1] === "ゅ" ? "yu" : "yo"}` : mora;
  }
  const base = TEST_BASE[chars[0]] ?? mora;
  return style === "nihon" ? TEST_KUNREI[chars[0]] ?? base : base;
};

const geminate = (spelling: string): string => {
  if (spelling.startsWith("ch")) return `t${spelling}`;
  if (spelling.startsWith("sh")) return `s${spelling}`;
  if (spelling.startsWith("ts")) return `t${spelling}`;
  return /^[bcdfghjklmnpqrstvwxyz]/u.test(spelling) ? `${spelling[0]}${spelling}` : "xtu";
};

/** 测试专用转写器自带假名、组合音和促音表，不调用生产罗马音候选或拍切分。 */
const independentRomaji = (raw: string, style: GeneratorStyle): string => {
  const moras = independentMoras(raw);
  let result = "";
  let previousVowel = "";
  for (let i = 0; i < moras.length; i += 1) {
    const mora = moras[i];
    if (mora === "ー") {
      result += style === "ime" ? "-" : previousVowel;
      continue;
    }
    if (mora === "っ") {
      if (style === "ime") result += "xtu";
      else if (moras[i + 1]) {
        const next = moraSpelling(moras[i + 1], style);
        if (/^[bcdfghjklmnpqrstvwxyz]/u.test(next)) {
          result += geminate(next);
          previousVowel = vowelOf(moras[i + 1]);
          i += 1;
        } else result += "xtu";
      } else result += "xtu";
      continue;
    }
    if (mora === "ん") {
      const next = moras[i + 1] ? independentHiragana(moras[i + 1]) : "";
      result += style !== "hepburn" ? "nn" : /^[あいうえおやゆよ]/u.test(next) ? "n'" : "n";
      continue;
    }
    const spelling = moraSpelling(mora, style);
    result += spelling;
    const moraChars = [...mora];
    const finalKana = independentHiragana(moraChars[moraChars.length - 1] ?? "");
    previousVowel = TEST_VOWEL[finalKana] ?? (/[aeiou]$/u.test(spelling) ? spelling.slice(-1) : previousVowel);
  }
  return result;
};

const codeOf = (result: SpellingVerdict): SpellingProblemCode | undefined => result.problems[0]?.code;
const actualOf = (result: SpellingVerdict): string =>
  `${result.correct ? "correct" : codeOf(result) ?? "no_problem"}; nearMiss=${result.nearMiss}; readingOk=${result.readingOk}`;
const sampleOf = (entry: CorpusEntry, input: string, expected: string, actual: string): Sample => ({
  id: entry.word.id,
  word: cleanWordSurface(entry.word.kanji),
  kana: entry.target.kana,
  input,
  expected,
  actual
});
const normalizedWriting = (text: string): string => text.normalize("NFKC").replace(NOISE, "").replace(/\s+/gu, "");
const kanjiSequence = (text: string): string => [...text].filter((char) => HAN.test(char)).join("");
const addCategory = (categories: Map<string, Category>, name: string): Category => {
  const existing = categories.get(name);
  if (existing) return existing;
  const category = { total: 0, checked: 0, passed: 0, exceptions: [], failures: [], skipped: [] };
  categories.set(name, category);
  return category;
};
const record = (
  categories: Map<string, Category>, name: string, entry: CorpusEntry, input: string,
  expected: string, result: SpellingVerdict, ok: boolean, outcome: "checked" | "exception" | "skipped" = "checked"
): void => {
  const category = addCategory(categories, name);
  category.total += 1;
  const sample = sampleOf(entry, input, expected, actualOf(result));
  if (outcome === "exception") { category.exceptions.push(sample); return; }
  if (outcome === "skipped") { category.skipped.push(sample); return; }
  category.checked += 1;
  if (ok) category.passed += 1;
  else category.failures.push(sample);
};

const readingMutationCodeIsReasonable = (kind: "swap" | "delete" | "add", code: SpellingProblemCode | undefined): boolean => {
  const expected: Record<typeof kind, SpellingProblemCode[]> = {
    swap: ["wrong_reading", "other_reading", "long_vowel", "sokuon", "hatsuon"],
    delete: READING_DELETIONS,
    add: ["too_long", "wrong_reading", "other_reading", "long_vowel", "sokuon", "hatsuon", "script"]
  };
  return code !== undefined && expected[kind].includes(code);
};

const writeTailStart = (surface: string): number => {
  const chars = [...surface];
  for (let i = chars.length - 1; i >= 0; i -= 1) if (HAN.test(chars[i])) return i + 1;
  return chars.length;
};

const kanjiReadingAlignment = (surface: string, kana: string): Array<{ index: number; reading: string }> | null => {
  const chars = [...surface];
  const reading = independentHiragana(kana).replace(NOISE, "");
  const failed = new Set<string>();
  const walk = (charIndex: number, kanaIndex: number): Array<{ index: number; reading: string }> | null => {
    if (charIndex === chars.length) return kanaIndex === reading.length ? [] : null;
    const key = `${charIndex}:${kanaIndex}`;
    if (failed.has(key)) return null;
    const char = chars[charIndex];
    const options = HAN.test(char) ? kanjiReadings.get(char) ?? [] : [independentHiragana(char)];
    for (const option of options) {
      if (!option || !reading.startsWith(option, kanaIndex)) continue;
      const rest = walk(charIndex + 1, kanaIndex + option.length);
      if (rest) return HAN.test(char) ? [{ index: charIndex, reading: option }, ...rest] : rest;
    }
    failed.add(key);
    return null;
  };
  return walk(0, 0);
};

const formatSample = (sample: Sample): string =>
  `- #${sample.id} ${sample.word}（${sample.kana}），输入 \`${sample.input}\`：期望 ${sample.expected}，实际 ${sample.actual}`;

const renderReport = (
  categories: Map<string, Category>, observations: Map<string, Sample[]>, totalWords: number
): string => {
  const lines = [
    "# 单词拼写真实词库全量压测",
    "",
    "> 生成命令：`cd frontend && SPELLING_BATTERY_REPORT=1 npx vitest run src/lib/spelling/battery.test.ts`。样例段落列出全部失败、例外和未能安全造例的写法。",
    "",
    `- 数据源：\`frontend/public/nihongo.db\`，${totalWords.toLocaleString("en-US")} 条 words。`,
    "- 罗马音由测试内独立转写器生成；简体变体由 `kanji_variants.json` 的 `japanese_to_simplified` 生成。汉字替换按运行时字音索引的 JLPT 级别挑字，并按真实词库表记频次排序。",
    "",
    "## 各类统计",
    "",
    "| 类别 | 生成数 | 硬断言数 | 通过 | 失败 | 例外 | 未生成 | 通过率 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|"
  ];
  for (const [name, category] of categories) {
    const rate = category.checked ? `${(category.passed * 100 / category.checked).toFixed(2)}%` : "n/a";
    lines.push(`| ${name} | ${category.total} | ${category.checked} | ${category.passed} | ${category.failures.length} | ${category.exceptions.length} | ${category.skipped.length} | ${rate} |`);
  }
  lines.push("", "## 失败样例（完整）", "");
  for (const [name, category] of categories) {
    if (!category.failures.length) continue;
    lines.push(`### ${name}`, "", ...category.failures.map(formatSample), "");
  }
  if (![...categories.values()].some((category) => category.failures.length)) lines.push("无。", "");
  lines.push("## 规格 / 数据口径例外", "");
  for (const [name, category] of categories) {
    if (!category.exceptions.length) continue;
    lines.push(`### ${name}`, "", ...category.exceptions.map(formatSample), "");
  }
  if (![...categories.values()].some((category) => category.exceptions.length)) lines.push("无。", "");
  lines.push("## 暂未安全生成的变异", "");
  for (const [name, category] of categories) {
    if (!category.skipped.length) continue;
    lines.push(`### ${name}`, "", ...category.skipped.map(formatSample), "");
  }
  if (![...categories.values()].some((category) => category.skipped.length)) lines.push("无。", "");
  lines.push("## 同音词互斥检查", "");
  for (const [name, samples] of observations) {
    lines.push(`### ${name}（${samples.length}）`, "", ...(samples.length ? samples.map(formatSample) : ["无。"]), "");
  }
  lines.push(
    "## 取舍与待拍板",
    "",
    "- §1.6 明确禁止把外来语词源当正确拼写，故 `cleanWordSurface(kanji)` 若是词源或包含多条以分号 / 圆括号标出的词典别名，不作为正确答案断言；具体词条列在例外中。其它单一清理表记仍要求命中。",
    "- §1.2 接受目标读音的假名，故同音词 B 的标准表记若本身就是与 A 同音的纯假名，无法同时拒绝它；这类冲突列为可辨识性例外。B 的汉字表记仍要求拒绝并诊断为 `homophone`。",
    "- 逐字汉字读音从运行时 `kanji_reading_unit_runtime.json` 的读音片段对齐。多汉字词若该索引没有唯一可对齐的读音片段，记录为未生成；不猜读音，避免把错误的交ぜ書き当成规格失败。",
    "- `okurigana` 变异若恰好命中同词另一条已收录写法，按 §1.5 接受集合优先，列为例外而不记 false accept。",
    "- 汉字替换 `損なう` → `害なう` 对应同词 `rare` 写法 `害う`，故它按 §2 优先诊断为 `okurigana`，不是误把替换字判对；该项列在例外中。",
    "",
    "## 修复记录",
    "",
    "- `frontend/src/lib/spelling/check.ts:187`：`classifyInput` 把含数字 / 标注的合法字面写法分到 `other`，原先直接报 `mixed_scripts`；现先匹配本词 `target.forms`，再做目标上下文简体诊断。回归例：`１日` / `1日`。",
    "- `frontend/src/lib/spelling/kanji-form.ts:66`、`frontend/src/lib/spelling/check.ts:78`：单字反查对「动」这类一简对多日字缺少上下文；现对每条接受写法逐字验证简体变体，再报对应的日文字形。回归例：`運動` / `働く`。",
    "- `frontend/src/lib/spelling/check.ts:138`：首轮删除 / 增加送り仮名变异分别有 52 / 102 例被前置的 `partial_kana` 抢先诊断；现先检查相同汉字序列的送り仮名，再判交ぜ書き。回归覆盖前置假名词形与变长词尾。",
    ""
  );
  return lines.join("\n");
};

describe("拼写判定真实词库全量电池", () => {
  it("遍历全部词条、收集各类失败并生成复核报告", () => {
    const started = performance.now();
    const categories = new Map<string, Category>();
    const observations = new Map<string, Sample[]>([
      ["已在 A.forms 中的同音词标准表记", []],
      ["与 A 读音相同、只能按合法假名读音接受的 B 表记", []],
      ["带词性注记、不能作为标准输入的 B 表记", []]
    ]);
    const callTimes: number[] = [];

    for (const entry of corpus) {
      const { target, word } = entry;
      const roman = GENERATOR_STYLES.map((style) => independentRomaji(target.kana, style));
      const start = performance.now();
      const kanaResult = checkSpelling(target, target.kana);
      callTimes.push(performance.now() - start);
      record(categories, "目标读音假名", entry, target.kana, "correct", kanaResult, kanaResult.correct);
      for (const [index, style] of GENERATOR_STYLES.entries()) {
        const result = checkSpelling(target, roman[index]);
        record(categories, `${style} 罗马音`, entry, roman[index], "correct", result, result.correct);
        if (target.isLoanword) record(categories, "外来语罗马音", entry, roman[index], "correct", result, result.correct);
      }

      for (const form of target.forms) {
        const result = checkSpelling(target, form.surface);
        // 规格 §1.5：罕用写法若本身就是中文简体 / 繁体字形（烟草、无、聯絡），报 chinese_form（直接判错）/ traditional_form（nearMiss），
        // 对学习者不算对。记成例外，报告里列全，不算硬断言失败。
        const chineseRare = form.tag === "rare" && !result.correct &&
          ["chinese_form", "traditional_form"].includes(result.problems[0]?.code ?? "");
        record(categories, "target.forms 全部书写", entry, form.surface, `correct/${form.tag}`, result, result.correct, chineseRare ? "exception" : "checked");
      }

      const cleanSurface = cleanWordSurface(word.kanji);
      const cleanResult = checkSpelling(target, cleanSurface);
      const sourceAlias = target.isLoanword && !!target.sourceText &&
        cleanSurface.toLowerCase().replace(/[^a-z0-9]/gu, "") === target.sourceText.toLowerCase().replace(/[^a-z0-9]/gu, "");
      const multiAlias = /[;；()（）]/u.test(cleanSurface) && !target.forms.some((form) => normalizedWriting(form.surface) === normalizedWriting(cleanSurface));
      const normalizedClean = cleanSurface.normalize("NFKC");
      const mixedLatinKana = /[A-Za-z]/u.test(normalizedClean) && /[ぁ-ゖァ-ヺ]/u.test(normalizedClean);
      const cleanException = !cleanResult.correct && (sourceAlias || multiAlias || mixedLatinKana);
      record(
        categories, "cleanWordSurface(kanji)", entry, cleanSurface,
        sourceAlias ? "source_language per §1.6" : multiAlias ? "multiple / labelled dictionary surfaces" : mixedLatinKana ? "mixed Latin / kana is other per §1.1" : "correct",
        cleanResult, cleanResult.correct || cleanException, cleanException ? "exception" : "checked"
      );

      if (target.isLoanword) {
        record(categories, "外来语片假名", entry, target.kana, "correct", kanaResult, kanaResult.correct);
        const hiragana = independentHiragana(target.kana);
        const hiraResult = checkSpelling(target, hiragana);
        record(categories, "外来语写平假名", entry, hiragana, "script", hiraResult, !hiraResult.correct && codeOf(hiraResult) === "script" && hiraResult.nearMiss);
      }
      if (!target.isLoanword && /^[ぁ-ゖ゙゚ー]+$/u.test(target.kana)) {
        const katakana = independentKatakana(target.kana);
        const kataResult = checkSpelling(target, katakana);
        record(categories, "平假名词写片假名", entry, katakana, "script", kataResult, !kataResult.correct && codeOf(kataResult) === "script" && kataResult.nearMiss);
      }

      const moras = independentMoras(target.kana);
      const nativeMoras = independentNativeMoras(target.kana);
      if (moras.length) {
        const replacement = READING_SWAPS.find((candidate) => candidate !== moras[moras.length - 1]);
        const finalMoraIsKatakana = [...(nativeMoras[nativeMoras.length - 1] ?? "")].some((char) => KATAKANA.test(char));
        const changedKana = [...nativeMoras.slice(0, -1), finalMoraIsKatakana ? independentKatakana(replacement!) : replacement!].join("");
        const kanaSwap = checkSpelling(target, changedKana);
        record(categories, "假名读音换一拍", entry, changedKana, "incorrect with a reading diagnostic", kanaSwap,
          !kanaSwap.correct && readingMutationCodeIsReasonable("swap", codeOf(kanaSwap)));
        const romanSwapInput = independentRomaji(changedKana, "hepburn");
        const romanSwap = checkSpelling(target, romanSwapInput);
        record(categories, "罗马音读音换一拍", entry, romanSwapInput, "incorrect with a reading diagnostic", romanSwap,
          !romanSwap.correct && readingMutationCodeIsReasonable("swap", codeOf(romanSwap)));

        const deletedKana = nativeMoras.slice(0, -1).join("");
        const kanaDelete = checkSpelling(target, deletedKana);
        record(categories, "假名读音删一拍", entry, deletedKana, "incorrect with a reading diagnostic", kanaDelete,
          !kanaDelete.correct && readingMutationCodeIsReasonable("delete", codeOf(kanaDelete)));
        const romanDeleteInput = independentRomaji(deletedKana, "hepburn");
        const romanDelete = checkSpelling(target, romanDeleteInput);
        record(categories, "罗马音读音删一拍", entry, romanDeleteInput, "incorrect with a reading diagnostic", romanDelete,
          !romanDelete.correct && readingMutationCodeIsReasonable("delete", codeOf(romanDelete)));

        const extra = finalMoraIsKatakana ? "ア" : "あ";
        const addedKana = `${target.kana}${extra}`;
        const kanaAdd = checkSpelling(target, addedKana);
        record(categories, "假名读音加一拍", entry, addedKana, "incorrect with a reading diagnostic", kanaAdd,
          !kanaAdd.correct && readingMutationCodeIsReasonable("add", codeOf(kanaAdd)));
        const romanAddInput = independentRomaji(addedKana, "hepburn");
        const romanAdd = checkSpelling(target, romanAddInput);
        record(categories, "罗马音读音加一拍", entry, romanAddInput, "incorrect with a reading diagnostic", romanAdd,
          !romanAdd.correct && readingMutationCodeIsReasonable("add", codeOf(romanAdd)));
      } else {
        addCategory(categories, "假名读音换一拍").skipped.push(sampleOf(entry, target.kana, "one mora", "empty reading"));
        addCategory(categories, "罗马音读音换一拍").skipped.push(sampleOf(entry, "", "one mora", "empty reading"));
      }
    }

    const byReading = new Map<string, CorpusEntry[]>();
    for (const entry of corpus) {
      const key = independentHiragana(entry.target.kana).replace(NOISE, "");
      const group = byReading.get(key) ?? [];
      group.push(entry);
      byReading.set(key, group);
    }
    for (const group of byReading.values()) {
      if (group.length < 2) continue;
      for (const a of group) for (const b of group) {
        if (a.word.id === b.word.id) continue;
        const bStandard = b.target.forms.find((form) => form.tag === "standard")?.surface ?? b.target.surface;
        const inAForms = a.target.forms.some((form) => normalizedWriting(form.surface) === normalizedWriting(bStandard));
        const lookup: SpellingLookup = {
          bySurface: (surface) => normalizedWriting(surface) === normalizedWriting(bStandard)
            ? [{ wordId: b.word.id, surface: bStandard, kana: b.target.kana, meaning: b.word.meaning }]
            : [],
          peers: () => []
        };
        const result = checkSpelling(a.target, bStandard, lookup);
        if (inAForms) {
          observations.get("已在 A.forms 中的同音词标准表记")!.push(sampleOf(a, bStandard, "allowed overlap: in A.forms", actualOf(result)));
          record(categories, "同音词标准表记互斥", a, bStandard, "exception: in A.forms", result, result.correct, "exception");
        } else if (result.form === "other" && /[()（）]/u.test(bStandard) && codeOf(result) === "mixed_scripts") {
          observations.get("带词性注记、不能作为标准输入的 B 表记")!.push(sampleOf(a, bStandard, "dictionary label, not a spelling", actualOf(result)));
          record(categories, "同音词标准表记互斥", a, bStandard, "exception: dictionary label", result, true, "exception");
        } else if (!HAN.test(bStandard) && result.correct) {
          observations.get("与 A 读音相同、只能按合法假名读音接受的 B 表记")!.push(sampleOf(a, bStandard, "same-reading kana is also A's valid reading", actualOf(result)));
          record(categories, "同音词标准表记互斥", a, bStandard, "exception: indistinguishable valid reading", result, true, "exception");
        } else {
          const acceptableDiagnostic = ["homophone", "wrong_kanji", "script", "chinese_form", "traditional_form"].includes(codeOf(result) ?? "");
          record(categories, "同音词标准表记互斥", a, bStandard, "incorrect; homophone / wrong_kanji", result,
            !result.correct && acceptableDiagnostic);
        }
      }
    }

    for (const entry of corpus) {
      const { target } = entry;
      for (const form of target.forms) {
        if (!HAN.test(form.surface)) continue;
        const chars = [...form.surface];
        const kanjiIndex = chars.findIndex((char) => HAN.test(char));
        const replacement = (commonKanjiByLevel.get(kanjiLevels.get(chars[kanjiIndex]) ?? 5) ?? []).find((char) =>
          char !== chars[kanjiIndex] && !Object.prototype.hasOwnProperty.call(simplifiedForms, char) &&
          !target.forms.some((accepted) => normalizedWriting(accepted.surface) === normalizedWriting(chars.map((item, index) => index === kanjiIndex ? char : item).join("")))
        );
        if (replacement) {
          const input = chars.map((char, index) => index === kanjiIndex ? replacement : char).join("");
          const result = checkSpelling(target, input);
          const alternateOkurigana = target.forms.some((accepted) =>
            kanjiSequence(accepted.surface) === kanjiSequence(input) &&
            normalizedWriting(accepted.surface) !== normalizedWriting(input) &&
            [...accepted.surface].slice(writeTailStart(accepted.surface)).join("") !== [...input].slice(writeTailStart(input)).join("")
          );
          const problemCode = codeOf(result);
          const suffixDiagnostic = alternateOkurigana && (problemCode === "okurigana" || problemCode === "conjugated");
          const expectedCodes: SpellingProblemCode[] = result.form === "other"
            ? ["mixed_scripts"]
            : ["wrong_kanji", "homophone"];
          record(categories, "汉字换成同级常用字", entry, input, "wrong_kanji", result,
            !result.correct && (problemCode !== undefined && expectedCodes.includes(problemCode) ||
              suffixDiagnostic), suffixDiagnostic ? "exception" : "checked");
        } else {
          record(categories, "汉字换成同级常用字", entry, form.surface, "replacement glyph", checkSpelling(target, form.surface), false, "skipped");
        }

        const hanCount = chars.filter((char) => HAN.test(char)).length;
        const tailStart = writeTailStart(form.surface);
        const eligibleMixed = hanCount >= 2 || (hanCount === 1 && tailStart < chars.length);
        if (eligibleMixed) {
          const alignment = kanjiReadingAlignment(form.surface, target.kana);
          const selected = alignment?.find((part) => part.index >= 0 && part.reading);
          if (selected) {
            const input = [...chars.slice(0, selected.index), selected.reading, ...chars.slice(selected.index + 1)].join("");
            const result = checkSpelling(target, input);
            const overlaps = target.forms.some((accepted) => normalizedWriting(accepted.surface) === normalizedWriting(input));
            const fullReading = independentHiragana(input).replace(NOISE, "") === independentHiragana(target.kana).replace(NOISE, "");
            const readableOverlap = result.correct && fullReading;
            const reasonableCodes: SpellingProblemCode[] = ["partial_kana", "script", "okurigana"];
            const resultCode = codeOf(result);
            record(categories, "汉字按本词读音换成假名", entry, input, "partial_kana", result,
              overlaps || readableOverlap || (!result.correct && resultCode !== undefined && reasonableCodes.includes(resultCode)),
              overlaps || readableOverlap ? "exception" : "checked");
          } else {
            record(categories, "汉字按本词读音换成假名", entry, form.surface, "aligned character reading", checkSpelling(target, form.surface), false, "skipped");
          }
        }

        const tail = chars.slice(tailStart);
        if (tail.length && tail.every((char) => KANA.test(char))) {
          const input = [...chars.slice(0, -1)].join("");
          const result = checkSpelling(target, input);
          const overlaps = target.forms.some((accepted) => normalizedWriting(accepted.surface) === normalizedWriting(input));
          const allowedCodes = result.form === "other" ? ["mixed_scripts"] : ["okurigana", "conjugated"];
          record(categories, "删除一个送り仮名", entry, input, "okurigana / conjugated", result,
            overlaps || (!result.correct && allowedCodes.includes(codeOf(result) ?? "")), overlaps ? "exception" : "checked");
        }
        const readingChars = [...independentHiragana(target.kana).replace(NOISE, "")];
        const lastReadingKana = readingChars[readingChars.length - 1] ?? "";
        const finalWrittenChar = chars[chars.length - 1] ?? "";
        if (/^[ぁ-ゖ゙゚]$/u.test(lastReadingKana)) {
          const added = KATAKANA.test(finalWrittenChar) ? independentKatakana(lastReadingKana) : lastReadingKana;
          const addedInput = `${form.surface}${added}`;
          const addedResult = checkSpelling(target, addedInput);
          const addedOverlap = target.forms.some((accepted) => normalizedWriting(accepted.surface) === normalizedWriting(addedInput));
          const allowedCodes = addedResult.form === "other" ? ["mixed_scripts"] : ["okurigana", "conjugated", "too_long"];
          record(categories, "多加一个送り仮名", entry, addedInput, "okurigana / conjugated / too_long", addedResult,
            addedOverlap || (!addedResult.correct && allowedCodes.includes(codeOf(addedResult) ?? "")),
            addedOverlap ? "exception" : "checked");
        }

        for (const simplified of simplifiedVariants(form.surface, simplifiedForms)) {
          const simplifiedResult = checkSpelling(target, simplified);
          const overlap = target.forms.some((accepted) => normalizedWriting(accepted.surface) === normalizedWriting(simplified));
          record(categories, "简体字形变体", entry, simplified, "chinese_form（直接判错，非 nearMiss）", simplifiedResult,
            overlap || (!simplifiedResult.correct && codeOf(simplifiedResult) === "chinese_form" && !simplifiedResult.nearMiss),
            overlap ? "exception" : "checked");
        }
      }
    }

    const elapsed = performance.now() - started;
    const report = renderReport(categories, observations, corpus.length);
    // 报告 7000 多行，默认不写（每次跑测试都改工作区太吵）：SPELLING_BATTERY_REPORT=1 才重新生成
    if (process.env.SPELLING_BATTERY_REPORT === "1") writeFileSync(new URL("../../../../docs/audits/2026-10-03-spelling-battery.md", import.meta.url), report);
    for (const [name, category] of categories) {
      console.info(`[battery] ${name}: ${category.passed}/${category.checked} passed; ${category.failures.length} failures; ${category.exceptions.length} exceptions; ${category.skipped.length} skipped`);
      if (category.failures.length) console.info(`[battery] ${name} first 30: ${JSON.stringify(category.failures.slice(0, 30))}`);
    }
    console.info(`[battery] report: docs/audits/2026-10-03-spelling-battery.md; elapsed=${elapsed.toFixed(1)}ms; p50=${callTimes.sort((a, b) => a - b)[Math.floor(callTimes.length * 0.5)]?.toFixed(4)}ms; p99=${callTimes[Math.floor(callTimes.length * 0.99)]?.toFixed(4)}ms`);

    expect(corpus).toHaveLength(10919);
    expect([...categories].map(([name, category]) => [name, category.failures]).filter(([, failures]) => (failures as Sample[]).length > 0))
      .toEqual([]);
  }, 60000);
});
