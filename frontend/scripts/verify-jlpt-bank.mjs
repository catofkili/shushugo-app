#!/usr/bin/env node
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "../src/data/jlpt");
const DB_PATH = resolve(HERE, "../public/nihongo.db");
const LEVELS = ["N1", "N2", "N3", "N4", "N5"];
const KINDS = new Set([
  "kanji-reading", "orthography", "word-formation", "context", "paraphrase", "usage",
  "grammar-form", "sentence-order", "passage"
]);
const VOCAB_KINDS = new Set([
  "kanji-reading", "orthography", "word-formation", "context", "paraphrase", "usage"
]);
const QUESTION_KEYS = new Set([
  "id", "level", "kind", "setId", "stem", "options", "answer", "explanation",
  "distractors", "order", "passageId", "target"
]);
const databaseCache = new WeakMap();

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keysOf = (value) => Object.keys(value).sort();
const sameKeys = (value, keys) => keysOf(value).join("\0") === [...keys].sort().join("\0");
const has = (value, key) => Object.hasOwn(value, key);
const optionNo = (value) => Number.isInteger(value) && value >= 1 && value <= 4;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function readDbContent(db) {
  if (databaseCache.has(db)) return databaseCache.get(db);
  const words = new Map();
  const grammar = new Map();
  const examples = new Set();

  for (const row of db.prepare("SELECT id, jlpt_level, example_jp FROM words").all()) {
    words.set(Number(row.id), row);
    if (typeof row.example_jp === "string" && row.example_jp) examples.add(row.example_jp);
  }
  for (const row of db.prepare("SELECT id, level, example_jp FROM grammar_points").all()) {
    grammar.set(Number(row.id), row);
    if (typeof row.example_jp === "string" && row.example_jp) examples.add(row.example_jp);
  }

  const content = { words, grammar, examples };
  databaseCache.set(db, content);
  return content;
}

/** Return all structural/content errors and non-blocking warnings for one bank. */
export function verifyJlptBank(bank, db, expectedLevel = bank?.level) {
  const errors = [];
  const warnings = [];
  const error = (where, message) => errors.push(`${where}: ${message}`);
  if (!isRecord(bank)) return { errors: ["题库: 必须是对象"], warnings };

  let content;
  try {
    content = readDbContent(db);
  } catch (cause) {
    return { errors: [`数据库: 无法读取 words / grammar_points (${cause.message})`], warnings };
  }

  const requiredRoot = ["version", "level", "sets", "passages", "questions"];
  for (const key of requiredRoot) if (!has(bank, key)) error("题库", `缺少字段 ${key}`);
  for (const key of Object.keys(bank)) if (!requiredRoot.includes(key)) error("题库", `未知字段 ${key}`);
  if (typeof bank.version !== "string") error("题库.version", "必须是字符串");
  if (!LEVELS.includes(bank.level)) error("题库.level", "必须是 N1–N5 之一");
  if (expectedLevel && bank.level !== expectedLevel) {
    error("题库.level", `文件要求 ${expectedLevel}，实际为 ${String(bank.level)}`);
  }

  const setIds = new Set();
  if (!Array.isArray(bank.sets)) error("题库.sets", "必须是数组");
  else for (const [index, set] of bank.sets.entries()) {
    const where = `sets[${index}]`;
    if (!isRecord(set)) { error(where, "必须是对象"); continue; }
    if (!sameKeys(set, ["id", "title"])) error(where, "字段必须且只能是 id、title");
    if (typeof set.id !== "string" || !set.id) error(where, "id 必须是非空字符串");
    else if (setIds.has(set.id)) error(where, `set id 重复 ${set.id}`);
    else setIds.add(set.id);
    if (typeof set.title !== "string" || !set.title) error(where, "title 必须是非空字符串");
  }

  if (!isRecord(bank.passages)) error("题库.passages", "必须是字符串字典");
  else for (const [id, passage] of Object.entries(bank.passages)) {
    if (typeof passage !== "string" || !passage) error(`passages.${id}`, "文章必须是非空字符串");
  }
  if (!Array.isArray(bank.questions)) {
    error("题库.questions", "必须是数组");
    return { errors, warnings };
  }

  const ids = new Set();
  const questionRows = [];
  const answerCounts = new Map();
  const targetCounts = new Map();
  const level = bank.level;

  for (const [index, question] of bank.questions.entries()) {
    const where = isRecord(question) && typeof question.id === "string"
      ? question.id : `questions[${index}]`;
    if (!isRecord(question)) { error(where, "題目必須是对象"); continue; }
    questionRows.push(question);
    for (const key of ["id", "level", "kind", "setId", "stem", "options", "answer", "explanation", "distractors", "target"]) {
      if (!has(question, key)) error(where, `缺少字段 ${key}`);
    }
    for (const key of Object.keys(question)) if (!QUESTION_KEYS.has(key)) error(where, `未知字段 ${key}`);

    if (typeof question.id !== "string" || !question.id) error(where, "id 必须是非空字符串");
    else {
      if (ids.has(question.id)) error(where, "id 重复");
      ids.add(question.id);
    }
    if (!LEVELS.includes(question.level)) error(where, "level 必须是 N1–N5 之一");
    else if (question.level !== level) error(where, `level ${question.level} 与题库等级 ${String(level)} 不一致`);
    if (typeof question.kind !== "string" || !KINDS.has(question.kind)) error(where, `未知题型 ${String(question.kind)}`);
    if (typeof question.setId !== "string" || !question.setId) error(where, "setId 必须是非空字符串");
    else if (!setIds.has(question.setId)) error(where, `setId ${question.setId} 不在 sets 中`);

    if (typeof question.id === "string" && typeof question.setId === "string" && KINDS.has(question.kind) && LEVELS.includes(level)) {
      const section = VOCAB_KINDS.has(question.kind) ? "v" : "g";
      const pattern = new RegExp(`^${level.toLowerCase()}-${section}-${escapeRegex(question.setId)}-\\d{2}$`);
      if (!pattern.test(question.id)) error(where, `id 不符合 ${level.toLowerCase()}-${section}-${question.setId}-两位题号格式`);
    }

    if (level === "N1" && ["orthography", "word-formation"].includes(question.kind)) {
      error(where, `N1 不允许题型 ${question.kind}`);
    }
    if (question.kind === "word-formation" && level !== "N2") error(where, "word-formation 只有 N2 可以使用");
    if (level === "N5" && question.kind === "usage") error(where, "N5 不允许 usage");

    if (typeof question.stem !== "string") error(where, "stem 必须是字符串");
    if (!Array.isArray(question.options) || question.options.length !== 4) error(where, "options 必须正好四项");
    else {
      if (question.options.some((option) => typeof option !== "string" || !option.trim())) error(where, "options 不能有空项");
      if (new Set(question.options.filter((option) => typeof option === "string").map((option) => option.trim())).size !== 4) {
        error(where, "options 必须互不相同");
      }
    }
    if (!optionNo(question.answer)) error(where, "answer 必须是 1–4");
    else if (typeof question.setId === "string") {
      const counts = answerCounts.get(question.setId) ?? [0, 0, 0, 0];
      counts[question.answer - 1] += 1;
      answerCounts.set(question.setId, counts);
    }
    if (typeof question.explanation !== "string") error(where, "explanation 必须是字符串");
    if (!isRecord(question.distractors)) error(where, "distractors 必须是对象");
    else for (const [key, value] of Object.entries(question.distractors)) {
      if (!new Set(["1", "2", "3", "4"]).has(key)) error(where, `distractors 键 ${key} 不在 1–4 内`);
      if (typeof value !== "string") error(where, `distractors.${key} 必须是字符串`);
      if (key === String(question.answer)) error(where, "distractors 不能包含 answer 对应的键");
    }

    const marked = typeof question.stem === "string" ? question.stem : "";
    if (["kanji-reading", "orthography", "paraphrase"].includes(question.kind)) {
      const matches = [...marked.matchAll(/\[\[([^\]]+)\]\]/g)];
      if (matches.length !== 1 || (marked.match(/\[\[/g) ?? []).length !== 1 || (marked.match(/\]\]/g) ?? []).length !== 1 || !matches[0]?.[1].trim()) {
        error(where, "题干必须正好有一处非空 [[…]] 标记");
      }
    }
    if (["context", "grammar-form", "word-formation"].includes(question.kind)) {
      const blanks = marked.match(/（　[\s　]*）/gu) ?? [];
      if (blanks.length !== 1) error(where, "题干必须正好有一处（　…）空");
    }
    if (question.kind === "sentence-order") {
      // Trial input uses standalone ★; types.ts also allows the compact ★＿＿ form.
      const slots = [...marked.matchAll(/★＿＿|＿＿|★/g)];
      const starCount = (marked.match(/★/g) ?? []).length;
      if (slots.length !== 4) error(where, "排序题题干必须正好四个空");
      if (starCount !== 1 || slots.filter((slot) => slot[0].startsWith("★")).length !== 1) {
        error(where, "排序题必须正好一个 ★，并标记其中一个空");
      }
      if (!Array.isArray(question.order) || question.order.length !== 4 || !question.order.every(optionNo) || new Set(question.order).size !== 4) {
        error(where, "order 必须是 1–4 的一个排列");
      } else {
        const starIndex = slots.findIndex((slot) => slot[0].startsWith("★"));
        if (starIndex >= 0 && question.order[starIndex] !== question.answer) {
          error(where, "★ 所在位置的 order 选项号必须等于 answer");
        }
      }
    } else if (has(question, "order")) {
      if (!Array.isArray(question.order) || !question.order.every(optionNo)) error(where, "order 必须省略或为选项号数组");
    }

    if (question.kind === "passage") {
      const stemMatch = typeof question.stem === "string" ? question.stem.match(/^\[(\d+)\]$/) : null;
      if (!stemMatch) error(where, "文章题 stem 必须是 [n]");
      if (typeof question.passageId !== "string" || !question.passageId) error(where, "文章题必须有 passageId");
      else {
        const passage = isRecord(bank.passages) ? bank.passages[question.passageId] : undefined;
        if (typeof passage !== "string") error(where, `passageId ${question.passageId} 不在 passages 中`);
        else if (stemMatch && !passage.includes(`[${stemMatch[1]}]`)) error(where, `文章 ${question.passageId} 不含 ${question.stem}`);
      }
    } else if (has(question, "passageId")) {
      error(where, "只有 passage 题可以有 passageId");
    }

    if (question.target === null) {
      if (question.kind !== "passage") error(where, "只有 passage 题允许 target 为 null");
    } else if (!isRecord(question.target)) {
      error(where, "target 必须是对象或 null");
    } else {
      const target = question.target;
      if (!sameKeys(target, ["type", "id", "surface"])) error(where, "target 字段必须且只能是 type、id、surface");
      if (target.type !== "word" && target.type !== "grammar") error(where, "target.type 必须是 word 或 grammar");
      if (!Number.isInteger(target.id)) error(where, "target.id 必须是整数");
      if (typeof target.surface !== "string" || !target.surface.trim()) error(where, "target.surface 不能为空");
      if (target.type === "word" && Number.isInteger(target.id)) {
        const row = content.words.get(target.id);
        if (!row) error(where, `words.id=${target.id} 不存在`);
        else if (row.jlpt_level !== level) error(where, `words.id=${target.id} 的 jlpt_level=${row.jlpt_level}，应为 ${String(level)}`);
      }
      if (target.type === "grammar" && Number.isInteger(target.id)) {
        const row = content.grammar.get(target.id);
        if (!row) error(where, `grammar_points.id=${target.id} 不存在`);
        else if (row.level !== level) error(where, `grammar_points.id=${target.id} 的 level=${row.level}，应为 ${String(level)}`);
      }
      if ((target.type === "word" || target.type === "grammar") && Number.isInteger(target.id)) {
        const key = `${target.type}:${target.id}`;
        targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
      }
    }

    if (typeof question.stem === "string") {
      const stem = question.stem.replaceAll("[[", "").replaceAll("]]", "");
      if (content.examples.has(stem)) error(where, "題干照抄了词库 example_jp");
      if (Array.isArray(question.options)) for (const option of question.options) {
        if (typeof option === "string" && content.examples.has(option)) error(where, `选项照抄了词库 example_jp: ${option}`);
      }
    }
  }

  if (isRecord(bank.passages)) for (const [passageId, passage] of Object.entries(bank.passages)) {
    if (typeof passage !== "string") continue;
    const markers = [...passage.matchAll(/\[(\d+)\]/g)];
    for (const [, number] of markers) {
      if (!questionRows.some((question) => question.kind === "passage" && question.passageId === passageId && question.stem === `[${number}]`)) {
        error(`passages.${passageId}`, `文章标记 [${number}] 没有对应题目`);
      }
    }
  }

  for (const [setId, counts] of answerCounts) {
    if (!counts.some(Boolean)) continue;
    if (Math.max(...counts) - Math.min(...counts) > 3) {
      warnings.push(`set ${setId}: 正解位置分布为 ${counts.map((count, index) => `${index + 1}=${count}`).join(" ")}`);
    }
  }
  for (const [target, count] of targetCounts) if (count > 1) {
    warnings.push(`target ${target} 在 ${String(level)} 出现 ${count} 次`);
  }

  return { errors, warnings };
}

function fixtureBank() {
  return {
    version: "2026-10-02-test",
    level: "N3",
    sets: [{ id: "trial1", title: "试做卷 1" }],
    passages: {},
    questions: [{
      id: "n3-g-trial1-01", level: "N3", kind: "grammar-form", setId: "trial1",
      stem: "私は（　　）を読みました。", options: ["読む", "読んだ", "読めば", "読もう"],
      answer: 1, explanation: "语法说明。", distractors: { "2": "错项说明", "3": "错项说明", "4": "错项说明" },
      target: { type: "grammar", id: 2, surface: "ために" }
    }]
  };
}

function runSelfTest() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE words (id INTEGER, jlpt_level TEXT, example_jp TEXT);
           CREATE TABLE grammar_points (id INTEGER, level TEXT, example_jp TEXT);
           INSERT INTO words VALUES (1, 'N3', '単語の辞書例文です。');
           INSERT INTO words VALUES (3, 'N4', '別等级的例句。');
           INSERT INTO grammar_points VALUES (2, 'N3', '文法の辞書例文です。');
           INSERT INTO grammar_points VALUES (3, 'N4', 'N4 grammar example.');`);
  let count = 0;
  const bad = (name, mutate, expected, expectedLevel = "N3") => {
    const bank = structuredClone(fixtureBank());
    mutate(bank);
    const result = verifyJlptBank(bank, db, expectedLevel);
    assert(result.errors.some((message) => message.includes(expected)), `${name}: ${result.errors.join("\n")}`);
    count += 1;
  };
  const good = (name, mutate, expected) => {
    const bank = structuredClone(fixtureBank());
    mutate(bank);
    const result = verifyJlptBank(bank, db, "N3");
    assert(result.errors.length === 0 && result.warnings.some((message) => message.includes(expected)), `${name}: ${JSON.stringify(result)}`);
    count += 1;
  };
  const q = (bank) => bank.questions[0];

  const malformed = verifyJlptBank(null, db);
  assert(malformed.errors.some((message) => message.includes("必须是对象"))); count += 1;
  bad("root type", (b) => { b.version = 4; }, "version: 必须是字符串");
  bad("root missing field", (b) => { delete b.version; }, "缺少字段 version");
  bad("root unknown field", (b) => { b.extra = true; }, "未知字段 extra");
  bad("filename level", () => {}, "文件要求 N2", "N2");
  bad("sets type", (b) => { b.sets = {}; }, "sets: 必须是数组");
  bad("set shape", (b) => { b.sets[0].extra = true; }, "只能是 id、title");
  bad("duplicate set", (b) => { b.sets.push({ ...b.sets[0] }); }, "set id 重复");
  bad("passages type", (b) => { b.passages = []; }, "passages: 必须是字符串字典");
  bad("passage value type", (b) => { b.passages.p = 1; }, "文章必须是非空字符串");
  bad("questions type", (b) => { b.questions = {}; }, "questions: 必须是数组");
  bad("missing set", (b) => { b.sets = []; }, "sets 中");
  bad("required question field", (b) => { delete q(b).explanation; }, "缺少字段 explanation");
  bad("question type", (b) => { q(b).stem = 7; }, "stem 必须是字符串");
  bad("question level", (b) => { q(b).level = "N2"; }, "与题库等级");
  bad("duplicate id", (b) => { b.questions.push(structuredClone(q(b))); }, "id 重复");
  bad("id format", (b) => { q(b).id = "bad-id"; }, "id 不符合");
  bad("id is two digits", (b) => { q(b).id = "n3-g-trial1-001"; }, "id 不符合");
  bad("unknown kind", (b) => { q(b).kind = "unknown"; }, "未知题型");
  bad("N1 orthography", (b) => { b.level = "N1"; q(b).level = "N1"; q(b).kind = "orthography"; q(b).id = "n1-v-trial1-01"; }, "N1 不允许");
  bad("word formation only N2", (b) => { q(b).kind = "word-formation"; q(b).id = "n3-v-trial1-01"; }, "只有 N2");
  bad("N5 usage", (b) => { b.level = "N5"; q(b).level = "N5"; q(b).kind = "usage"; q(b).id = "n5-v-trial1-01"; }, "N5 不允许");
  bad("option count", (b) => { q(b).options.pop(); }, "正好四项");
  bad("empty option", (b) => { q(b).options[0] = "  "; }, "不能有空项");
  bad("duplicate options", (b) => { q(b).options[1] = q(b).options[0]; }, "互不相同");
  bad("answer range", (b) => { q(b).answer = 5; }, "answer 必须是 1–4");
  bad("distractor key", (b) => { q(b).distractors["5"] = "错"; }, "键 5");
  bad("answer distractor", (b) => { q(b).distractors["1"] = "错"; }, "不能包含 answer");
  bad("distractors type", (b) => { q(b).distractors = []; }, "distractors 必须是对象");
  bad("underline marker", (b) => { q(b).kind = "kanji-reading"; q(b).id = "n3-v-trial1-01"; q(b).stem = "普通题干"; }, "[[…]]");
  bad("blank marker", (b) => { q(b).stem = "这里没有空。"; }, "（　…）");
  bad("sentence slots", (b) => { q(b).kind = "sentence-order"; q(b).stem = "＿＿ ＿＿ ★＿＿"; q(b).order = [1, 2, 3, 4]; }, "正好四个空");
  bad("sentence star", (b) => { q(b).kind = "sentence-order"; q(b).stem = "＿＿ ＿＿ ＿＿ ＿＿"; q(b).order = [1, 2, 3, 4]; }, "正好一个 ★");
  bad("sentence order permutation", (b) => { q(b).kind = "sentence-order"; q(b).stem = "＿＿ ＿＿ ★＿＿ ＿＿"; q(b).order = [1, 1, 3, 4]; }, "一个排列");
  bad("non-sentence order type", (b) => { q(b).order = [1, 5]; }, "order 必须省略或为选项号数组");
  bad("sentence answer mapping", (b) => { q(b).kind = "sentence-order"; q(b).stem = "＿＿ ★＿＿ ＿＿ ＿＿"; q(b).order = [1, 2, 3, 4]; q(b).answer = 4; }, "order 选项号必须等于 answer");
  bad("passage stem", (b) => { q(b).kind = "passage"; q(b).stem = "1"; q(b).target = null; }, "stem 必须是 [n]");
  bad("passage id", (b) => { q(b).kind = "passage"; q(b).stem = "[1]"; q(b).target = null; q(b).passageId = "missing"; }, "不在 passages 中");
  bad("passage missing marker", (b) => { q(b).kind = "passage"; q(b).stem = "[1]"; q(b).target = null; q(b).passageId = "p"; b.passages.p = "文章没有空号。"; }, "不含 [1]");
  bad("passage marker missing question", (b) => { b.passages.p = "文章 [2] 有空。"; }, "没有对应题目");
  bad("null target", (b) => { q(b).target = null; }, "只有 passage 题");
  bad("word target missing", (b) => { q(b).target = { type: "word", id: 999, surface: "词" }; }, "words.id=999 不存在");
  bad("word target level", (b) => { q(b).target = { type: "word", id: 3, surface: "词" }; }, "jlpt_level=N4");
  bad("grammar target missing", (b) => { q(b).target.id = 999; }, "grammar_points.id=999 不存在");
  bad("grammar target level", (b) => { q(b).target = { type: "grammar", id: 3, surface: "语法" }; }, "level=N4");
  bad("target surface", (b) => { q(b).target.surface = "  "; }, "surface 不能为空");
  bad("target id type", (b) => { q(b).target.id = "2"; }, "target.id 必须是整数");
  bad("copied stem", (b) => { q(b).stem = "文法の辞書例文です。"; }, "題干照抄");
  bad("copied option", (b) => { q(b).options[0] = "単語の辞書例文です。"; }, "选项照抄");
  bad("unknown question field", (b) => { q(b).no = 1; }, "未知字段 no");
  good("answer spread warning", (b) => {
    const first = q(b);
    for (let index = 0; index < 5; index += 1) {
      const copy = structuredClone(first);
      copy.id = `n3-g-trial1-${String(index + 1).padStart(2, "0")}`;
      copy.answer = 1;
      b.questions.push(copy);
    }
    b.questions.shift();
  }, "正解位置分布");
  good("duplicate target warning", (b) => {
    const copy = structuredClone(q(b));
    copy.id = "n3-g-trial1-02";
    b.questions.push(copy);
  }, "出现 2 次");

  const positive = verifyJlptBank(fixtureBank(), db, "N3");
  assert.deepEqual(positive, { errors: [], warnings: [] }, JSON.stringify(positive));
  count += 1;
  const standaloneStar = structuredClone(fixtureBank());
  q(standaloneStar).kind = "sentence-order";
  q(standaloneStar).stem = "＿＿ ★ ＿＿ ＿＿";
  q(standaloneStar).order = [1, 2, 3, 4];
  q(standaloneStar).answer = 2;
  delete q(standaloneStar).distractors["2"];
  const starResult = verifyJlptBank(standaloneStar, db, "N3");
  assert.deepEqual(starResult.errors, [], JSON.stringify(starResult));
  count += 1;
  db.close();
  console.log(`self-test ok: ${count} cases`);
}

function runCli() {
  if (process.argv.includes("--self-test")) return runSelfTest();
  if (process.argv.some((arg) => arg === "--help" || arg === "-h")) {
    console.log("用法: node --no-warnings scripts/verify-jlpt-bank.mjs [--self-test]");
    return;
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  let totalErrors = 0;
  let totalWarnings = 0;
  try {
    for (const level of LEVELS) {
      const file = resolve(DATA_DIR, `${level.toLowerCase()}.json`);
      if (!existsSync(file)) {
        console.error(`${level}: 缺少文件 ${file}`);
        totalErrors += 1;
        continue;
      }
      let bank;
      try { bank = JSON.parse(readFileSync(file, "utf8")); }
      catch (cause) {
        console.error(`${level}: JSON 无法解析 (${cause.message})`);
        totalErrors += 1;
        continue;
      }
      const result = verifyJlptBank(bank, db, level);
      const questionCount = Array.isArray(bank?.questions) ? bank.questions.length : 0;
      console.log(`${level}: ${questionCount} 题，${result.errors.length} 错误，${result.warnings.length} 警告`);
      for (const message of result.errors) console.error(`  错误: ${message}`);
      for (const message of result.warnings) console.warn(`  警告: ${message}`);
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;
    }
  } finally {
    db.close();
  }
  console.log(`总计: ${totalErrors} 错误，${totalWarnings} 警告`);
  if (totalErrors) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli();
