#!/usr/bin/env node
/*
 * Build sentence-level furigana once, outside the shipped application.
 *
 * The tokenizer and its IPADIC dictionary are dev-only dependencies. The
 * output is stored in SQLite as JSON ruby spans plus compact token-length
 * strings, so the runtime only slices strings and renders ruby elements.
 *
 * Usage (from frontend/):
 *   node scripts/build-furigana.mjs
 *   node scripts/build-furigana.mjs --report-only
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import initSqlJs from "sql.js";
import { findPopulatedUserTables } from "./user-data-tables.mjs";
import { buildTokenMetadata } from "./token-bunsetsu.mjs";

const require = createRequire(import.meta.url);
const kuromoji = require("kuromoji");

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.join(here, "..");
const grammarTsPath = path.join(frontend, "src/data/grammar.ts");
const grammarSeedPath = path.join(frontend, "src/data/grammar_seed.json");
const wordSeedPath = path.join(frontend, "src/data/jlpt_words_seed.json");
const exampleOverridesPath = path.join(frontend, "src/data/jlpt_example_overrides.json");
const furiganaOverridesPath = path.join(frontend, "src/data/furigana_overrides.json");
const grammarTitleFuriganaPath = path.join(frontend, "src/data/grammar_title_furigana.json");
const reportPath = path.join(frontend, "../tmp/furigana-audit.json");
const dbPaths = [
  path.join(frontend, "public/nihongo.db"),
  path.join(frontend, "ios/App/App/public/nihongo.db")
];

// 注音内容一变就要升版本,否则老库的 ensureFuriganaAnnotations 直接早退,
// 装过旧版的人会永远停在旧读音上。同一个字符串有三份拷贝,改就三处一起改:
// 这里、scripts/bake-seed-db.mjs、src/lib/study-core.ts,外加
// src/data/furigana_overrides.json 的 version(对不上会直接抛错,是有意的)。
export const FURIGANA_VERSION = "2026-08-15-kuromoji-ipadic-v5-bunsetsu-morph-v1";
const GRAMMAR_DATASET_VERSION = "2026-08-15-grammar-rewrite-v2";

const hasKanji = (text) => /[\u3400-\u9fff々〇]/u.test(String(text ?? ""));
// 语法标题里有少量为中文解释的括号（例如「基数詞（基数词）」）。
// 这些字不是日语学习目标，先用等长空格屏蔽，既保留原字符串下标，
// 又避免 kuromoji 把中文解释误判成日语读音。
const chineseTitleOnlyChars = /[词读动类语顿]/u;
const maskChineseTitleNotes = (title) => {
  let masked = String(title ?? "").replace(/（[^（）]*）|\([^()]*\)/gu, (segment) => {
    const inner = segment.slice(1, -1);
    return chineseTitleOnlyChars.test(inner) ? " ".repeat(segment.length) : segment;
  });
  masked = masked.replace(/[\u3400-\u9fff々〇]+/gu, (run) => {
    const simplified = run.search(chineseTitleOnlyChars);
    if (simplified < 0) return run;
    // 「可能助动词」「敬語助动词」前面的日语术语仍然保留；
    // 中文部分从「助」开始屏蔽，避免把 助 误标成「すけ」。
    const chineseStart = simplified > 0 && run[simplified - 1] === "助" ? simplified - 1 : 0;
    return run.slice(0, chineseStart) + " ".repeat(run.length - chineseStart);
  });
  return masked;
};
const toHiragana = (text) => String(text ?? "").replace(/[ァ-ヶ]/g, (char) => (
  String.fromCodePoint((char.codePointAt(0) ?? 0) - 0x60)
));
const normalizeKana = (text) => toHiragana(text).replace(/ヵ/g, "か").replace(/ヶ/g, "け");
const sourceKey = (kanji, kana) => `${kanji}\u0000${kana}`;

const loadGrammarPoints = () => {
  let source = readFileSync(grammarTsPath, "utf8")
    .replace(/^import[^\n]+\n/, "")
    .replace("const GRAMMAR_POINTS: GrammarPoint[] =", "globalThis.GRAMMAR_POINTS =")
    .replace(/export const grammarPoints = GRAMMAR_POINTS;\s*$/, "");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: grammarTsPath });
  if (!Array.isArray(sandbox.GRAMMAR_POINTS)) throw new Error("无法读取 grammar.ts 的 GRAMMAR_POINTS");
  return sandbox.GRAMMAR_POINTS;
};

const loadOverrides = () => {
  const payload = JSON.parse(readFileSync(furiganaOverridesPath, "utf8"));
  if (payload.version !== FURIGANA_VERSION) {
    throw new Error(`furigana_overrides.json 版本 ${payload.version ?? "(无)"} != ${FURIGANA_VERSION}`);
  }
  const maps = {
    word: new Map(),
    grammar: new Map(),
    grammarTitle: new Map(),
    // 读音级规则：不用手写整句注音数组，改一个字的读音就写一条。
    readings: Array.isArray(payload.readings) ? payload.readings : [],
    // 词条读音交叉校验的免检项，形如 "重複|ちょうふく|じゅうふく"。
    // 只放两读皆合法的；kuromoji 真读错的应该进 readings 或 overrides。
    accepted: new Set(payload.accepted ?? [])
  };
  for (const item of payload.overrides ?? []) {
    if (!item || !Array.isArray(item.annotations)) throw new Error("furigana override 缺少 annotations 数组");
    const key = item.kind === "grammar"
      ? `grammar\u0000${item.id}\u0000${item.exampleIndex ?? 0}`
      : item.kind === "grammar_title"
        ? `grammarTitle\u0000${item.id}`
        : `word\u0000${sourceKey(item.kanji, item.kana)}\u0000${item.exampleJp ?? ""}`;
    const target = item.kind === "grammar"
      ? maps.grammar
      : item.kind === "grammar_title"
        ? maps.grammarTitle
        : maps.word;
    if (target.has(key)) throw new Error(`furigana override 重复: ${key}`);
    target.set(key, item.annotations);
  }
  return maps;
};

const isKanjiChar = (char) => /[\u3400-\u9fff々〇]/u.test(char);

const splitSurfaceRuns = (surface) => {
  const runs = [];
  let offset = 0;
  for (const char of String(surface)) {
    const isKanji = isKanjiChar(char);
    const last = runs[runs.length - 1];
    if (last && last.isKanji === isKanji) {
      last.text += char;
      last.length += char.length;
    } else {
      runs.push({ text: char, start: offset, length: char.length, isKanji });
    }
    offset += char.length;
  }
  return runs;
};

/**
 * Align a kuromoji token's reading to its kanji runs. This keeps okurigana
 * outside ruby: 食べる -> 食=た, 行った -> 行=い. For compounds such as
 * 祖父母, the whole kanji token receives one context-sensitive reading.
 */
const alignToken = (surface, reading, tokenStart) => {
  const runs = splitSurfaceRuns(surface);
  const kanjiRuns = runs.filter((run) => run.isKanji);
  if (!kanjiRuns.length || !reading) return [];

  const target = normalizeKana(reading);
  const firstKanji = runs.findIndex((run) => run.isKanji);
  let position = 0;
  if (firstKanji > 0) {
    const prefix = normalizeKana(runs.slice(0, firstKanji).map((run) => run.text).join(""));
    if (!target.startsWith(prefix)) return null;
    position = prefix.length;
  }

  const annotations = [];
  const walk = (runIndex, readingPosition) => {
    const run = runs[runIndex];
    if (!run?.isKanji) return null;
    const next = runs[runIndex + 1];
    if (!next) {
      const value = target.slice(readingPosition);
      return value ? [{ start: tokenStart + run.start, length: run.length, reading: value }] : null;
    }

    if (next.isKanji) {
      const tail = walk(runIndex + 1, readingPosition);
      return tail ? [{ start: tokenStart + run.start, length: run.length, reading: "" }, ...tail] : null;
    }

    const anchor = normalizeKana(next.text);
    const candidates = [];
    for (let index = readingPosition; index <= target.length - anchor.length; index += 1) {
      if (target.startsWith(anchor, index)) candidates.push(index);
    }
    // Prefer the latest anchor. This handles お祝い (お + 祝い + い) and
    // similar tokens where the trailing okurigana appears inside the reading.
    for (const anchorStart of candidates.reverse()) {
      const value = target.slice(readingPosition, anchorStart);
      if (!value) continue;
      const afterAnchor = anchorStart + anchor.length;
      const nextKanji = runs[runIndex + 2];
      if (!nextKanji) {
        if (afterAnchor !== target.length) continue;
        return [{ start: tokenStart + run.start, length: run.length, reading: value }];
      }
      const tail = walk(runIndex + 2, afterAnchor);
      if (tail) return [{ start: tokenStart + run.start, length: run.length, reading: value }, ...tail];
    }
    return null;
  };

  const first = walk(firstKanji, position);
  if (!first) return null;
  // The recursion emits an empty placeholder only for adjacent kanji runs;
  // combine those runs before returning so the annotation remains token-like.
  const merged = [];
  for (const annotation of first) {
    const last = merged[merged.length - 1];
    if (last && last.start + last.length === annotation.start && annotation.reading) {
      last.length += annotation.length;
      last.reading += annotation.reading;
    } else if (annotation.reading) {
      merged.push({ ...annotation });
    }
  }
  return merged.length ? merged : null;
};

/*
 * kuromoji 的 token.reading 是 IPADIC 词条自带的读音，不是按上下文推出来的。
 * Viterbi 把「〜の間」的边界切对了，可挂上去的读音仍然是「ま」——分词没错，
 * 错的是那条词典项。全库扫下来这类错误是成建制的：間 ま×70/あいだ×0、
 * 後 のち×65（只有「後ほど」该读 のち）、角 かく×13/かど×0。
 *
 * 每条规则只在 from 完全命中时生效，顺序敏感（先特殊后一般，首个命中即返回）。
 * before/unlessBefore 匹配 start 之前的文本，要用 $ 收尾；
 * unlessAfter 匹配 start 之后的文本，要用 ^ 开头。
 * afterModifier 表示前一个 token 是動詞/助動詞/形容詞，即连体修饰。
 *
 * 例外全部来自实际语料，不是预防性猜测——改动前先用同样的
 * (汉字块 → 读音) 汇总把语料扫一遍，别凭印象加规则。
 */
const BUILTIN_READING_FIXES = [
  // 鹿の角/牛の角 是つの，其余的角（拐角、桌角、岩角）是かど。
  { surface: "角", from: "かく", to: "つの", before: "(鹿|牛|羊|山羊|やぎ)の$" },
  { surface: "角", from: "かく", to: "かど" },
  // 65 处「〜の後 / 〜た後」里只有「後ほど」该保持のち。
  { surface: "後", from: "のち", to: "あと", unlessAfter: "^後ほど" },
  // 「間に合う」「間もなく」「すき間」「あっという間」「いつの間にか」
  // 「少し間がある」「手間」保持ま，其余的「〜の間」是あいだ。
  {
    surface: "間",
    from: "ま",
    to: "あいだ",
    unlessAfter: "^間(に合|もなく)",
    unlessBefore: "(すき|隙|という|いつの|少し|手)$"
  },
  // 指人的「方」。方向的「方」（太陽の方）保持ほう。
  { surface: "方", from: "ほう", to: "かた", before: "(高齢|年配|未満|以上|以下|担当|関係者)の$" },
  // 连体修饰 +「方」：いらっしゃった方 / 受付にいる方 / お世話になった方。
  // 「〜た方がいい」的方是ほう，当前语料 0 处，这条护栏是给将来的数据留的。
  { surface: "方", from: "ほう", to: "かた", afterModifier: true, unlessAfter: "^方が(い|よ|まし)" }
];

const MODIFIER_POS = new Set(["動詞", "助動詞", "形容詞"]);

const compileReadingFix = (fix, origin) => {
  if (!fix?.surface || !fix?.from || !fix?.to) {
    throw new Error(`${origin} 读音规则缺少 surface/from/to: ${JSON.stringify(fix)}`);
  }
  return {
    surface: String(fix.surface),
    from: normalizeKana(fix.from),
    to: String(fix.to),
    // 只在这一句里生效。一次性的误读（同一个「罰」在两句里分别该读 ばつ 和 ばち）
    // 用它钉死，避免为了修一句而给全库加一条会误伤的规则。
    sentence: fix.sentence ? String(fix.sentence) : null,
    before: fix.before ? new RegExp(fix.before, "u") : null,
    unlessBefore: fix.unlessBefore ? new RegExp(fix.unlessBefore, "u") : null,
    unlessAfter: fix.unlessAfter ? new RegExp(fix.unlessAfter, "u") : null,
    afterModifier: Boolean(fix.afterModifier)
  };
};

// 用户侧规则（furigana_overrides.json 的 readings）排在内置规则之前，先命中先赢。
const readingFixes = [];
const loadReadingFixes = (userFixes) => {
  readingFixes.length = 0;
  readingFixes.push(
    ...userFixes.map((fix) => compileReadingFix(fix, "furigana_overrides.json")),
    ...BUILTIN_READING_FIXES.map((fix) => compileReadingFix(fix, "内置"))
  );
};

const correctReading = (surface, reading, start, sentence, previousToken) => {
  const current = normalizeKana(reading);
  if (!current) return reading;
  const head = sentence.slice(0, start);
  const tail = sentence.slice(start);
  for (const fix of readingFixes) {
    if (fix.surface !== surface || fix.from !== current) continue;
    if (fix.sentence && fix.sentence !== sentence) continue;
    if (fix.before && !fix.before.test(head)) continue;
    if (fix.afterModifier && !MODIFIER_POS.has(String(previousToken?.pos ?? ""))) continue;
    if (fix.unlessBefore?.test(head)) continue;
    if (fix.unlessAfter?.test(tail)) continue;
    return fix.to;
  }
  return reading;
};

const buildTokenizer = () => new Promise((resolve, reject) => {
  const entry = require.resolve("kuromoji");
  const dictPath = path.join(path.dirname(entry), "..", "dict");
  kuromoji.builder({ dicPath: dictPath }).build((error, tokenizer) => error ? reject(error) : resolve(tokenizer));
});

const tokenizeSentence = (tokenizer, sentence) => {
  const tokens = tokenizer.tokenize(sentence);
  const output = [];
  const unresolved = [];
  let cursor = 0;
  tokens.forEach((token, index) => {
    const surface = String(token.surface_form ?? "");
    if (!surface) return;
    const found = sentence.indexOf(surface, cursor);
    const start = found >= 0 ? found : Math.max(Number(token.word_position ?? 1) - 1, 0);
    cursor = start + surface.length;
    if (!hasKanji(surface)) return;
    const rawReading = String(token.reading ?? token.pronunciation ?? "");
    const reading = correctReading(surface, rawReading, start, sentence, tokens[index - 1]);
    const annotations = alignToken(surface, reading, start);
    if (!annotations) {
      unresolved.push({
        surface,
        start,
        reading,
        pos: String(token.pos ?? ""),
        basicForm: String(token.basic_form ?? "")
      });
      return;
    }
    output.push(...annotations);
  });
  const tokenMetadata = buildTokenMetadata(tokens);
  const tokenLengthTotal = tokenMetadata.lengths.reduce((sum, length) => sum + Math.abs(length), 0);
  return {
    annotations: output,
    unresolved,
    tokens,
    // Store only boundaries, never dictionary ids.  Kuromoji's Viterbi token
    // list is already the context-sensitive segmentation used above.
    tokenLengths: tokenLengthTotal === String(sentence).length ? tokenMetadata.lengths.join(",") : "",
    tokenLemmas: tokenLengthTotal === String(sentence).length ? JSON.stringify(tokenMetadata.lemmas) : ""
  };
};

const validateAnnotations = (sentence, annotations) => {
  let cursor = 0;
  for (const annotation of [...annotations].sort((left, right) => left.start - right.start)) {
    const end = annotation.start + annotation.length;
    if (!Number.isInteger(annotation.start) || !Number.isInteger(annotation.length)
      || annotation.start < cursor || annotation.length <= 0 || end > sentence.length
      || !hasKanji(sentence.slice(annotation.start, end)) || !annotation.reading) return false;
    cursor = end;
  }
  return true;
};

const findWordMatch = (tokens, kanji, kana) => {
  const normalizedWordKana = normalizeKana(kana);
  return tokens.some((token) => {
    const surface = String(token.surface_form ?? "");
    const basicForm = String(token.basic_form ?? "");
    const tokenKana = normalizeKana(token.reading ?? "");
    const kanaWritten = /^[ぁ-ゖァ-ヺー]+$/u.test(surface) && surface.length >= 2;
    return surface === kanji || basicForm === kanji
      || (kanaWritten && (surface === kana || basicForm === kana || tokenKana === normalizedWordKana));
  });
};

// 比对的是**覆写之后**的读音：上下文规则已经修好的那些不该再报到闸门上。
const findExactReadingMismatch = (tokens, kanji, kana, sentence) => {
  const expected = normalizeKana(kana);
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const surface = String(tokens[index].surface_form ?? "");
    if (!surface) continue;
    const found = sentence.indexOf(surface, cursor);
    const start = found >= 0 ? found : cursor;
    cursor = start + surface.length;
    if (surface !== kanji) continue;
    const raw = String(tokens[index].reading ?? "");
    const reading = normalizeKana(correctReading(surface, raw, start, sentence, tokens[index - 1]));
    if (reading && reading !== expected) return reading;
  }
  return undefined;
};

const readingMismatchKey = (entry) => `${entry.kanji}|${entry.expected}|${entry.actual}`;

// Store compact tuples in SQLite/seed JSON: [UTF-16 start, length, reading].
// The runtime parser normalizes them to named objects for the renderer.
const compactAnnotations = (annotations) => (annotations ?? []).map((item) => (
  Array.isArray(item) ? item : [item.start, item.length, item.reading]
));
const jsonAnnotations = (annotations) => JSON.stringify(compactAnnotations(annotations));
const sourceJsonAnnotations = (annotations) => JSON.stringify(annotations ?? []);

const compactTitleMap = (entries) => Object.fromEntries(
  entries.map(({ id, annotations }) => [id, compactAnnotations(annotations)])
);

const writeGrammarTitleFurigana = (entries) => {
  writeFileSync(grammarTitleFuriganaPath, `${JSON.stringify({
    version: FURIGANA_VERSION,
    source: "grammar.ts",
    entries: compactTitleMap(entries)
  })}\n`, "utf8");
};

const normalizePattern = (pattern) => String(pattern ?? "")
  .replace(/（N[1-5]・.*）$/u, "")
  .replace(/\s+/gu, "")
  .trim();

const updateGrammarSource = (grammarPoints, sentenceResults) => {
  let source = readFileSync(grammarTsPath, "utf8");
  // 无差别删掉所有 furigana 行再整体重写——**手工改在 grammar.ts 里的注音会被洗掉**。
  // 要固化人工结果，写进 furigana_overrides.json，那是重跑之后仍然活着的唯一位置。
  source = source.replace(/^\s*"furigana": \[.*\],\n/gm, "");
  source = source.replace(/^\s*"tokenLengths": "(?:\\.|[^"\\])*",\n/gm, "");
  source = source.replace(/^\s*"tokenLemmas": "(?:\\.|[^"\\])*",\n/gm, "");
  const examples = grammarPoints.flatMap((point) => point.examples ?? []);
  let index = 0;
  source = source.replace(/^(\s*)"jp": ("(?:\\.|[^"\\])*")(,?)$/gm, (line, indent, encoded, comma) => {
    if (index >= examples.length) return line;
    const result = sentenceResults[index++];
    const suffix = comma || ",";
    return `${line}\n${indent}"furigana": ${sourceJsonAnnotations(result.annotations)},\n${indent}"tokenLengths": ${JSON.stringify(result.tokenLengths ?? "")},\n${indent}"tokenLemmas": ${JSON.stringify(result.tokenLemmas ?? "")}${suffix}`;
  });
  if (index !== examples.length) throw new Error(`grammar.ts 例句数量不匹配: 找到 ${index},预期 ${examples.length}`);
  writeFileSync(grammarTsPath, source, "utf8");
};

const tableColumns = (db, table) => new Set(
  (db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1]))
);

const grammarDbContent = (point, annotations, tokenLengths = "", tokenLemmas = "") => {
  const example = point.examples?.[0] ?? {};
  const comparisons = (point.comparisons ?? []).map((item) => {
    if (typeof item === "string") return item;
    return [item.withTitle, item.note].filter(Boolean).join("：");
  }).filter(Boolean).join("；");
  return [
    String(point.title ?? ""),
    String(point.meaning ?? ""),
    String(point.title ?? ""),
    String(point.connection ?? point.structure ?? ""),
    String(example.jp ?? example.japanese ?? ""),
    String(example.cn ?? example.chinese ?? ""),
    Array.isArray(point.usageNotes) ? point.usageNotes.join("\n") : "",
    comparisons,
    String(point.level ?? ""),
    jsonAnnotations(annotations),
    tokenLengths,
    tokenLemmas
  ];
};

/**
 * The shipped grammar DB predates the current grammar.ts rewrite and contains
 * mojibake examples (including 「減る二方だ」).  Keep the DB aligned with the
 * canonical source by sort_order, while preserving its stable numeric ids and
 * importance scores.  This also makes the release check able to catch a future
 * content-only regression instead of treating it as a furigana problem.
 */
const syncGrammarDbContent = (db, grammarPoints, firstGrammarResultById) => {
  const rows = db.exec("SELECT id, sort_order, pattern FROM grammar_points ORDER BY sort_order")[0]?.values ?? [];
  const points = [...grammarPoints].sort((left, right) => Number(left.bookOrder) - Number(right.bookOrder));
  if (rows.length !== points.length) {
    throw new Error(`grammar_points 数量 ${rows.length} != grammar.ts ${points.length}，拒绝按顺序同步正文`);
  }
  // pattern has a UNIQUE constraint, while the canonical source intentionally
  // contains a few same-title points at different levels. Vacate old values
  // first, then assign deterministic suffixes to the later duplicate.
  rows.forEach(([id]) => {
    db.run("UPDATE grammar_points SET pattern = ? WHERE id = ?", [`__grammar_sync_${id}`, id]);
  });
  const seenPatterns = new Map();
  rows.forEach(([id, sortOrder], index) => {
    const point = points[index];
    if (Number(sortOrder) !== Number(point.bookOrder)) {
      throw new Error(`grammar_points sort_order=${sortOrder} 与 grammar.ts bookOrder=${point.bookOrder} 不一致`);
    }
    const result = firstGrammarResultById.get(point.id);
    if (!result) throw new Error(`找不到 ${point.id} 的首条例句注音结果`);
    const duplicateIndex = seenPatterns.get(point.title) ?? 0;
    seenPatterns.set(point.title, duplicateIndex + 1);
    const pattern = duplicateIndex === 0
      ? String(point.title ?? "")
      : `${String(point.title ?? "")}（${String(point.level ?? "")}-${duplicateIndex + 1}）`;
    const [, meaning, prompt, formation, exampleJp, exampleMeaning, notes, confusions, level, exampleFurigana, exampleTokens, exampleLemmas] = grammarDbContent(point, result.annotations, result.tokenLengths, result.tokenLemmas);
    db.run(`
      UPDATE grammar_points
      SET pattern = ?, meaning = ?, prompt = ?, formation = ?, example_jp = ?,
          example_meaning = ?, notes = ?, confusions = ?, level = ?,
          example_furigana = ?, example_tokens = ?, example_lemmas = ?
      WHERE id = ?
    `, [pattern, meaning, prompt, formation, exampleJp, exampleMeaning, notes, confusions, level, exampleFurigana, exampleTokens, exampleLemmas, id]);
  });
};

const ensureFuriganaColumns = (db) => {
  for (const table of ["words", "grammar_points", "grammar_points_archive"]) {
    const columns = tableColumns(db, table);
    if (!columns.has("example_furigana")) db.run(`ALTER TABLE ${table} ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''`);
    if (!columns.has("example_tokens")) db.run(`ALTER TABLE ${table} ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''`);
    if (!columns.has("example_lemmas")) db.run(`ALTER TABLE ${table} ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''`);
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS dictionary_discovered_words (
      word_id INTEGER PRIMARY KEY,
      discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS grammar_reading_positions (
      kind TEXT NOT NULL,
      level TEXT NOT NULL,
      grammar_id TEXT NOT NULL,
      scroll_top REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (kind, level)
    )
  `);
  const positionColumns = tableColumns(db, "grammar_reading_positions");
  if (!positionColumns.has("scroll_top")) {
    db.run("ALTER TABLE grammar_reading_positions ADD COLUMN scroll_top REAL NOT NULL DEFAULT 0");
  }
};

const scalar = (db, query, params = []) => Number(db.exec(query, params)[0]?.values?.[0]?.[0] ?? 0);

const assertCleanDatabase = (db, dbPath) => {
  const populated = findPopulatedUserTables((sql) => scalar(db, sql));
  if (populated.length) {
    throw new Error(`${dbPath} 含有用户数据(${populated.map(([table, count]) => `${table}=${count}`).join(", ")}),拒绝烘焙`);
  }
};

const main = async () => {
  const reportOnly = process.argv.includes("--report-only");
  const titlesOnly = process.argv.includes("--titles-only");
  mkdirSync(path.dirname(reportPath), { recursive: true });
  const grammarPoints = loadGrammarPoints();
  const grammarSeed = JSON.parse(readFileSync(grammarSeedPath, "utf8"));
  const wordSeed = JSON.parse(readFileSync(wordSeedPath, "utf8"));
  const overrides = loadOverrides();
  loadReadingFixes(overrides.readings);
  const tokenizer = await buildTokenizer();

  const report = {
    version: FURIGANA_VERSION,
    tokenizer: "kuromoji 0.1.2 / IPADIC",
    grammarTitles: { points: 0, withKanji: 0, annotations: 0, unresolved: [], invalid: 0 },
    grammar: { sentences: 0, annotations: 0, unresolved: [], invalid: 0 },
    grammarDb: { sentences: 0, annotations: 0, unresolved: [], invalid: 0 },
    words: { sentences: 0, annotations: 0, unresolved: [], invalid: 0, noLemmaMatch: [], readingMismatch: [] },
    overrideCount: {
      word: overrides.word.size,
      grammar: overrides.grammar.size,
      grammarTitle: overrides.grammarTitle.size,
      readings: overrides.readings.length,
      accepted: overrides.accepted.size
    },
    generatedAt: new Date().toISOString()
  };

  const grammarTitleEntries = [];
  for (const point of grammarPoints) {
    const title = String(point.title ?? "");
    const tokenizedTitle = maskChineseTitleNotes(title);
    const result = tokenizeSentence(tokenizer, tokenizedTitle);
    const override = overrides.grammarTitle.get(`grammarTitle\u0000${point.id}`);
    const annotations = override ?? result.annotations;
    grammarTitleEntries.push({ id: String(point.id), annotations });
    report.grammarTitles.points += 1;
    if (hasKanji(title)) report.grammarTitles.withKanji += 1;
    report.grammarTitles.annotations += annotations.length;
    if (result.unresolved.length && !override) {
      report.grammarTitles.unresolved.push({ id: point.id, title, tokens: result.unresolved });
    }
    if (!validateAnnotations(title, annotations)) report.grammarTitles.invalid += 1;
  }

  const titleHardFailures = report.grammarTitles.invalid + report.grammarTitles.unresolved.length;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (titleHardFailures) {
    throw new Error(`语法标题 furigana 校验闸门失败: unresolved=${report.grammarTitles.unresolved.length}, invalid=${report.grammarTitles.invalid}; 详情见 ${reportPath}`);
  }
  if (titlesOnly) {
    writeGrammarTitleFurigana(grammarTitleEntries);
    console.log(`✅ grammar titles: ${report.grammarTitles.points} 条 / ${report.grammarTitles.withKanji} 条含汉字 / ${report.grammarTitles.annotations} 个注音区间`);
    console.log(`✅ 写入 ${grammarTitleFuriganaPath}`);
    console.log(`   审计报告: ${reportPath}`);
    return;
  }

  const grammarResults = [];
  const firstGrammarResultById = new Map();
  const grammarExamples = grammarPoints.flatMap((point) => point.examples ?? []);
  for (let index = 0; index < grammarExamples.length; index += 1) {
    const point = grammarExamples[index];
    const sentence = String(point.jp ?? point.japanese ?? "");
    const result = tokenizeSentence(tokenizer, sentence);
    const grammarPoint = grammarPoints.find((item) => (item.examples ?? []).includes(point));
    const exampleIndex = grammarPoint?.examples?.indexOf(point) ?? 0;
    const override = overrides.grammar.get(`grammar\u0000${grammarPoint?.id}\u0000${exampleIndex}`);
    const annotations = override ?? result.annotations;
    const resultWithAnnotations = { annotations, tokenLengths: result.tokenLengths, tokenLemmas: result.tokenLemmas };
    grammarResults.push(resultWithAnnotations);
    if (exampleIndex === 0 && grammarPoint?.id) firstGrammarResultById.set(grammarPoint.id, resultWithAnnotations);
    report.grammar.sentences += 1;
    report.grammar.annotations += annotations.length;
    if (result.unresolved.length && !override) report.grammar.unresolved.push({ id: grammarPoint?.id, exampleIndex, sentence, tokens: result.unresolved });
    if (!validateAnnotations(sentence, annotations)) report.grammar.invalid += 1;
  }

  const wordResults = new Map();
  const wordOverrideRows = [];
  const sourceDbBytes = readFileSync(dbPaths[0]);
  const SQL = await initSqlJs();
  const sourceDb = new SQL.Database(new Uint8Array(sourceDbBytes));
  const wordRows = sourceDb.exec("SELECT id, kanji, kana, COALESCE(example_jp, '') FROM words ORDER BY id")[0]?.values ?? [];
  for (const [id, kanjiValue, kanaValue, exampleValue] of wordRows) {
    const kanji = String(kanjiValue ?? "");
    const kana = String(kanaValue ?? "");
    const sentence = String(exampleValue ?? "");
    if (!sentence || !hasKanji(sentence)) {
      wordResults.set(sourceKey(kanji, kana), { sentence, annotations: [], tokenLengths: "", tokenLemmas: "" });
      continue;
    }
    const result = tokenizeSentence(tokenizer, sentence);
    const override = overrides.word.get(`word\u0000${sourceKey(kanji, kana)}\u0000${sentence}`);
    const annotations = override ?? result.annotations;
    wordResults.set(sourceKey(kanji, kana), { sentence, annotations, tokenLengths: result.tokenLengths, tokenLemmas: result.tokenLemmas });
    report.words.sentences += 1;
    report.words.annotations += annotations.length;
    if (result.unresolved.length && !override) report.words.unresolved.push({ id, kanji, kana, sentence, tokens: result.unresolved });
    if (!validateAnnotations(sentence, annotations)) report.words.invalid += 1;
    if (!findWordMatch(result.tokens, kanji, kana) && !sentence.includes(kanji) && !sentence.includes(kana)) {
      report.words.noLemmaMatch.push({ id, kanji, kana, sentence });
    }
    const mismatch = findExactReadingMismatch(result.tokens, kanji, kana, sentence);
    if (mismatch && !override) report.words.readingMismatch.push({ id, kanji, kana, expected: normalizeKana(kana), actual: mismatch, sentence });
  }

  // Keep the already-existing override table useful to the runtime migration:
  // any row with a hand-authored example gets its generated spans alongside it.
  const overrideRows = JSON.parse(readFileSync(exampleOverridesPath, "utf8"));
  for (const row of overrideRows) {
    const sentence = String(row.exampleJp ?? "");
    if (!sentence || !hasKanji(sentence)) continue;
    const result = tokenizeSentence(tokenizer, sentence);
    const override = overrides.word.get(`word\u0000${sourceKey(row.kanji, row.kana)}\u0000${sentence}`);
    wordOverrideRows.push({ ...row, exampleFurigana: override ?? result.annotations, exampleTokens: result.tokenLengths, exampleLemmas: result.tokenLemmas });
  }

  report.grammar.unresolved.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  report.words.unresolved.sort((left, right) => Number(left.id) - Number(right.id));
  report.words.noLemmaMatch.sort((left, right) => Number(left.id) - Number(right.id));
  report.words.readingMismatch.sort((left, right) => Number(left.id) - Number(right.id));
  // 词条自带 kana 是这批例句里唯一的读音基准真值，所以「表记完全相同却读音不一致」
  // 必须拦住，不能只打印。放行的唯一途径是把它写进 accepted，即有人看过并认可。
  report.words.readingMismatchUnaccepted = report.words.readingMismatch
    .filter((entry) => !overrides.accepted.has(readingMismatchKey(entry)))
    .map((entry) => readingMismatchKey(entry));
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const hardFailures = report.grammar.invalid + report.words.invalid
    + report.grammar.unresolved.length + report.words.unresolved.length
    + report.words.readingMismatchUnaccepted.length;
  if (hardFailures) {
    throw new Error([
      "furigana 校验闸门失败:",
      `grammar unresolved=${report.grammar.unresolved.length},`,
      `words unresolved=${report.words.unresolved.length},`,
      `invalid=${report.grammar.invalid + report.words.invalid},`,
      `未认可的读音冲突=${report.words.readingMismatchUnaccepted.length};`,
      `详情见 ${reportPath}`
    ].join(" "));
  }
  if (reportOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  writeGrammarTitleFurigana(grammarTitleEntries);

  // grammar_seed intentionally keeps one unique row for patterns that appear
  // in more than one level. Match those 731 canonical rows to grammar.ts by
  // level + normalized pattern; the static source still gets annotations for
  // all 741 points/examples, including the ten duplicate-title points.
  const staticResultsByKey = new Map();
  grammarPoints.forEach((point) => {
    const key = `${point.level}\u0000${normalizePattern(point.title)}`;
    const queue = staticResultsByKey.get(key) ?? [];
    queue.push(firstGrammarResultById.get(point.id));
    staticResultsByKey.set(key, queue);
  });
  const grammarRows = grammarSeed.rows.map((row, index) => {
    const key = `${row[8]}\u0000${normalizePattern(row[0])}`;
    const firstResult = staticResultsByKey.get(key)?.shift();
    if (!firstResult) throw new Error(`grammar_seed 第 ${index + 1} 条找不到 grammar.ts 对应例句: ${row[0]}`);
    return [...row.slice(0, 10), jsonAnnotations(firstResult.annotations), firstResult.tokenLengths ?? "", firstResult.tokenLemmas ?? ""];
  });
  const nextGrammarSeed = { version: GRAMMAR_DATASET_VERSION, rows: grammarRows };
  const nextWordSeed = wordSeed.map((row) => {
    const key = sourceKey(row[2], row[1]);
    const generated = wordResults.get(key);
    const annotations = generated?.annotations ?? [];
    return [...row.slice(0, 9), jsonAnnotations(annotations), generated?.tokenLengths ?? "", generated?.tokenLemmas ?? ""];
  });

  updateGrammarSource(grammarPoints, grammarResults);
  writeFileSync(grammarSeedPath, `${JSON.stringify(nextGrammarSeed)}\n`, "utf8");
  writeFileSync(wordSeedPath, `${JSON.stringify(nextWordSeed)}\n`, "utf8");
  writeFileSync(exampleOverridesPath, `${JSON.stringify(wordOverrideRows.map((row) => ({
    ...row,
    exampleFurigana: compactAnnotations(row.exampleFurigana),
    exampleTokens: row.exampleTokens ?? "",
    exampleLemmas: row.exampleLemmas ?? ""
  })), null, 2)}\n`, "utf8");

  let grammarDbCount = 0;
  for (const dbPath of dbPaths) {
    // public 和 ios 两份库内容一致，统计只记第一份，否则审计数字凭空翻倍。
    const countsIntoReport = dbPath === dbPaths[0];
    const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
    ensureFuriganaColumns(db);
    assertCleanDatabase(db, dbPath);
    const grammarCount = scalar(db, "SELECT COUNT(*) FROM grammar_points");
    grammarDbCount = Math.max(grammarDbCount, grammarCount);
    db.run("BEGIN TRANSACTION");
    try {
      db.run("UPDATE words SET example_furigana = '', example_tokens = '', example_lemmas = ''");
      for (const [kanjiValue, kanaValue, exampleValue] of (db.exec("SELECT kanji, kana, COALESCE(example_jp, '') FROM words")[0]?.values ?? [])) {
        const kanji = String(kanjiValue ?? "");
        const kana = String(kanaValue ?? "");
        const sentence = String(exampleValue ?? "");
        const generated = wordResults.get(sourceKey(kanji, kana));
        const fallback = generated?.sentence === sentence ? generated : tokenizeSentence(tokenizer, sentence);
        db.run("UPDATE words SET example_furigana = ?, example_tokens = ?, example_lemmas = ? WHERE kanji = ? AND kana = ? AND example_jp = ?", [jsonAnnotations(fallback.annotations), fallback.tokenLengths ?? "", fallback.tokenLemmas ?? "", kanji, kana, sentence]);
      }
      syncGrammarDbContent(db, grammarPoints, firstGrammarResultById);
      const grammarDbRows = db.exec("SELECT id, COALESCE(example_jp, ''), COALESCE(example_furigana, '') FROM grammar_points ORDER BY sort_order")[0]?.values ?? [];
      for (const [id, exampleValue, annotationValue] of grammarDbRows) {
        const sentence = String(exampleValue ?? "");
        const annotations = JSON.parse(String(annotationValue || "[]")).map((item) => (
          Array.isArray(item) ? { start: item[0], length: item[1], reading: item[2] } : item
        ));
        if (countsIntoReport && sentence && hasKanji(sentence)) {
          report.grammarDb.sentences += 1;
          report.grammarDb.annotations += annotations.length;
          const result = tokenizeSentence(tokenizer, sentence);
          if (result.unresolved?.length) report.grammarDb.unresolved.push({ dbPath, id, sentence, tokens: result.unresolved });
          if (!validateAnnotations(sentence, annotations)) report.grammarDb.invalid += 1;
        }
      }
      db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('furigana_version', ?)", [FURIGANA_VERSION]);
      db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('jlpt_word_metadata_version', ?)", [`2026-08-11-manual-meanings-5163-polish-1130-corrections-35-examples-121-${FURIGANA_VERSION}`]);
      db.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', ?)", [GRAMMAR_DATASET_VERSION]);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    db.run("VACUUM");
    writeFileSync(dbPath, Buffer.from(db.export()));
    console.log(`✅ 写入 ${dbPath}`);
  }

  report.grammarDb.unresolved.sort((left, right) => String(left.dbPath).localeCompare(String(right.dbPath)) || Number(left.id) - Number(right.id));
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.grammarDb.invalid || report.grammarDb.unresolved.length) {
    throw new Error(`数据库 grammar_points 注音校验闸门失败: unresolved=${report.grammarDb.unresolved.length}, invalid=${report.grammarDb.invalid}; 详情见 ${reportPath}`);
  }

  console.log(`✅ furigana=${FURIGANA_VERSION}`);
  console.log(`   grammar.ts: ${report.grammar.sentences} 句 / ${report.grammar.annotations} 个注音区间; DB grammar_points=${grammarDbCount}`);
  console.log(`   words: ${report.words.sentences} 句 / ${report.words.annotations} 个注音区间`);
  console.log(`   词条未直接/基本形命中: ${report.words.noLemmaMatch.length} 条`);
  console.log(`   精确表记读音不一致: ${report.words.readingMismatch.length} 条(全部已在 accepted 白名单内)`);
  console.log(`   读音上下文规则: 内置 ${BUILTIN_READING_FIXES.length} 条 + 用户 ${overrides.readings.length} 条`);
  console.log(`   审计报告: ${reportPath}`);
};

await main();
