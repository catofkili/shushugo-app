// JLPT 刷题（实验功能）的唯一入口。允许引用的页面和功能目录由 isolation.test.ts 钉住。
// 对外函数签名与 types.ts 是数据层、界面、题库导入三方的接口约定。

export * from "./types";

/** 小程序 check:release 和 iOS 发版脚本认这个指纹；页面里要用到它，免得被摇掉。 */
export const JLPT_PRACTICE_MARKER = "__SHUSHUGO_EXP_JLPT__";

/** 按等级懒加载题库，每级一个 JSON；同级只加载一次，失败可重试。 */
export { loadJlptBank } from "./bank";
/** 拆题干标记，见 JlptQuestion.stem 的注释。纯函数。 */
export { parseStem } from "./practice";
/** 新题 → 错题 → 最久没答的；文章整篇、按空号出，默认 10 题。 */
export { pickDrillQuestions } from "./practice";
/** 最近一次答错或没答的题，可按题型筛；按考试顺序排。 */
export { mistakeQuestions } from "./practice";
/** 同一套先文字・語彙再文法，各部分按考试顺序；建议 1 分钟一题。 */
export { mockParts } from "./practice";
/** 按题型练每答一题调用，模拟卷交卷时整批调用；整批一起成功或回滚。 */
export { recordJlptAnswers } from "./practice";
/** 只列这个等级题库实际有的题型，按题去重取最近一次结果、按考试顺序。 */
export { jlptKindStats } from "./practice";
