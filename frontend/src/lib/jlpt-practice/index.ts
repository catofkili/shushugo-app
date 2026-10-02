// JLPT 刷题（实验功能）的唯一入口。只许被三处引用（路由表、小程序 route-table、本目录），见 isolation 测试。
// ⚠️ 这一版是接口约定：函数体由数据层任务实现，界面任务照签名调用。签名改了要通知双方。

import type {
  JlptAnswer, JlptBank, JlptKind, JlptKindStats, JlptLevel, JlptMockPart, JlptMode, JlptQuestion, StemPart
} from "./types";

export * from "./types";

/** 小程序 check:release 和 iOS 发版脚本认这个指纹；页面里要用到它，免得被摇掉。 */
export const JLPT_PRACTICE_MARKER = "__SHUSHUGO_EXP_JLPT__";

const todo = (name: string): never => { throw new Error(`jlpt-practice: ${name} 未实现`); };

/** 按等级懒加载题库（每级一个 JSON，网页单独成块、小程序进 lazy 分包），同一等级只加载一次。 */
export const loadJlptBank = (level: JlptLevel): Promise<JlptBank> => todo(`loadJlptBank(${level})`);

/** 拆题干标记，见 JlptQuestion.stem 的注释。纯函数。 */
export const parseStem = (stem: string): StemPart[] => todo(`parseStem(${stem})`);

/**
 * 按题型练：先出没答过的，再出错题，最后出最久没答的；同一档内随机。不足 count 就有多少给多少。
 * 文章题按整篇出（同一 passageId 的几道一起、按空号排），count 按篇数之外的题数近似即可。
 */
export const pickDrillQuestions = (
  bank: JlptBank, kind: JlptKind, count?: number, random?: () => number
): JlptQuestion[] => todo(`pickDrillQuestions(${bank.level}, ${kind}, ${count}, ${typeof random})`);

/** 错题本：最近一次答错或没答的题，可按题型筛。按考试顺序排。 */
export const mistakeQuestions = (bank: JlptBank, kind?: JlptKind): JlptQuestion[] =>
  todo(`mistakeQuestions(${bank.level}, ${kind})`);

/** 一套模拟卷：先文字・語彙再文法，各部分内按考试顺序；建议用时 1 分钟一题。 */
export const mockParts = (bank: JlptBank, setId: string): JlptMockPart[] => todo(`mockParts(${bank.level}, ${setId})`);

/** 记作答（一次性写入这一批）。按题型练每答一题调一次；模拟卷交卷时整批调一次。 */
export const recordJlptAnswers = (
  bank: JlptBank, mode: JlptMode, sessionId: string, answers: JlptAnswer[]
): void => todo(`recordJlptAnswers(${bank.level}, ${mode}, ${sessionId}, ${answers.length})`);

/** 每个题型的统计，只列这个等级题库里有的题型，按考试顺序。 */
export const jlptKindStats = (bank: JlptBank): JlptKindStats[] => todo(`jlptKindStats(${bank.level})`);
