import { getDatabase } from "../database";
import { persistSoon } from "../database/db-utils";
import { rowsFor, today } from "../study-core";
import { JLPT_KINDS, KIND_SECTION } from "./types";
import type {
  JlptAnswer, JlptBank, JlptKind, JlptKindStats, JlptLevel, JlptMockPart, JlptMode, JlptQuestion, StemPart
} from "./types";

/** 不吞普通文字；★＿＿ 必须先于普通槽匹配。 */
export const parseStem = (stem: string): StemPart[] => {
  const parts: StemPart[] = [];
  const markers = /\[\[([^]*?)\]\]|（　+）|★＿＿|＿＿|\[(\d+)\]/gu;
  let offset = 0;
  for (const match of stem.matchAll(markers)) {
    if (match.index > offset) parts.push({ type: "text", text: stem.slice(offset, match.index) });
    if (match[1] !== undefined) parts.push({ type: "underline", text: match[1] });
    else if (match[2] !== undefined) parts.push({ type: "ref", n: Number(match[2]) });
    else if (match[0].startsWith("（")) parts.push({ type: "blank" });
    else parts.push({ type: "slot", star: match[0].startsWith("★") });
    offset = match.index + match[0].length;
  }
  if (offset < stem.length) parts.push({ type: "text", text: stem.slice(offset) });
  return parts;
};

type LatestAnswer = { correct: boolean; at: number };
const latestAnswers = (level: JlptLevel): Map<string, LatestAnswer> => {
  const latest = new Map<string, LatestAnswer>();
  // 同毫秒可能连答两次，必须用自增 id 打破平局，不能把前一次错误当成最新。
  for (const row of rowsFor(`SELECT question_id, correct, answered_at FROM jlpt_answers
    WHERE level = ? ORDER BY answered_at DESC, id DESC`, [level])) {
    const id = String(row.question_id);
    if (!latest.has(id)) latest.set(id, { correct: Number(row.correct) === 1, at: Number(row.answered_at) });
  }
  return latest;
};

const blankNumber = (question: JlptQuestion): number => Number(question.stem.match(/\[(\d+)\]/u)?.[1] ?? 0);

/** 文章按首次出现的篇序，篇内按空号；其它小题保持题库顺序。 */
const questionGroups = (questions: JlptQuestion[]): JlptQuestion[][] => {
  const groups: JlptQuestion[][] = [];
  const passages = new Map<string, JlptQuestion[]>();
  for (const question of questions) {
    if (question.kind !== "passage" || !question.passageId) { groups.push([question]); continue; }
    let group = passages.get(question.passageId);
    if (!group) { group = []; passages.set(question.passageId, group); groups.push(group); }
    group.push(question);
  }
  for (const group of passages.values()) group.sort((a, b) => blankNumber(a) - blankNumber(b));
  return groups;
};
const examOrder = (questions: JlptQuestion[]): JlptQuestion[] => questionGroups(questions)
  .sort((a, b) => JLPT_KINDS.indexOf(a[0].kind) - JLPT_KINDS.indexOf(b[0].kind)).flat();
const bankQuestions = (bank: JlptBank): JlptQuestion[] => bank.questions.filter((question) => question.level === bank.level);

/** 默认一组 10 题。新题、错题随机；答对过的优先最久没答，同时间随机。文章整篇不可拆。 */
export const pickDrillQuestions = (
  bank: JlptBank, kind: JlptKind, count?: number, random?: () => number
): JlptQuestion[] => {
  const limit = count ?? 10;
  if (limit <= 0) return [];
  const latest = latestAnswers(bank.level);
  const groups = questionGroups(bankQuestions(bank).filter((question) => question.kind === kind)).map((questions) => {
    const answers = questions.map((question) => latest.get(question.id));
    return {
      questions,
      // 一篇中还有新空就算新篇；没有新空但有错空算错篇，整篇跟着最高优先级走。
      tier: answers.some((answer) => !answer) ? 0 : answers.some((answer) => !answer?.correct) ? 1 : 2,
      at: Math.min(...answers.map((answer) => answer?.at ?? 0))
    };
  });
  // Fisher–Yates 避免 sort(() => random() - .5) 的偏置，再稳定排优先级。
  const rng = random ?? Math.random;
  for (let i = groups.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [groups[i], groups[j]] = [groups[j], groups[i]];
  }
  groups.sort((a, b) => a.tier - b.tier || (a.tier === 2 ? a.at - b.at : 0));
  const result: JlptQuestion[] = [];
  for (const group of groups) {
    result.push(...group.questions);
    if (result.length >= limit) break;
  }
  return result;
};

/** 错题本只算当前等级题库仍存在的题，最近一次为准，含未答（0）。 */
export const mistakeQuestions = (bank: JlptBank, kind?: JlptKind): JlptQuestion[] => {
  const latest = latestAnswers(bank.level);
  return examOrder(bankQuestions(bank).filter((question) =>
    (!kind || question.kind === kind) && latest.get(question.id)?.correct === false));
};

/** 两部分固定按文字・語彙、文法排列，每题建议一分钟。 */
export const mockParts = (bank: JlptBank, setId: string): JlptMockPart[] => {
  const questions = examOrder(bankQuestions(bank).filter((question) => question.setId === setId));
  return (["vocab", "grammar"] as const).map((section) => {
    const part = questions.filter((question) => KIND_SECTION[question.kind] === section);
    return { section, minutes: part.length, questions: part };
  });
};

/** 一批一起写或一起回滚，只追加本地流水，不改 FSRS、今日计划或学习进度事件。 */
export const recordJlptAnswers = (
  bank: JlptBank, mode: JlptMode, sessionId: string, answers: JlptAnswer[]
): void => {
  if (!answers.length) return;
  const byId = new Map(bankQuestions(bank).map((question) => [question.id, question]));
  const records = answers.map((answer) => {
    const question = byId.get(answer.questionId);
    if (!question) throw new Error(`JLPT 题库中没有题目：${answer.questionId}`);
    if (![0, 1, 2, 3, 4].includes(answer.chosen)) throw new Error("JLPT 选项必须为 0–4");
    return { question, chosen: answer.chosen };
  });
  const db = getDatabase();
  const day = today();
  const at = Date.now();
  db.run("SAVEPOINT jlpt_write");
  try {
    for (const { question, chosen } of records) db.run(`INSERT INTO jlpt_answers
      (question_id, level, kind, chosen, correct, mode, session_id, answered_on, answered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [question.id, bank.level, question.kind, chosen, Number(chosen === question.answer), mode, sessionId, day, at]);
    db.run("RELEASE jlpt_write");
  } catch (error) {
    db.run("ROLLBACK TO jlpt_write");
    db.run("RELEASE jlpt_write");
    throw error;
  }
  persistSoon();
};

/** 最近一次结果按题去重，删题或其它等级的历史不计入当前题库统计。 */
export const jlptKindStats = (bank: JlptBank): JlptKindStats[] => {
  const latest = latestAnswers(bank.level);
  const questions = bankQuestions(bank);
  return JLPT_KINDS.flatMap((kind) => {
    const ofKind = questions.filter((question) => question.kind === kind);
    if (!ofKind.length) return [];
    const results = ofKind.map((question) => latest.get(question.id));
    const done = results.filter(Boolean).length;
    const correct = results.filter((answer) => answer?.correct).length;
    return [{ kind, total: ofKind.length, done, correct, mistakes: done - correct }];
  });
};
