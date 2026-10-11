/**
 * 混合学习的出卡裁判：单词 / 语法 / 单独汉字 / 疑难连线四种卡**一条队列**。
 *
 * 下一张出哪一种、今天四种是不是都完了、「上一个」该撤哪一种 —— 只在这里判。
 * 网页学习页（pages/WordStudy.tsx）和小程序首页（wechat-miniprogram 的 runtime/learning.js，
 * 经 shared/web.js 打包同一份源码）都只调这里，前端只管各卡种的卡面长什么样。
 *
 * 为什么要收到一处（2026-10-11）：以前这套规则在网页组件里和小程序里各写一份，网页又散在
 * 「进页面」和「答完一张」的好几条出口上。10-10 作者报：答完最后一个单词直接进了完成页，
 * 顶上停在 612/645，33 条语法要重新进页面才出来 —— 就是有三条出口没去问「还有别的卡吗」。
 * 两端的细节也早就各走各的（撤销栈长度、撤掉单词后插播轮到哪一种）。
 *
 * 单词「出哪一个」仍归单词那套（减负 → 今日计划 → 错题回顾 → 压轴，网页还有预算下一张的快路径），
 * 调用方只告诉这里「手上还有没有下一个单词」；另外三种「出哪一张」由这里向各自的会话取。
 * 存储不合并：四种卡各自的记忆表、流水、FSRS 照旧（docs/MIXED_STUDY_PLAN.md 第 1 节）。
 *
 * 计数、轮次、撤销顺序是**这一次进学习页**的会话状态，放内存不落库：撤销栈只在本次会话里
 * 和各卡种自己那份落库的撤销栈对得上（退出再进来，栈顶是谁已经说不清，见 canUndoMixed）。
 */
import { getDatabase } from "./database";
import { getGrammarQuizSession, submitGrammarQuizAnswer, undoLastGrammarQuizAnswer, type GrammarQuizCard } from "./grammar-quiz";
import {
  getConfusionCardSession, getKanjiCardSession, mixedCardDataLoaded,
  submitConfusionCardAnswer, submitKanjiCardAnswer, undoConfusionCardAnswer, undoKanjiCardAnswer
} from "./mixed-cards";
import type { KanjiCharCard } from "./kanji-char-cards";
import type { MatchingCard } from "./confusion-cards";
import { getStudyPreferences } from "./studyPreferences";
import { UNDO_LIMIT } from "./word-api/undo-stack";
import type { WordAnswer } from "../types/vocabulary";

/**
 * 每答几个单词轮到一张别的卡。
 *
 * 语法一个等级只有一百来条、每天到期十几条，而单词一天几百张 —— 比例再密一点，
 * 别的卡当天就发完了，之后整场又退回纯单词；再稀一点它就成了偶尔冒一下的彩蛋。
 * 5 是「一屏之内一定见得到一条」和「不打断背词的节奏」之间的一档。
 */
export const MIXED_EVERY = 5;

export type MixedKind = "word" | "grammar" | "kanji" | "confusion";
export type MixedOtherItem =
  | { kind: "grammar"; card: GrammarQuizCard }
  | { kind: "kanji"; card: KanjiCharCard }
  | { kind: "confusion"; card: MatchingCard };

/** 三种非单词卡轮着来：语法 → 汉字 → 辨析，今天没了的那种跳过。 */
const OTHER_KINDS = ["grammar", "kanji", "confusion"] as const;

const session = {
  wordsSince: 0,
  rotation: 0,
  /** 撤掉一个单词时轮次退回去用：那一下带出来的别的卡不该算已经用掉 */
  rotationBefore: 0,
  /** 按作答顺序记的卡种，「上一个」按栈顶分派 —— 四种各有一份互不知道对方的撤销栈 */
  undo: [] as MixedKind[],
  grammarCanUndo: false
};

// 语法用哪一级：跟着备考目标走。混合模式**不给等级选择器** —— 多一个旋钮就多一处口径，
// 而「我在考哪一级」设置页里已经答过了。
const grammarLevel = () => getStudyPreferences().jlptTarget;

/** 进学习页、切学习模式时清零。 */
export const resetMixedSession = () => {
  session.wordsSince = 0;
  session.rotation = 0;
  session.rotationBefore = 0;
  session.undo = [];
  session.grammarCanUndo = false;
};

const otherOfKind = (kind: MixedOtherItem["kind"]): MixedOtherItem | null => {
  if (kind === "grammar") {
    const grammar = getGrammarQuizSession(grammarLevel());
    return grammar.card ? { kind, card: grammar.card } : null;
  }
  // 汉字 / 辨析的出厂素材是异步加载的（网页 loadMixedCardData、小程序 content.readyForKanji），
  // 调用方在开场就要等它到位；没到位时这两种先当作今天没有。
  if (!mixedCardDataLoaded()) return null;
  if (kind === "kanji") {
    const card = getKanjiCardSession(getDatabase()).card;
    return card ? { kind, card } : null;
  }
  const card = getConfusionCardSession(getDatabase()).card;
  return card ? { kind, card } : null;
};

const pickOther = (): MixedOtherItem | null => {
  for (let step = 0; step < OTHER_KINDS.length; step += 1) {
    const item = otherOfKind(OTHER_KINDS[(session.rotation + step) % OTHER_KINDS.length]);
    if (item) {
      session.rotationBefore = session.rotation;
      session.rotation += step + 1;
      return item;
    }
  }
  return null;
};

/**
 * 下一张该出哪一种。
 *
 * - `word`：单词那边手上有没有下一张；
 * - `afterWord`：这次是不是刚答完一个单词（计数只在这时 +1）。
 *
 * 返回 `"word"` = 出单词；一张别的卡 = 出它；`null` = 四种今天都完了。
 * 单词没了就一直出别的卡，三种都没了才是 null —— 完成只能由这里说。
 */
export const pickMixedNext = ({ word, afterWord = false }: { word: boolean; afterWord?: boolean }): "word" | MixedOtherItem | null => {
  if (afterWord) session.wordsSince += 1;
  if (word && session.wordsSince < MIXED_EVERY) return "word";
  // 到点了就清零，哪怕三种都没了：不清的话之后每答一个单词都要去问一遍三种会话，那是好几条 SQL。
  if (word) session.wordsSince = 0;
  return pickOther() ?? (word ? "word" : null);
};

/**
 * 答完这一个单词会不会轮到别的卡。网页的快路径（预算好的下一张单词直接换上）要先问这个：
 * 会轮到的话就不能走快路径。
 */
export const mixedTurnDue = () => session.wordsSince + 1 >= MIXED_EVERY;

/** 记一笔单词作答的顺序（撤销分派用）。经典模式也记，栈顶永远是对的。 */
export const recordMixedWordAnswer = () => {
  session.undo = [...session.undo, "word" as MixedKind].slice(-UNDO_LIMIT);
};

/** 别的卡评分：按卡种转给各自的记账函数，并记下作答顺序。 */
export const answerMixedOther = (item: MixedOtherItem, answer: WordAnswer) => {
  if (item.kind === "grammar") {
    session.grammarCanUndo = submitGrammarQuizAnswer(grammarLevel(), item.card.id, answer).canUndo;
  } else if (item.kind === "kanji") {
    submitKanjiCardAnswer(item.card.char, answer);
  } else {
    submitConfusionCardAnswer(item.card.groupKey, answer);
  }
  session.undo = [...session.undo, item.kind as MixedKind].slice(-UNDO_LIMIT);
};

/** 「上一个」现在该撤哪一种。栈空 = 这次进页面还没答过。 */
export const mixedUndoKind = (): MixedKind | null => session.undo[session.undo.length - 1] ?? null;

/**
 * 「上一个」亮不亮。`wordCanUndo` 是单词那份落库撤销栈的答案。
 *
 * ⚠️ 混合模式下**只撤这一次进页面之后答的**：作答顺序只记在内存里，退出学习页就没了，
 * 而单词那份撤销栈是落库的。不加这道闸的话：答一条语法 → 退出 → 再进来 → 点「上一个」，
 * 会按「单词」去撤**语法之前那个单词** —— 一次误操作造两笔假数据。经典模式只有单词，照旧用落库那份。
 */
export const canUndoMixed = (mixed: boolean, wordCanUndo: boolean) => {
  const kind = mixedUndoKind();
  if (mixed && !kind) return false;
  if (kind === "grammar") return session.grammarCanUndo;
  // 汉字 / 辨析：栈顶是它就一定能撤（流水就在库里）
  if (kind === "kanji" || kind === "confusion") return true;
  return wordCanUndo;
};

/**
 * 撤掉栈顶那张别的卡，返回要重新摆出来的那张。栈顶是单词时返回 null，由调用方走单词的撤销，
 * 之后再调 `undoMixedWord`。
 */
export const undoMixedOther = (): MixedOtherItem | null => {
  const kind = mixedUndoKind();
  if (!kind || kind === "word") return null;
  session.undo = session.undo.slice(0, -1);
  if (kind === "grammar") {
    const grammar = undoLastGrammarQuizAnswer(grammarLevel());
    session.grammarCanUndo = grammar.canUndo;
    return grammar.card ? { kind, card: grammar.card } : null;
  }
  if (kind === "kanji") undoKanjiCardAnswer();
  else undoConfusionCardAnswer();
  return otherOfKind(kind);
};

/**
 * 单词那份撤销做完之后调。`otherShowing`：撤销时屏幕上是不是正摆着一张别的卡 ——
 * 那张是刚才那个单词带出来的，这次作答不算数了，它也不该提前用掉：计数和轮次一起退回。
 */
export const undoMixedWord = ({ otherShowing }: { otherShowing: boolean }) => {
  if (mixedUndoKind() === "word") session.undo = session.undo.slice(0, -1);
  if (otherShowing) {
    session.wordsSince = MIXED_EVERY - 1;
    session.rotation = session.rotationBefore;
  }
};
