#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyJlptBank } from "./verify-jlpt-bank.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "../src/data/jlpt");
const DB_PATH = resolve(HERE, "../public/nihongo.db");
const DEFAULT_SRC = resolve(HERE, "../../../_codex/jlpt-trial");
const LEVELS = ["N1", "N2", "N3", "N4", "N5"];
const KINDS = {
  "漢字読み": "kanji-reading",
  "表記": "orthography",
  "語形成": "word-formation",
  "文脈規定": "context",
  "言い換え類義": "paraphrase",
  "用法": "usage",
  "文法形式の判断": "grammar-form",
  "文の組み立て": "sentence-order",
  "文章の文法": "passage"
};
const VOCAB_KINDS = new Set([
  "kanji-reading", "orthography", "word-formation", "context", "paraphrase", "usage"
]);
const DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

function parseArgs(args) {
  const options = { src: DEFAULT_SRC, setId: "trial1", title: "试做卷 1", allowUndone: false, allowDoubt: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--src" || arg === "--set" || arg === "--title") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要一个值`);
      index += 1;
      if (arg === "--src") options.src = resolve(process.cwd(), value);
      if (arg === "--set") options.setId = value;
      if (arg === "--title") options.title = value;
    } else if (arg === "--allow-undone") options.allowUndone = true;
    else if (arg === "--allow-doubt") options.allowDoubt = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数 ${arg}`);
  }
  if (!options.setId.trim() || !options.title.trim()) throw new Error("--set 和 --title 不能为空");
  return options;
}

function printHelp() {
  console.log(`用法: node scripts/build-jlpt-bank.mjs [--src <目录>] [--set trial1 --title "试做卷 1"] [--allow-undone] [--allow-doubt]

默认只导入含 DONE 的等级-科目目录。--allow-undone 和 --allow-doubt 仅供本地试跑。`);
}

function readSources(options) {
  const imported = [];
  const passages = new Map();
  const doubts = [];
  const inputErrors = [];
  if (!existsSync(options.src)) throw new Error(`找不到题目源目录: ${options.src}`);

  const dirs = readdirSync(options.src, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.match(/^(N[1-5])-(vocab|grammar)$/))
    .filter(Boolean)
    .sort((a, b) => LEVELS.indexOf(a[1]) - LEVELS.indexOf(b[1]) || a[2].localeCompare(b[2]));

  for (const [, level, section] of dirs) {
    const dir = resolve(options.src, `${level}-${section}`);
    const file = resolve(dir, "questions.json");
    if (!existsSync(file) || (!options.allowUndone && !existsSync(resolve(dir, "DONE")))) continue;
    let questions;
    try { questions = JSON.parse(readFileSync(file, "utf8")); }
    catch (cause) { inputErrors.push(`${level}-${section}: questions.json 无法解析 (${cause.message})`); continue; }
    if (!Array.isArray(questions)) {
      inputErrors.push(`${level}-${section}: questions.json 必须是数组`);
      continue;
    }

    const rows = [];
    for (const [index, question] of questions.entries()) {
      const where = `${level} ${section} questions[${index}]`;
      if (!question || typeof question !== "object" || Array.isArray(question)) {
        inputErrors.push(`${where}: 必须是对象`);
        continue;
      }
      if (!Object.hasOwn(question, "doubt")) inputErrors.push(`${where}: 缺少 doubt 字段`);
      else if (question.doubt !== null) {
        doubts.push({ level, section, no: question.no ?? "?", doubt: question.doubt });
      }
      const kind = KINDS[question.kind];
      if (!kind) {
        inputErrors.push(`${level} ${section} no ${question.no ?? "?"}: 未知题型 ${String(question.kind)}`);
        continue;
      }
      const actualSection = VOCAB_KINDS.has(kind) ? "vocab" : "grammar";
      if (actualSection !== section) {
        inputErrors.push(`${level} ${section} no ${question.no ?? "?"}: ${question.kind} 应放在 ${actualSection} 目录`);
        continue;
      }
      if (!Number.isSafeInteger(question.no) || question.no < 1) {
        inputErrors.push(`${level} ${section} questions[${index}]: no 必须是正整数`);
        continue;
      }
      rows.push({ source: question, kind, no: question.no, level, section });
    }
    rows.sort((a, b) => a.no - b.no);

    const passageRows = rows.filter((row) => row.kind === "passage");
    // passage: null 等于没有这个字段（审校会把其它文章题上的 passage 写成 null）
    const passageSources = rows.filter((row) => row.source.passage != null);
    const passageId = `${level.toLowerCase()}-${options.setId}-p1`;
    if (passageSources.length > 1) inputErrors.push(`${level}-${section}: 只允许一篇文章，passage 字段出现了 ${passageSources.length} 次`);
    if (passageSources.length && !passageRows.includes(passageSources[0])) {
      inputErrors.push(`${level}-${section}: passage 字段必须放在文章题上`);
    }
    if (passageSources.length) {
      const passage = passageSources[0].source.passage;
      if (typeof passage !== "string" || !passage.trim()) inputErrors.push(`${level}-${section} no ${passageSources[0].no}: passage 必须是非空字符串`);
      else passages.set(passageId, passage);
    }

    for (const { source, kind, no } of rows) {
      const letter = section === "vocab" ? "v" : "g";
      const question = {
        id: `${level.toLowerCase()}-${letter}-${options.setId}-${String(no).padStart(2, "0")}`,
        level,
        kind,
        setId: options.setId,
        stem: source.stem,
        options: source.options,
        answer: source.answer,
        explanation: source.explanation,
        distractors: source.distractors,
        target: source.target
      };
      if (source.order !== null && source.order !== undefined) question.order = source.order;
      if (kind === "passage") question.passageId = passageId;
      imported.push({ level, section, no, question });
    }
  }
  if (inputErrors.length) throw new Error(`题目源格式错误:\n${inputErrors.map((item) => `  ${item}`).join("\n")}`);
  return { imported, passages, doubts };
}

function readExistingBank(file, level) {
  if (!existsSync(file)) return { version: "empty", level, sets: [], passages: {}, questions: [] };
  let bank;
  try { bank = JSON.parse(readFileSync(file, "utf8")); }
  catch (cause) { throw new Error(`${file} JSON 无法解析 (${cause.message})`); }
  if (!bank || typeof bank !== "object" || Array.isArray(bank)) throw new Error(`${file} 必须是题库对象`);
  return bank;
}

function mergeLevel(level, oldBank, imported, importedPassages, options) {
  const replacedQuestions = Array.isArray(oldBank.questions)
    ? oldBank.questions.filter((question) => question?.setId !== options.setId)
    : [];
  const importedLevel = imported.filter((row) => row.level === level).sort((a, b) =>
    (a.section === b.section ? 0 : a.section === "vocab" ? -1 : 1) || a.no - b.no
  );
  const hasSources = importedLevel.length > 0;
  const sets = Array.isArray(oldBank.sets) ? oldBank.sets.filter((set) => set?.id !== options.setId) : [];
  if (hasSources) sets.push({ id: options.setId, title: options.title });

  const passages = { ...(oldBank.passages && typeof oldBank.passages === "object" ? oldBank.passages : {}) };
  const candidatePassageIds = new Set([
    ...Object.keys(passages).filter((id) => id.startsWith(`${level.toLowerCase()}-${options.setId}-p`)),
    ...(Array.isArray(oldBank.questions) ? oldBank.questions.filter((q) => q?.setId === options.setId && q.passageId).map((q) => q.passageId) : [])
  ]);
  const remainingPassageIds = new Set(replacedQuestions.map((q) => q?.passageId).filter(Boolean));
  for (const id of candidatePassageIds) if (!remainingPassageIds.has(id)) delete passages[id];
  for (const [id, passage] of importedPassages) if (id.startsWith(`${level.toLowerCase()}-`)) passages[id] = passage;

  const questions = [...replacedQuestions, ...importedLevel.map((row) => row.question)];
  if (!questions.length) return { version: "empty", level, sets: [], passages: {}, questions: [] };
  return { version: `${DATE}-${options.setId}`, level, sets, passages, questions };
}

function printDoubts(doubts) {
  if (!doubts.length) {
    console.log("doubt 题: 无");
    return;
  }
  console.log(`doubt 题: ${doubts.length}`);
  for (const { level, section, no, doubt } of doubts) {
    console.log(`  ${level} / ${section} / ${no}: ${typeof doubt === "string" ? doubt : JSON.stringify(doubt)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  const { imported, passages, doubts } = readSources(options);
  printDoubts(doubts);
  if (doubts.length && !options.allowDoubt) {
    throw new Error("发现 doubt 非 null 的题；未写入题库。需要本地试跑时加 --allow-doubt。" );
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const banks = new Map();
  for (const level of LEVELS) {
    const file = resolve(DATA_DIR, `${level.toLowerCase()}.json`);
    const oldBank = readExistingBank(file, level);
    const bank = mergeLevel(level, oldBank, imported, passages, options);
    writeFileSync(file, `${JSON.stringify(bank, null, 2)}\n`);
    banks.set(level, bank);
    const bySection = imported.filter((row) => row.level === level);
    console.log(`${level}: 写入 ${bank.questions.length} 题（本次 vocab ${bySection.filter((row) => row.section === "vocab").length}，grammar ${bySection.filter((row) => row.section === "grammar").length}）`);
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  let totalErrors = 0;
  let totalWarnings = 0;
  try {
    for (const [level, bank] of banks) {
      const result = verifyJlptBank(bank, db, level);
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;
      for (const message of result.errors) console.error(`  错误: ${message}`);
      for (const message of result.warnings) console.warn(`  警告: ${message}`);
    }
  } finally {
    db.close();
  }
  console.log(`导入后校验: ${totalErrors} 错误，${totalWarnings} 警告`);
  if (totalErrors) {
    console.error("题库文件已经写入；校验发现的问题留给题目主编处理，导入脚本只修自身错误。" );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((cause) => {
    console.error(cause.message);
    process.exitCode = 1;
  });
}
