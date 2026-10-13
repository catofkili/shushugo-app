#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const options = { src: DEFAULT_SRC, setId: "trial1", title: "试做卷 1", allowUndone: false, allowDoubt: false, drillOnly: false };
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
    else if (arg === "--drill-only") options.drillOnly = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数 ${arg}`);
  }
  if (!options.setId.trim() || !options.title.trim()) throw new Error("--set 和 --title 不能为空");
  return options;
}

function printHelp() {
  console.log(`用法: node scripts/build-jlpt-bank.mjs [--src <目录>] [--set trial1 --title "试做卷 1"] [--allow-undone] [--allow-doubt] [--drill-only]

一套卷必须 N1–N5 两科共 10 个目录齐全、都有审校完成标记 DONE。--allow-undone 和 --allow-doubt 仅供本地试跑。`);
}

// Codex 照「正解位置要均匀」写出来的常是 1234 1234 循环（卷 1、卷 2 十科里有七科），审校也没拦住，
// 背下规律就能蒙对，盲做审校也会被规律带着走。所以正解位置不靠出题人：run-job.sh 在审校前洗一遍，
// 导入时再按「套卷-等级-科目」洗一遍。每科正解位置各占四分之一；种子固定，重导同一份源结果不变。
// 格式不对的题（不是四个选项、answer 不在 1–4）原样返回，交给 verify 报错。
export function shuffleAnswers(questions, seed) {
  let draws = 0;
  const random = () => createHash("sha256").update(`${seed}-${draws++}`).digest().readUInt32LE(0) / 2 ** 32;
  const shuffle = (items) => {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };
  const slots = shuffle(questions.map((_, index) => index % 4 + 1));
  return questions.map((question, index) => {
    if (!Array.isArray(question?.options) || question.options.length !== 4 || ![1, 2, 3, 4].includes(question.answer)) return question;
    const moved = new Map([[question.answer, slots[index]]]);
    const rest = shuffle([1, 2, 3, 4].filter((n) => n !== slots[index]));
    for (const old of [1, 2, 3, 4]) if (old !== question.answer) moved.set(old, rest.pop());
    const options = [];
    for (const [old, to] of moved) options[to - 1] = question.options[old - 1];
    return {
      ...question,
      options,
      answer: moved.get(question.answer),
      distractors: question.distractors && typeof question.distractors === "object" && !Array.isArray(question.distractors)
        ? Object.fromEntries(Object.entries(question.distractors).map(([key, value]) => [String(moved.get(Number(key)) ?? key), value]))
        : question.distractors,
      order: Array.isArray(question.order) ? question.order.map((n) => moved.get(n) ?? n) : question.order
    };
  });
}

function readSources(options) {
  const imported = [];
  const passages = new Map();
  const doubts = [];
  const inputErrors = [];
  if (!existsSync(options.src)) throw new Error(`找不到题目源目录: ${options.src}`);

  // 原来缺目录 / 没 DONE 就静默跳过，半套卷也能导进去（卷 3 第一次撞额度后只剩两科）
  for (const level of LEVELS) for (const section of ["vocab", "grammar"]) {
    const dir = resolve(options.src, `${level}-${section}`);
    const file = resolve(dir, "questions.json");
    if (!existsSync(file)) {
      if (!options.allowUndone) inputErrors.push(`${level}-${section}: 缺少 questions.json`);
      continue;
    }
    if (!options.allowUndone && !existsSync(resolve(dir, "DONE"))) {
      inputErrors.push(`${level}-${section}: 没有审校完成标记 DONE`);
      continue;
    }
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
      if (question.level !== level) inputErrors.push(`${where}: level ${String(question.level)} 和目录 ${level} 不一致`);
      if (!Number.isSafeInteger(question.no) || question.no < 1) {
        inputErrors.push(`${level} ${section} questions[${index}]: no 必须是正整数`);
        continue;
      }
      rows.push({ source: question, kind, no: question.no, level, section });
    }
    rows.sort((a, b) => a.no - b.no);
    if (rows.some((row, index) => row.no !== index + 1)) inputErrors.push(`${level}-${section}: no 必须从 1 起连续、不重复`);

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

    const shuffledSources = shuffleAnswers(rows.map((row) => row.source), `${options.setId}-${level}-${section}`);
    for (const [index, { kind, no }] of rows.entries()) {
      const source = shuffledSources[index];
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
      if (source.order !== null && source.order !== undefined) {
        question.order = source.order;
      }
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
  if (hasSources) sets.push(options.drillOnly ? { id: options.setId, title: options.title, drillOnly: true } : { id: options.setId, title: options.title });

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

  const banks = new Map();
  for (const level of LEVELS) {
    const file = resolve(DATA_DIR, `${level.toLowerCase()}.json`);
    banks.set(level, mergeLevel(level, readExistingBank(file, level), imported, passages, options));
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
  console.log(`校验: ${totalErrors} 错误，${totalWarnings} 警告`);
  // 先在内存里合并、校验，全过了才写盘：不让有错的题库落进仓库（以前是先写再报错）
  if (totalErrors) {
    console.error("校验没过，题库文件一个都没改。改源题后重新导入。");
    process.exitCode = 1;
    return;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const [level, bank] of banks) {
    writeFileSync(resolve(DATA_DIR, `${level.toLowerCase()}.json`), `${JSON.stringify(bank, null, 2)}\n`);
    const bySection = imported.filter((row) => row.level === level);
    console.log(`${level}: 写入 ${bank.questions.length} 题（本次 vocab ${bySection.filter((row) => row.section === "vocab").length}，grammar ${bySection.filter((row) => row.section === "grammar").length}）`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((cause) => {
    console.error(cause.message);
    process.exitCode = 1;
  });
}
