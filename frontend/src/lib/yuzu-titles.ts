/** 队伍称号的唯一 key 表；catalog 和 Worker 共用，纯数据不引入页面依赖。 */
export const YUZU_TITLE_IDS = {
  early: "title-early",
  night: "title-night",
  hunter: "title-hunter",
  slow: "title-slow",
  grove: "title-grove",
  capy: "title-capy"
} as const;
