/**
 * 成就总数，给「我的」页那行副标题用。故意不 import catalog：catalog 带着全部名字和描述（约 7 KB），
 * 而「我的」是 Taro 的主包页，主包离 1.9 MB 上限只剩十几 KB。achievements.test.ts 钉着它和 catalog 一致。
 */
export const ACHIEVEMENT_TOTAL = 47;
