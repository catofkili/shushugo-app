/** 队伍称号的唯一 key 表；catalog 和 Worker 共用，纯数据不引入页面依赖。 */
export const YUZU_TITLE_IDS = {
  early: "title-early",
  night: "title-night",
  hunter: "title-hunter",
  slow: "title-slow",
  grove: "title-grove",
  capy: "title-capy",
  // 只能邀请获得：Worker 要校验账号确实解锁过邀请套装，见 docs/claude/learning-progress-and-rewards.md「拉新邀请码」
  yuyou: "title-yuyou"
} as const;
