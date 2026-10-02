// 单词拼写（实验功能）的唯一入口。允许引用本目录的页面和功能目录由 isolation.test.ts 钉住。
// ⚠️ 合并各模块（romaji / forms / store …）之后在这里补导出；页面只从这里取。

export * from "./types";

/** 小程序 check:release 和 iOS 发版脚本认这个指纹；页面里要用到它，免得被摇掉。 */
export const SPELLING_MARKER = "__SHUSHUGO_EXP_SPELLING__";
